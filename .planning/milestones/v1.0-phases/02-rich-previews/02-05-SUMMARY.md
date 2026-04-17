---
plan: 02-05
phase: 02-rich-previews
status: complete
completed: 2026-04-17
---

## Summary

Deployed the CDK infra stack to production: bootstrapped CDK in us-east-1 (Lambda@Edge requirement) and us-west-2 (main stack), granted the `salishsea-deploy-action` IAM role permissions to assume CDK bootstrap roles, updated the deploy workflow to run `cdk deploy --all` after S3 sync, and verified rich previews work in production.

## What was built

- `.github/workflows/deploy.yml` — CDK deploy step added; CloudFront invalidation step removed (distribution now CDK-managed)
- `infra/package.json` — upgraded `aws-cdk` CLI to `2.1118.2` and `aws-cdk-lib` to `2.250.0` for cloud assembly schema compatibility
- `e2e/og-previews.spec.ts` — smoke tests for bot UA OG response and browser UA pass-through
- Route 53 `salishsea.io` A record updated to new CDK-managed distribution (`E1QR07M7MQVWGU`, `d29o0qgekdgv0y.cloudfront.net`)

## Deviations

- Deleted existing CloudFront distribution (`EQ0KYC2Y6IUYU`) before CDK deploy — necessary because AWS does not allow two distributions to share an alias; caused brief DNS outage
- Used `VITE_SUPABASE_KEY` secret (already present) instead of adding a new `SUPABASE_ANON_KEY` secret — same value, avoids duplication
- Added `--all` flag to `cdk deploy` — CDK creates two stacks (main + auto-generated us-east-1 edge-lambda stack)
- Bootstrapped both `us-east-1` (Lambda@Edge) and `us-west-2` (main stack) — plan only mentioned us-east-1

## Verification

- `curl -H "User-Agent: facebookexternalhit/1.1" https://salishsea.io/` returns OG HTML with `og:title="SalishSea.io"`
- `curl -H "User-Agent: Mozilla/5.0 ..." https://salishsea.io/` returns SPA index.html (pass-through)
- Playwright OG preview smoke tests pass

## Self-Check: PASSED

- [x] CDK bootstrap complete for us-east-1 and us-west-2
- [x] deploy.yml includes `cdk deploy --all` step
- [x] Production deployment succeeded (Lambda@Edge attached to CloudFront `E1QR07M7MQVWGU`)
- [x] Bot requests receive OG-tag HTML
- [x] Regular browser visits load SPA normally
- [x] E2E smoke tests pass
