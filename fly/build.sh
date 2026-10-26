#!/usr/bin/env bash
# One read-path build: fetch the sources, snapshot the database, rewrite the files that
# changed. Since Stelis's ADR 0019 these are two Stelis projects, each with a state dir
# of its own (the engine refuses one that holds another project's builds):
# salishsea-ingest, the four source ingests, and salishsea, everything from the snapshot
# on. The schedule builds both, the ingests first; a build with arguments, which is how
# the write API's build after a save is scoped to the store and what derives from it
# (--downstream snapshot, salish-9uu.6), builds only salishsea, and the arguments go to
# Stelis. For now both run under the one lock, one after the other (salish-mee7); the
# ingests moving outside it is salish-uh0y.
#
# Under a lock, because the build assumes one writer: the day files are swapped
# into place with two renames, and two builds interleaving would each move the
# other's directory, and the snapshot DuckDB file can be open for writing in one
# process only. The two kinds of build take the lock differently (Stelis ADR 0018,
# salish-vpru):
#
# - A save's build (one with arguments) asks the running build to let go: it creates
#   the yield request file in both projects' state dirs, since either may be running,
#   waits for the lock, and removes the requests once it holds the lock. A running
#   build finishes the task it is on, records the rest as yielded, and exits 3, so a
#   save waits for one task, not for the whole scheduled build. If the lock isn't free
#   within LOCK_WAIT (a deploy or an operator holds it, or an ingest task runs long),
#   the build exits 75 (EX_TEMPFAIL), and the write API's coalescer (api/server.ts)
#   retries.
# - The scheduled build skips rather than queues: when the lock is held it exits 75 and
#   leaves the work for the next run.
#
# Any build, when Stelis exits 3, waits for the lock again and reruns until a build
# completes; the tasks that ran before the yield are current and skip. A yield during the
# ingests reruns the ingests, and the salishsea build follows as usual.
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
yield_requests=("$STELIS_STATE_DIR/yield" "$ingest_state_dir/yield")
exec 9> /data/build.lock

if [ $# -gt 0 ]; then
    touch "${yield_requests[@]}"
    if ! flock -w "$LOCK_WAIT" 9; then
        rm -f "${yield_requests[@]}"
        echo "read-path build: the lock wasn't free within ${LOCK_WAIT}s; skipping this one"
        exit 75
    fi
    rm -f "${yield_requests[@]}"
elif ! flock -n 9; then
    echo "read-path build: another build holds the lock; skipping this one"
    exit 75
fi

cd /opt/stelis
# One project's build under the lock, rerun while Stelis yields; sets built to its exit.
build() {
    local state_dir=$1 project=$2; shift 2
    while :; do
        built=0
        STELIS_STATE_DIR=$state_dir racket src/main.rkt --project "$project" --build --all \
            --export-dir "$READ_PATH_EXPORT_DIR" "$@" || built=$?
        [ "$built" -eq "$YIELDED" ] || return 0
        echo "read-path build: $project yielded to another build; rerunning once it has finished"
        flock -u 9
        # flock wakes waiters but doesn't queue them, so taking the lock straight back
        # could beat the waiting build to it. A second is far longer than the waiter needs.
        sleep 1
        flock 9
        # Measured again, because the build that preempted this one rewrote the manifest.
        before=$(stat -c %Y "$manifest" 2>/dev/null || echo 0)
    done
}

manifest="$READ_PATH_EXPORT_DIR/manifest.json"
before=$(stat -c %Y "$manifest" 2>/dev/null || echo 0)
ingested=0
if [ $# -eq 0 ]; then
    build "$ingest_state_dir" salishsea-ingest
    ingested=$built
fi
# The ingests' failure doesn't stop the rest: the mirrors are as the last good fetch
# left them, and a save's sighting or a new day still deserves its files.
build "$STELIS_STATE_DIR" salishsea "$@"
if [ "$built" -eq 0 ]; then built=$ingested; fi

if [ $# -gt 0 ] || [ -z "${SENTRY_CRONS:-}" ]; then exit "$built"; fi
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
