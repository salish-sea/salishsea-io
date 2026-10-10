#!/usr/bin/env bash
# Deploy the salishsea-io Fly app from this checkout (salish-t3g.3). The Deploy workflow
# runs it on every push to main (salish-t3g.5); run it by hand to redeploy. The image
# is tagged with both pins, so `fly deploy --image
# registry.fly.io/salishsea-io:<sha>-stelis-<12>` redeploys one.
#
#   fly/deploy.sh          build the image, then switch the machine to it
#   fly/deploy.sh build    build and push the image only; production is untouched
#   fly/deploy.sh switch   take the build lock and deploy the image `build` pushed
#
# The Deploy workflow runs `build` beside its tests and `switch` after the database is
# migrated (salish-t3g.10); by hand, the bare command does both.
#
# The Stelis commit the image pins is fly/stelis-commit (salish-t3g.9): moving it is a
# PR here, so a change spanning both repos ships when that PR deploys, and the commit
# a release names says which Stelis it ran.
#
# The pin must be at or past f364281 (--downstream, which the save-triggered build
# passes, salish-9uu.6); the Dockerfile refuses an older one.
#
# flyctl by that name: the Deploy workflow's setup-flyctl installs no `fly` alias.
#
# The image builds on Fly's remote builder, which is fly deploy's default and the
# only builder that works: Racket CS won't run under Docker's x86_64 emulation on
# Apple silicon ("error reading from petite"), so a local build fails.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE=${1:-all}
case "$MODE" in
    all|build|switch) ;;
    *) echo "usage: fly/deploy.sh [build|switch]" >&2; exit 2 ;;
esac

if [ -n "${STELIS_SHA:-}" ]; then
    echo "STELIS_SHA is read from fly/stelis-commit now; to move Stelis, change that file in a PR" >&2
    exit 1
fi
STELIS_SHA=$(tr -d '[:space:]' < fly/stelis-commit)
if ! [[ "$STELIS_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    echo "fly/stelis-commit must hold one full 40-character Stelis commit, not '$STELIS_SHA'" >&2
    exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
    echo "refusing to deploy uncommitted work: the image would not match any commit" >&2
    exit 1
fi

APP=salishsea-io
SHA=$(git rev-parse HEAD)
# The tag names both pins, so a rerun at another Stelis commit can't overwrite an image.
LABEL="$SHA-stelis-${STELIS_SHA:0:12}"
IMAGE="registry.fly.io/$APP:$LABEL"

build() {
    # Sentry's token, when there is one (the Deploy workflow has it), uploads the bundle's
    # source maps from the build that ships: a build secret, so it is in no image layer.
    # Without it the build is the same and uploads nothing.
    secrets=()
    [ -z "${SENTRY_AUTH_TOKEN:-}" ] || secrets=(--build-secret "SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN")

    # Build and push the image while the machine goes on building: the remote build takes
    # minutes, and the build lock (in switch) is held only for the switch.
    flyctl deploy --build-only --push --image-label "$LABEL" "${secrets[@]}" \
        --build-arg GITHUB_SHA="$SHA" \
        --build-arg SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" \
        --build-arg STELIS_SHA="$STELIS_SHA"
}

switch() {
    # Take the build lock on the machine (decision 066), waiting out a running build,
    # so that none is running when the machine stops: the machine's own stop doesn't wait
    # for one, because Fly has stopped routing to it by then. It is held by a session that
    # outlives this one: killing the local `fly ssh` leaves the remote side running. So it
    # lets go by itself after HOLD seconds, and a deploy that fails before the machine is
    # replaced lets go at once. A build that runs for LOCK_WAIT seconds is likely stuck,
    # and fails the deploy rather than being killed by it.
    HOLD=600 LOCK_WAIT=300
    HOLDER="deploy-hold-$SHA-$$"   # names this deploy's hold alone, to release it
    lock_log=$(mktemp)
    flyctl ssh console -a "$APP" \
        -C "flock -o -w $LOCK_WAIT /data/build.lock timeout $HOLD sh -c 'echo held; sleep $HOLD' $HOLDER" \
        > "$lock_log" 2>&1 &
    hold_pid=$!
    deployed=
    release() {
        kill "$hold_pid" 2>/dev/null || true
        [ -n "$deployed" ] || flyctl ssh console -a "$APP" -C "pkill -f $HOLDER" > /dev/null 2>&1 || true
        rm -f "$lock_log"
    }
    trap release EXIT
    until grep -q '^held' "$lock_log"; do
        if ! kill -0 "$hold_pid" 2>/dev/null; then
            cat "$lock_log" >&2
            echo "couldn't take the build lock within ${LOCK_WAIT}s; is a build stuck? The image is pushed: rerun fly/deploy.sh switch" >&2
            exit 1
        fi
        sleep 2
    done

    flyctl deploy --ha=false --image "$IMAGE"
    deployed=1
}

[ "$MODE" = switch ] || build
[ "$MODE" = build ] || switch
