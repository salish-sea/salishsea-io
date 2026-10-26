#!/usr/bin/env bash
# One read-path build: fetch the sources, snapshot the database, rewrite the files that
# changed. Since Stelis's ADR 0019 these are two Stelis projects, each with a state dir
# of its own (the engine refuses one that holds another project's builds):
# salishsea-ingest, the four source ingests, and salishsea, everything from the snapshot
# on. Both graphs live in this repository, stelis/salishsea.rkt and
# stelis/salishsea-ingest.rkt, and Stelis loads each by its module path (decision 092,
# Stelis ADR 0020). The schedule builds both, the ingests first; a build with arguments, which is how
# the write API's build after a save is scoped to the store and what derives from it
# (--downstream snapshot, salish-9uu.6), builds only salishsea, and the arguments go to
# Stelis.
#
# Two locks, so that a save never waits for an ingest (salish-uh0y, decision 091):
#
# - /data/ingest.lock is the schedule's. A scheduled build holds it from start to finish,
#   so one never starts while the last is still running (it exits 75, EX_TEMPFAIL, and
#   leaves the work for the next), and a deploy (fly/deploy.sh) can wait out a running
#   ingest. The ingests run under it alone: they write only their own mirrors, which
#   are SQLite in write-ahead-log mode or replaced by rename, and the register's file,
#   replaced by rename, so a build reading them beside an ingest never waits for it.
# - /data/build.lock is salishsea's, because that build assumes one writer: the day files
#   are swapped into place with two renames, and two builds interleaving would each move
#   the other's directory, and the snapshot DuckDB file can be open for writing in one
#   process only. A save's build asks a running one to let go: it creates the yield
#   request in salishsea's state dir, waits for the lock, and removes the request once
#   it holds it. The running build finishes the task it is on, records the rest as
#   yielded, and exits 3, and its caller waits for the lock again and reruns it; the
#   tasks that ran before the yield are current and skip (Stelis ADR 0018, salish-vpru).
#   The scheduled build waits for the lock after its ingests, since a save's build is
#   short. Either one that doesn't have the lock within LOCK_WAIT (a deploy or an operator
#   holds it) exits 75; the write API's coalescer (api/server.ts) retries a save's.
#
# The scheduled build reports to a Sentry cron monitor (decision 012, amended;
# salish-d7tr): ok when it published, which is when manifest.json was rewritten, since
# the manifest waits on every other file, and error when it didn't or when an ingest
# failed, which in one graph kept the manifest from being rewritten. A build that never
# runs reports nothing, which Sentry counts as missed. Six in a row without an ok, half
# an hour, opens a Sentry issue. A yielded run doesn't report; the rerun does. A save's
# build doesn't report: the schedule is what the monitor watches.
set -euo pipefail

LOCK_WAIT=120
YIELDED=3

ingest_state_dir="$STELIS_STATE_DIR-ingest"
mkdir -p "$STELIS_STATE_DIR" "$ingest_state_dir" "$READ_PATH_EXPORT_DIR"
yield_request="$STELIS_STATE_DIR/yield"
manifest="$READ_PATH_EXPORT_DIR/manifest.json"

# salishsea's build, holding the build lock on descriptor 9, rerun while Stelis yields;
# sets built to its exit.
build() {
    while :; do
        built=0
        racket src/main.rkt --project /app/stelis/salishsea.rkt --build --all --export-dir "$READ_PATH_EXPORT_DIR" "$@" || built=$?
        [ "$built" -eq "$YIELDED" ] || return 0
        echo "read-path build: yielded to another build; rerunning once it has finished"
        flock -u 9
        # flock wakes waiters but doesn't queue them, so taking the lock straight back
        # could beat the waiting build to it. A second is far longer than the waiter needs.
        sleep 1
        flock 9
        # Measured again, because the build that preempted this one rewrote the manifest.
        before=$(stat -c %Y "$manifest" 2>/dev/null || echo 0)
    done
}

if [ $# -gt 0 ]; then
    exec 9> /data/build.lock
    touch "$yield_request"
    if ! flock -w "$LOCK_WAIT" 9; then
        rm -f "$yield_request"
        echo "read-path build: the build lock wasn't free within ${LOCK_WAIT}s; skipping this one"
        exit 75
    fi
    rm -f "$yield_request"
    cd /opt/stelis
    build "$@"
    exit "$built"
fi

exec 8> /data/ingest.lock
if ! flock -n 8; then
    echo "read-path build: the last scheduled build is still running; skipping this one"
    exit 75
fi
cd /opt/stelis
ingested=0
STELIS_STATE_DIR=$ingest_state_dir racket src/main.rkt --project /app/stelis/salishsea-ingest.rkt --build --all \
    --export-dir "$READ_PATH_EXPORT_DIR" || ingested=$?

# The ingests' failure doesn't stop the rest: the mirrors are as the last good fetch
# left them, and a save's sighting or a new day still deserves its files.
exec 9> /data/build.lock
if ! flock -w "$LOCK_WAIT" 9; then
    echo "read-path build: the build lock wasn't free within ${LOCK_WAIT}s; skipping the rest of this one"
    exit 75
fi
before=$(stat -c %Y "$manifest" 2>/dev/null || echo 0)
build
if [ "$built" -eq 0 ]; then built=$ingested; fi

if [ -z "${SENTRY_CRONS:-}" ]; then exit "$built"; fi
after=$(stat -c %Y "$manifest" 2>/dev/null || echo 0)
status=error
if [ "$after" -gt "$before" ] && [ "$ingested" -eq 0 ]; then status=ok; fi

# The monitor's configuration rides on every check-in, so it lives here rather than in
# Sentry's settings. A reporting failure must not fail the build.
curl -fsS --max-time 10 -X POST "$SENTRY_CRONS" -H 'Content-Type: application/json' \
    --data-raw "{\"status\": \"$status\", \"monitor_config\": {
        \"schedule\": {\"type\": \"crontab\", \"value\": \"1-59/5 * * * *\"}, \"timezone\": \"UTC\",
        \"checkin_margin\": 5, \"max_runtime\": 30,
        \"failure_issue_threshold\": 6, \"recovery_threshold\": 1}}" > /dev/null \
    || echo "read-path build: couldn't report to Sentry's cron monitor" >&2
exit "$built"
