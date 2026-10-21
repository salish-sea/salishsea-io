#!/bin/bash
# Fetch one of the files fly/downloads.tsv pins, by name, into a path (decision 084):
#
#   fly/fetch.sh racket /tmp/racket.sh
#
# Our own mirror is tried first (https://salishsea.io/downloads/<sha256>), then each
# upstream URL in the order the TSV gives them. A source counts only if its bytes
# match the pinned sha256; one that fails the checksum, refuses the connection, or
# stalls (under 10 kB/s for a minute) is skipped for the next, and the build fails
# only when none matched. The sha256 decides what is installed, never the host.
#
# Runs in the image build (debian:bookworm-slim, with bash and curl), and anywhere
# else with the same two tools.

set -euo pipefail

name=${1:?usage: fetch.sh <name> <dest>}
dest=${2:?usage: fetch.sh <name> <dest>}
tsv="$(dirname "${BASH_SOURCE[0]}")/downloads.tsv"
mirror=https://salishsea.io/downloads

line=$(grep -v '^#' "$tsv" | awk -v n="$name" '$1 == n')
if [[ -z "$line" ]]; then
    echo "fetch.sh: $name is not in $tsv" >&2
    exit 2
fi
# shellcheck disable=SC2086 # the line is whitespace-separated on purpose
set -- $line
sha=$2
shift 2

for url in "$mirror/$sha" "$@"; do
    if curl -fsSL --connect-timeout 20 --speed-limit 10000 --speed-time 60 -o "$dest" "$url" \
        && echo "$sha  $dest" | sha256sum -c - > /dev/null 2>&1; then
        echo "fetch.sh: $name from $url"
        exit 0
    fi
    echo "fetch.sh: $name: $url failed or did not match $sha; trying the next" >&2
done

echo "fetch.sh: $name: no source gave a file matching $sha" >&2
exit 1
