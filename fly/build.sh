#!/usr/bin/env bash
# One read-path build: snapshot the database, rewrite the files that changed.
# Arguments go to Stelis, which is how the write API's build after a save is scoped
# to the store and what derives from it (--downstream snapshot, salish-9uu.6): the
# three ingests have their five-minute schedule, and a save should not wait on them.
#
# Under a lock, because the build assumes one writer: the day files are swapped
# into place with two renames, and two builds interleaving would each move the
# other's directory, and the snapshot DuckDB file can be open for writing in one
# process only. The two kinds of build take the lock differently (Stelis ADR 0018,
# salish-vpru):
#
# - A save's build (one with arguments) asks the running build to let go: it creates
#   the yield request file in Stelis's state dir, waits for the lock, and removes the
#   request once it holds the lock. A running build finishes the task it is on, records
#   the rest as yielded, and exits 3, so a save waits for one task, not for the whole
#   scheduled build. If the lock isn't free within LOCK_WAIT (a deploy or an operator
#   holds it, or an ingest task runs long), the build exits 75 (EX_TEMPFAIL), and the
#   write API's coalescer (api/server.ts) retries.
# - The scheduled build skips rather than queues: when the lock is held it exits 75 and
#   leaves the work for the next run.
#
# Either kind, when Stelis exits 3, waits for the lock again and reruns until a build
# completes; the tasks that ran before the yield are current and skip.
#
# The scheduled build reports to a Sentry cron monitor (decision 012, amended;
# salish-d7tr): ok when it published, which is when manifest.json was rewritten, since
# the manifest waits on every other file, and error when it didn't. A build that never
# runs reports nothing, which Sentry counts as missed. Six in a row without an ok, half
# an hour, opens a Sentry issue. A yielded run doesn't report; the rerun does. A save's
# build doesn't report: the schedule is what the monitor watches.
set -euo pipefail

LOCK_WAIT=120
YIELDED=3

mkdir -p "$STELIS_STATE_DIR" "$READ_PATH_EXPORT_DIR"
yield_request="$STELIS_STATE_DIR/yield"
exec 9> /data/build.lock

if [ $# -gt 0 ]; then
    touch "$yield_request"
    if ! flock -w "$LOCK_WAIT" 9; then
        rm -f "$yield_request"
        echo "read-path build: the lock wasn't free within ${LOCK_WAIT}s; skipping this one"
        exit 75
    fi
    rm -f "$yield_request"
elif ! flock -n 9; then
    echo "read-path build: another build holds the lock; skipping this one"
    exit 75
fi

cd /opt/stelis
manifest="$READ_PATH_EXPORT_DIR/manifest.json"
while :; do
    # Measured for each run, because the build that preempted this one rewrites the
    # manifest too.
    before=$(stat -c %Y "$manifest" 2>/dev/null || echo 0)
    built=0
    racket src/main.rkt --project salishsea --build --all --export-dir "$READ_PATH_EXPORT_DIR" "$@" || built=$?
    [ "$built" -eq "$YIELDED" ] || break
    echo "read-path build: yielded to another build; rerunning once it has finished"
    flock -u 9
    # flock wakes waiters but doesn't queue them, so taking the lock straight back
    # could beat the waiting build to it. A second is far longer than the waiter needs.
    sleep 1
    flock 9
done

if [ $# -gt 0 ] || [ -z "${SENTRY_CRONS:-}" ]; then exit "$built"; fi
after=$(stat -c %Y "$manifest" 2>/dev/null || echo 0)
status=error
if [ "$after" -gt "$before" ]; then status=ok; fi

# The monitor's configuration rides on every check-in, so it lives here rather than in
# Sentry's settings. A reporting failure must not fail the build.
curl -fsS --max-time 10 -X POST "$SENTRY_CRONS" -H 'Content-Type: application/json' \
    --data-raw "{\"status\": \"$status\", \"monitor_config\": {
        \"schedule\": {\"type\": \"crontab\", \"value\": \"1-59/5 * * * *\"}, \"timezone\": \"UTC\",
        \"checkin_margin\": 5, \"max_runtime\": 30,
        \"failure_issue_threshold\": 6, \"recovery_threshold\": 1}}" > /dev/null \
    || echo "read-path build: couldn't report to Sentry's cron monitor" >&2
exit "$built"
