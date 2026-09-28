#!/usr/bin/env bash
# The machine's one process: Caddy and the hourly schedule side by side, plus a
# build at boot so a fresh volume has files before the first scheduled run.
#
# If Caddy or supercronic exits, so does this, and Fly restarts the machine. The
# boot build is not watched: a failed build leaves the last good files in place
# and the next hour tries again.
set -euo pipefail

mkdir -p "$STELIS_STATE_DIR" "$READ_PATH_EXPORT_DIR"

caddy run --config /app/fly/Caddyfile --adapter caddyfile &
caddy_pid=$!
supercronic /app/fly/crontab &
cron_pid=$!
(/app/fly/build.sh || echo "read-path build at boot failed; the schedule will retry") &

wait -n "$caddy_pid" "$cron_pid"
