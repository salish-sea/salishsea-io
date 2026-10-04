#!/usr/bin/env bash
# The machine's one process: Caddy, the five-minute schedule, the change listener and
# the redirect server side by side, plus a build at boot so a fresh volume has
# files before the first scheduled run.
#
# Everything here, and every build step Stelis runs, is plain node: it strips
# the scripts' TypeScript types itself (the tsconfig keeps them erasable), and
# tsx would add a wrapper process and an esbuild service, ~30 MB, beside each
# one on a 1 GB machine.
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
# Redirects designation-shaped profile paths from the build's map; Caddy proxies
# them here (decision 057, step 5).
(cd /app && exec node scripts/read-path/redirect.ts "$READ_PATH_EXPORT_DIR/redirects.json" 8081) &
redirect_pid=$!

# Maintenance mode (salish-xv35.24, after beeline's #132): READ_PATH_MAINTENANCE set
# and not 0 in the machine's environment (`fly machine update --env`) keeps the site
# up — every published file still serves, and Fly's check on / still passes, so the
# update finishes in one boot — and leaves the builds off: no schedule, no change
# listener, no boot build. The snapshot, the mirrors and the build lock are then free
# for a backfill or a repair run by hand. /status/maintenance.json says so, with the
# moment it began, for the heartbeat; leaving the mode boots normally, build included.
MAINTENANCE_FLAG="$(dirname "$READ_PATH_EXPORT_DIR")/mirrors/maintenance.json"
if [ -n "${READ_PATH_MAINTENANCE:-}" ] && [ "${READ_PATH_MAINTENANCE}" != 0 ]; then
    mkdir -p "$(dirname "$MAINTENANCE_FLAG")"
    printf '{"since":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MAINTENANCE_FLAG"
    echo "maintenance mode: serving the last published files; no builds until READ_PATH_MAINTENANCE is cleared" >&2
    wait -n "$caddy_pid" "$redirect_pid" || true
    echo "caddy or the redirect server exited; stopping so Fly restarts the machine" >&2
    exit 1
fi
rm -f "$MAINTENANCE_FLAG"

supercronic /app/fly/crontab &
cron_pid=$!
# Builds when the data changes, a few seconds after each burst (salish-t3g.6).
(cd /app && exec node scripts/read-path/listen.ts /app/fly/build.sh) &
listen_pid=$!
(/app/fly/build.sh || echo "read-path build at boot failed; the schedule will retry") &

# Either one stopping is a failure, whatever its exit status: a clean exit would
# otherwise read to Fly as a finished machine, not one to restart.
wait -n "$caddy_pid" "$cron_pid" "$listen_pid" "$redirect_pid" || true
echo "caddy, supercronic, the change listener or the redirect server exited; stopping so Fly restarts the machine" >&2
exit 1
