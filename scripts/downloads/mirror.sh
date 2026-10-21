#!/usr/bin/env bash
# Put every file fly/downloads.tsv pins into our mirror, the salishsea-io-downloads
# bucket, keyed by its sha256 (decision 084):
#
#   scripts/downloads/mirror.sh            # with the orcasound AWS profile
#   AWS_PROFILE=other scripts/downloads/mirror.sh
#
# Each file is fetched from its upstream URL, checked against the pinned sha256, and
# uploaded as downloads/<sha256>, which CloudFront serves at
# https://salishsea.io/downloads/<sha256>, the first place fly/fetch.sh looks. A file
# the bucket already holds is skipped: an object's key is its content, so there is
# never anything to update, only to add. Run it after changing a pin in the TSV, or
# after moving fly/stelis-commit: Racket is pinned in Stelis's racket-downloads.tsv
# (the same format), read here at that commit, so the bucket holds the Racket its
# install script asks this mirror for.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
tsv=fly/downloads.tsv
bucket=salishsea-io-downloads
profile=${AWS_PROFILE:-orcasound}

[[ -r "$tsv" ]] || { echo "mirror.sh: cannot read $tsv" >&2; exit 2; }
tmp=$(mktemp)
stelis_tsv=$(mktemp)
trap 'rm -f "$tmp" "$stelis_tsv"' EXIT
stelis_sha=$(tr -d '[:space:]' < fly/stelis-commit)
curl -fsSL -o "$stelis_tsv" "https://raw.githubusercontent.com/rainhead/stelis/$stelis_sha/racket-downloads.tsv" \
    || { echo "mirror.sh: cannot read Stelis $stelis_sha's racket-downloads.tsv" >&2; exit 1; }

failed=0
while read -r name sha urls; do
    [[ -z "$name" || "$name" == \#* ]] && continue
    key="downloads/$sha"
    if aws s3api head-object --bucket "$bucket" --key "$key" --profile "$profile" > /dev/null 2>&1; then
        echo "$name: already mirrored ($sha)"
        continue
    fi
    got=
    for url in $urls; do
        if curl -fsSL --connect-timeout 20 --speed-limit 10000 --speed-time 60 -o "$tmp" "$url" \
            && echo "$sha  $tmp" | sha256sum -c - > /dev/null 2>&1; then
            got=$url
            break
        fi
        echo "$name: $url failed or did not match $sha; trying the next" >&2
    done
    if [[ -z "$got" ]]; then
        echo "$name: no upstream gave a file matching $sha; not mirrored" >&2
        failed=1
        continue
    fi
    aws s3 cp "$tmp" "s3://$bucket/$key" --profile "$profile" --only-show-errors \
        --content-type application/octet-stream \
        --metadata "name=$name,source=$got"
    echo "$name: mirrored from $got"
done < <(cat "$tsv" "$stelis_tsv")

exit $failed
