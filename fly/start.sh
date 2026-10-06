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

# The write API's secrets (decision 065) are taken out of the environment here, before
# anything starts, so that only the API is handed them (below): the session signing key,
# the edge secret that marks a request as having come through CloudFront, the AWS key
# that may add photos and keep the store's replica, and the GitHub token the feedback
# notifier files issues with. Hygiene rather than a boundary: every process runs as `app`.
session_key="${SESSION_SIGNING_KEY:-}"
edge_secret="${EDGE_SECRET:-}"
aws_key_id="${AWS_ACCESS_KEY_ID:-}"
aws_secret="${AWS_SECRET_ACCESS_KEY:-}"
github_token="${FEEDBACK_GITHUB_TOKEN:-}"
unset SESSION_SIGNING_KEY EDGE_SECRET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY FEEDBACK_GITHUB_TOKEN

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

# The write API (decision 065), only once API_ENABLED is set: its store must stay empty
# until the cutover copies Postgres into it (api/store/copy-from-postgres.ts refuses a
# store that holds anything), so it isn't started before then. It holds the session
# signing key, which only it reads.
#
# Supervised on its own, not by the `wait -n` below: an API that can't start (a missing
# key, a migration that fails) must not take the published site down with it, so it is
# restarted here, after a pause, while Caddy keeps serving.
#
# Its secrets are taken out of the environment before anything starts (see above).
if [ -n "${API_ENABLED:-}" ] && [ "${API_ENABLED}" != 0 ]; then
    mkdir -p /data/store
    (
        # this script runs with -e, which would end the loop at the API's first exit
        set +e
        cd /app
        while true; do
            # A fresh volume gets the store back from its replica before anything can
            # write it; with a store present this does nothing. With neither a store nor
            # a replica it fails, and the API stays down rather than start an empty store
            # that would publish a map without anyone's sightings: putting a store in
            # place is a deliberate act (the cutover, or a restore by hand).
            AWS_ACCESS_KEY_ID="$aws_key_id" AWS_SECRET_ACCESS_KEY="$aws_secret" \
                litestream restore -config /app/fly/litestream.yml -if-db-not-exists \
                /data/store/salishsea.db \
            || { echo "restoring the store from its replica failed; retrying in 10 s" >&2; sleep 10; continue; }
            # The API runs under Litestream, so the store is replicated exactly while
            # the API can write it, and the two stop and restart together.
            STORE_PATH=/data/store/salishsea.db SESSION_SIGNING_KEY="$session_key" EDGE_SECRET="$edge_secret" \
                AWS_ACCESS_KEY_ID="$aws_key_id" AWS_SECRET_ACCESS_KEY="$aws_secret" \
                FEEDBACK_GITHUB_TOKEN="$github_token" \
                BUILD_COMMAND=/app/fly/build.sh \
                litestream replicate -config /app/fly/litestream.yml -exec "node api/server.ts"
            status=$?
            echo "write API or Litestream exited ($status); restarting in 10 s" >&2
            sleep 10
        done
    ) &
fi

supercronic /app/fly/crontab &
cron_pid=$!
# Builds when the data changes, a few seconds after each burst (salish-t3g.6): Supabase
# Realtime's signal, while Postgres holds what users write. From the cutover the build
# reads the store (READ_PATH_STORE, scripts/read-path/snapshot.ts) and the write API wakes
# it after each write, so the listener isn't started.
if [ -z "${READ_PATH_STORE:-}" ]; then
    (cd /app && exec node scripts/read-path/listen.ts /app/fly/build.sh) &
    listen_pid=$!
else
    listen_pid=
fi
(/app/fly/build.sh || echo "read-path build at boot failed; the schedule will retry") &

# Either one stopping is a failure, whatever its exit status: a clean exit would
# otherwise read to Fly as a finished machine, not one to restart.
# shellcheck disable=SC2086 # listen_pid is empty, and so no argument, once it retires
wait -n "$caddy_pid" "$cron_pid" $listen_pid "$redirect_pid" || true
echo "caddy, supercronic, the change listener or the redirect server exited; stopping so Fly restarts the machine" >&2
exit 1
