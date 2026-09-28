#!/usr/bin/env bash
# The machine's one process: Caddy and the hourly schedule side by side, plus a
# build at boot so a fresh volume has files before the first scheduled run.
#
# If Caddy or supercronic exits, so does this, with a failure, and Fly restarts
# the machine. The boot build is not watched: a failed build leaves the last good
# files in place and the next hour tries again.
set -euo pipefail

# Fly mounts the volume owned by root. Take ownership once, as root, then run
# everything as `app`: nothing here needs root, and the database credential
# lives in this process's environment.
if [ "$(id -u)" = 0 ]; then
    mkdir -p "$STELIS_STATE_DIR" "$READ_PATH_EXPORT_DIR"
    chown -R app:app /data
    exec setpriv --reuid=app --regid=app --init-groups "$0" "$@"
fi

caddy run --config /app/fly/Caddyfile --adapter caddyfile &
caddy_pid=$!
supercronic /app/fly/crontab &
cron_pid=$!
(/app/fly/build.sh || echo "read-path build at boot failed; the schedule will retry") &

# Either one stopping is a failure, whatever its exit status: a clean exit would
# otherwise read to Fly as a finished machine, not one to restart.
wait -n "$caddy_pid" "$cron_pid" || true
echo "caddy or supercronic exited; stopping so Fly restarts the machine" >&2
exit 1
