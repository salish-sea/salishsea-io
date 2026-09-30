#!/usr/bin/env bash
# The machine's one process: Caddy, the hourly schedule, the change listener and
# the redirect server side by side, plus a build at boot so a fresh volume has
# files before the first scheduled run.
#
# If any of the four exits, so does this, with a failure, and Fly restarts
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
# Builds when the data changes, a few seconds after each burst (salish-t3g.6).
(cd /app && exec node_modules/.bin/tsx scripts/read-path/listen.ts /app/fly/build.sh) &
listen_pid=$!
# Redirects designation-shaped profile paths from the build's map; Caddy proxies
# them here (decision 057, step 5). Plain node, not tsx: it runs all day on a 1 GB
# machine, and node strips its types itself without tsx's extra process.
(cd /app && exec node scripts/read-path/redirect.ts "$READ_PATH_EXPORT_DIR/redirects.json" 8081) &
redirect_pid=$!
(/app/fly/build.sh || echo "read-path build at boot failed; the schedule will retry") &

# Either one stopping is a failure, whatever its exit status: a clean exit would
# otherwise read to Fly as a finished machine, not one to restart.
wait -n "$caddy_pid" "$cron_pid" "$listen_pid" "$redirect_pid" || true
echo "caddy, supercronic, the change listener or the redirect server exited; stopping so Fly restarts the machine" >&2
exit 1
