#!/usr/bin/env bash
# Deploy the salishsea-io Fly app from this checkout (salish-t3g.3). The Deploy workflow
# runs it on every push to main (salish-t3g.5); run it by hand to redeploy. The image
# is tagged with both pins, so `fly deploy --image
# registry.fly.io/salishsea-io:<sha>-stelis-<12>` redeploys one.
#
#   fly/deploy.sh          build the image, then switch the machine to it
#   fly/deploy.sh build    build and push the image only; production is untouched
#   fly/deploy.sh switch   take the machine's locks and deploy the image `build` pushed
#
# The Deploy workflow runs `build` beside its tests and `switch` after the database is
# migrated (salish-t3g.10); by hand, the bare command does both.
#
# The Stelis commit the image pins is fly/stelis-commit (salish-t3g.9), and the digest
# of the Stelis image built from it is fly/stelis-digest (decision 085); fly/pin-stelis.sh
# writes both. Moving the pin is a PR here, so a change spanning both repos ships when
# that PR deploys, and the commit a release names says which Stelis it ran.
#
# The pin must be at or past f364281 (--downstream, which the save-triggered build
# passes, salish-9uu.6); the Dockerfile refuses an older one.
#
# flyctl by that name: the Deploy workflow's setup-flyctl installs no `fly` alias.
#
# The image builds on Fly's remote builder, which is fly deploy's default. On Apple
# silicon it is also the only builder that works: Racket CS won't run under Docker's
# x86_64 emulation ("error reading from petite"), and the Dockerfile still runs it
# once, to check the copied engine loads. On an x86_64 host `docker build` works.
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
STELIS_DIGEST=$(tr -d '[:space:]' < fly/stelis-digest)
if ! [[ "$STELIS_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "fly/stelis-digest must hold one sha256:<64 hex> image digest, not '$STELIS_DIGEST'; run fly/pin-stelis.sh" >&2
    exit 1
fi
STELIS_IMAGE="ghcr.io/rainhead/stelis@$STELIS_DIGEST"
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
    # minutes, and the machine's locks (in switch) are held only for the switch.
    flyctl deploy --build-only --push --image-label "$LABEL" "${secrets[@]}" \
        --build-arg GITHUB_SHA="$SHA" \
        --build-arg SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" \
        --build-arg STELIS_SHA="$STELIS_SHA" \
        --build-arg STELIS_IMAGE="$STELIS_IMAGE"
}

switch() {
    # Take the machine's locks (decision 066), the schedule's and then the build's, as a
    # scheduled build takes them (fly/build.sh, decision 091), waiting out a running
    # ingest and a running build, so that none is running when the machine stops: the machine's own stop doesn't wait
    # for one, because Fly has stopped routing to it by then. It is held by a session that
    # outlives this one: killing the local `fly ssh` leaves the remote side running. So it
    # lets go by itself after HOLD seconds, and a deploy that fails before the machine is
    # replaced lets go at once. A build that runs for LOCK_WAIT seconds is likely stuck,
    # and fails the deploy rather than being killed by it.
    #
    # `fly ssh` sometimes can't reach the machine at all ("tunnel unavailable … timed
    # out", run 40753955923; Beeline met it too). That is tried again, ATTEMPTS times in
    # all, with the local Fly agent restarted between, which is what cleared it for
    # Beeline (salish-6x65). A lock that can't be had is not tried again: it means a
    # build is stuck, and waiting longer won't free it.
    HOLD=600 LOCK_WAIT=300 ATTEMPTS=3
    HOLDER="deploy-hold-$SHA-$$"   # names this deploy's hold alone
    # The hold's own pid, so it can be let go by that: the image has no pkill, and
    # matching a command line would match the shell doing the matching too.
    PIDFILE="/tmp/$HOLDER.pid"
    UNREACHABLE='tunnel unavailable|Error contacting Fly.io API|context deadline exceeded'
    lock_log=$(mktemp)
    hold_pid=
    held=
    deployed=
    release() {
        [ -z "$hold_pid" ] || kill "$hold_pid" 2>/dev/null || true
        # Only a hold that was confirmed has anything to let go of; with the machine
        # unreachable, another `fly ssh` would only put off the failure. A hold whose
        # confirmation was lost on the way lets go by itself after HOLD seconds.
        [ -z "$held" ] || [ -n "$deployed" ] || flyctl ssh console -a "$APP" -C "sh -c 'kill \$(cat $PIDFILE) 2>/dev/null; rm -f $PIDFILE'" > /dev/null 2>&1 || true
        rm -f "$lock_log"
    }
    trap release EXIT
    for attempt in $(seq "$ATTEMPTS"); do
        : > "$lock_log"
        flyctl ssh console -a "$APP" \
            -C "flock -o -w $LOCK_WAIT /data/ingest.lock flock -o -w $LOCK_WAIT /data/build.lock timeout $HOLD sh -c 'echo \$\$ > $PIDFILE; echo held; sleep $HOLD' $HOLDER" \
            > "$lock_log" 2>&1 &
        hold_pid=$!
        while ! grep -q '^held' "$lock_log" && kill -0 "$hold_pid" 2>/dev/null; do
            sleep 2
        done
        if grep -q '^held' "$lock_log"; then
            held=1
            break
        fi
        cat "$lock_log" >&2
        if ! grep -qE "$UNREACHABLE" "$lock_log"; then
            echo "couldn't take the machine's locks within ${LOCK_WAIT}s each; is a build stuck? The image is pushed: rerun fly/deploy.sh switch" >&2
            exit 1
        fi
        if [ "$attempt" -eq "$ATTEMPTS" ]; then
            echo "couldn't reach the machine through fly ssh in $ATTEMPTS tries. The image is pushed: rerun fly/deploy.sh switch" >&2
            exit 1
        fi
        echo "couldn't reach the machine through fly ssh (try $attempt of $ATTEMPTS); restarting the Fly agent and trying again in $((attempt * 15))s" >&2
        flyctl agent restart > /dev/null 2>&1 || true
        sleep $((attempt * 15))
    done

    flyctl deploy --ha=false --image "$IMAGE"
    deployed=1
}

[ "$MODE" = switch ] || build
[ "$MODE" = build ] || switch
