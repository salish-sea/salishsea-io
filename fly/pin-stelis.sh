#!/usr/bin/env bash
# Move the Stelis pin to a commit (decision 085):
#
#   fly/pin-stelis.sh <stelis commit>
#
# Writes fly/stelis-commit (the commit) and fly/stelis-digest (the digest of the image
# Stelis's CI built from it), which fly/deploy.sh passes to the Dockerfile. The digest
# comes from Stelis's own scripts/image-digest.sh, run from the Stelis checkout on this
# machine (STELIS_DIR, default ~/dev/stelis, where the runbook's rev-parse already
# looks) with the commit as its argument: it asks ghcr.io for the commit's tag and
# refuses unless the image is labelled with that commit, so the pair this writes has
# been checked against each other; the Dockerfile checks it again at build time. The
# checkout's copy rather than a download from the commit being pinned, so nothing
# runs here that a review has not seen. Commit the two files in a PR; that PR's
# deploy ships the move.
#
# The image is published a few minutes after the commit lands on Stelis's main. A
# commit that is not on main, or whose image has not been published yet, fails here,
# and the files are left as they were.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

commit=${1:-}
if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "usage: fly/pin-stelis.sh <full 40-character Stelis commit>" >&2
    echo "  (git -C ~/dev/stelis rev-parse <ref>)" >&2
    exit 2
fi

script="${STELIS_DIR:-$HOME/dev/stelis}/scripts/image-digest.sh"
if ! [[ -r "$script" ]]; then
    echo "pin-stelis.sh: no Stelis checkout at ${STELIS_DIR:-$HOME/dev/stelis} (no $script); clone github.com/rainhead/stelis there or set STELIS_DIR" >&2
    exit 1
fi
image=$(bash "$script" "$commit")
digest=${image#*@}
if ! [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "pin-stelis.sh: expected ghcr.io/rainhead/stelis@sha256:..., got '$image'" >&2
    exit 1
fi

echo "$commit" > fly/stelis-commit
echo "$digest" > fly/stelis-digest
echo "fly/stelis-commit: $commit"
echo "fly/stelis-digest: $digest"
git --no-pager diff --stat -- fly/stelis-commit fly/stelis-digest
