#!/usr/bin/env bash
# Put this checkout's site on dev.salishsea.io (decision 072): build it as the Fly app's
# image does, to read the read-path build's files and write through the API, then sync it
# to the dev bucket and invalidate the dev distribution. The data it shows is production's:
# CloudFront passes /read-path/*, /status/*, /dwca/* and GET /api/* to the Fly app. It
# cannot write, and it has no profile pages.
#
#   scripts/deploy-dev.sh
#
# Builds whatever is checked out, uncommitted changes included; release.json names HEAD.
# Sentry files its errors under the environment "dev", not "production".
# Needs AWS credentials (AWS_PROFILE, default orcasound).
set -euo pipefail
cd "$(dirname "$0")/.."

export AWS_PROFILE=${AWS_PROFILE:-orcasound}
BUCKET=salishsea-io-dev-site # DEV_SITE_BUCKET_NAME in infra/lib/infra-stack.ts

DIST=$(aws cloudformation describe-stacks --region us-west-2 --stack-name InfraStack \
    --query "Stacks[0].Outputs[?OutputKey=='DevDistributionId'].OutputValue" --output text)
if [ -z "$DIST" ] || [ "$DIST" = None ]; then
    echo "InfraStack has no DevDistributionId output: has the stack been deployed since decision 072?" >&2
    exit 1
fi

pnpm exec tsc
pnpm exec vite build --mode dev
pnpm exec html-validate 'dist/**/*.html'

aws s3 sync dist "s3://$BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' \
    --query 'Invalidation.Id' --output text
echo "https://dev.salishsea.io/ — live once the invalidation finishes, usually within a minute"
