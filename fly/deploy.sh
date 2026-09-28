#!/usr/bin/env bash
# Deploy the salishsea-io Fly app from this checkout (salish-t3g.3), by hand until
# a workflow does it (salish-t3g.5).
#
#   STELIS_SHA=<commit> fly/deploy.sh
#
# The site's public client config is the AWS deploy's. The publishable key is
# read from the Supabase CLI rather than typed.
#
# The image builds on Fly's remote builder, which is fly deploy's default and the
# only builder that works: Racket CS won't run under Docker's x86_64 emulation on
# Apple silicon ("error reading from petite"), so a local build fails.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${STELIS_SHA:?set STELIS_SHA to the Stelis commit this image pins}"
if [ -n "$(git status --porcelain)" ]; then
    echo "refusing to deploy uncommitted work: the image would not match any commit" >&2
    exit 1
fi

REF=grztmjpzamcxlzecmqca
KEY=$(npx --yes supabase projects api-keys --project-ref "$REF" -o json \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=JSON.parse(s).find(k=>k.type==="publishable");if(!k)process.exit(1);process.stdout.write(k.api_key)})')

fly deploy --ha=false \
    --build-arg VITE_SUPABASE_URL="https://$REF.supabase.co" \
    --build-arg VITE_SUPABASE_WS_URL="wss://$REF.supabase.co" \
    --build-arg VITE_SUPABASE_KEY="$KEY" \
    --build-arg GITHUB_SHA="$(git rev-parse HEAD)" \
    --build-arg SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" \
    --build-arg STELIS_SHA="$STELIS_SHA"
