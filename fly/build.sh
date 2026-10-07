#!/usr/bin/env bash
# One read-path build: snapshot the database, rewrite the files that changed.
# Arguments go to Stelis, which is how the write API's build after a save is scoped
# to the store and what derives from it (--downstream snapshot, salish-9uu.6): the
# three ingests have their five-minute schedule, and a save should not wait on them.
#
# Under a lock, because the build assumes one writer: the day files are swapped
# into place with two renames, and two builds interleaving would each move the
# other's directory. A build that finds the lock held skips rather than queues,
# and exits 75 (EX_TEMPFAIL) to say so: the write API's coalescer (api/server.ts)
# retries on that, while the five-minute schedule simply leaves it for the next run.
#
# The scheduled build reports to a Sentry cron monitor (decision 012, amended;
# salish-d7tr): ok when it published, which is when manifest.json was rewritten, since
# the manifest waits on every other file, and error when it didn't. A build that never
# runs reports nothing, which Sentry counts as missed. Six in a row without an ok, half
# an hour, opens a Sentry issue. A save's build passes arguments and doesn't report: the
# schedule is what the monitor watches.
set -euo pipefail

mkdir -p "$STELIS_STATE_DIR" "$READ_PATH_EXPORT_DIR"
exec 9> /data/build.lock
if ! flock -n 9; then
    echo "read-path build: another build holds the lock; skipping this one"
    exit 75
fi

cd /opt/stelis
if [ $# -gt 0 ] || [ -z "${SENTRY_CRONS:-}" ]; then
    exec racket src/main.rkt --project salishsea --build --all --export-dir "$READ_PATH_EXPORT_DIR" "$@"
fi

manifest="$READ_PATH_EXPORT_DIR/manifest.json"
before=$(stat -c %Y "$manifest" 2>/dev/null || echo 0)
built=0
racket src/main.rkt --project salishsea --build --all --export-dir "$READ_PATH_EXPORT_DIR" || built=$?
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
