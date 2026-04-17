---
phase: 02-rich-previews
plan: 04
subsystem: infra
tags: [cdk, cloudfront, lambda-edge, ssm, iam, s3, acm, typescript]

# Dependency graph
requires:
  - 02-01  # Failing CDK assertion tests (RED state) created by plan 01
  - 02-02  # Lambda@Edge handler at infra/lib/edge-handler/index.ts
provides:
  - "InfraStack CDK construct: CloudFront Distribution + Lambda@Edge VIEWER_REQUEST + SSM params + IAM"
  - "infra/lib/infra-stack.ts fully wired and synthesizable"
  - "All 3 CDK assertion tests GREEN"
affects:
  - deploy workflow — stack can now be deployed with cdk deploy

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "EdgeFunction via cloudfront.experimental.EdgeFunction — auto-provisions in us-east-1 regardless of stack region"
    - "S3BucketOrigin.withOriginAccessControl for imported (not created) S3 bucket"
    - "SSM parameters provisioned in CDK; anon key value injected via --context supabaseAnonKey at deploy time"
    - "IAM policy scoped to arn:aws:ssm:us-east-1:ACCOUNT:parameter/salishsea/* for Lambda@Edge cross-region read"

key-files:
  created: []
  modified:
    - "infra/lib/infra-stack.ts"
    - "infra/bin/infra.ts"
    - "infra/lib/edge-handler/index.ts"

key-decisions:
  - "Use cloudfront.experimental.EdgeFunction (not lambda.Function) — required for Lambda@Edge to run in us-east-1"
  - "S3BucketOrigin.withOriginAccessControl auto-creates OAC; existing prod OAC ID EKU351HBDSMHW is reference-only"
  - "supabaseAnonKey supplied via CDK context at deploy time; placeholder used in CDK test synthesis"
  - "IAM grant targets us-east-1 explicitly — Lambda@Edge reads SSM from us-east-1"

requirements-completed: [PREV-03]

# Metrics
duration: ~10min
completed: 2026-04-17
---

# Phase 2 Plan 04: CDK Stack Wiring Summary

**CDK InfraStack fully wired with CloudFront Distribution, Lambda@Edge VIEWER_REQUEST trigger (NODEJS_22_X), SSM credential parameters, and IAM read grant — all 3 CDK assertion tests GREEN**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-04-17
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Replaced skeleton `infra/lib/infra-stack.ts` with full CDK stack: `cloudfront.experimental.EdgeFunction`, `cloudfront.Distribution` with VIEWER_REQUEST association, SSM parameters for Supabase credentials, IAM `ssm:GetParameter` grant
- Distribution reconstructed to match production: S3 origin `/site`, salishsea.io alias, ACM cert, CachingOptimized policy, HTTPS redirect, HTTP2_AND_3
- Added deploy instructions comment to `infra/bin/infra.ts` documenting `--context supabaseAnonKey` and us-east-1 bootstrap requirement
- All 13 tests pass: 3 CDK assertion tests + 10 edge-handler unit tests

## Task Commits

1. **Task 1: Implement InfraStack with CloudFront, Lambda@Edge, SSM, and IAM** — `22f5246` (feat)
2. **Task 2: Update CDK bin/infra.ts with environment context** — `a9a5e74` (docs)

## Files Created/Modified

- `infra/lib/infra-stack.ts` — Full CDK stack with EdgeFunction, Distribution, SSM params, IAM grant
- `infra/bin/infra.ts` — Deploy instructions comment added
- `infra/lib/edge-handler/index.ts` — Pre-existing TS2322 type error fixed (Rule 1)

## Decisions Made

- `cloudfront.experimental.EdgeFunction` used instead of `lambda.Function` — required for Lambda@Edge to be deployed to us-east-1 automatically; regular `lambda.Function` would not satisfy CloudFront's requirement
- `S3BucketOrigin.withOriginAccessControl` used (static factory pattern) rather than the constructor with `originAccessControlId` — the CDK API does not expose `originAccessControlId` as a constructor option; a new OAC is created and the existing prod OAC ID is for reference only
- SSM `supabaseAnonKey` uses `StringParameter` (not `CfnParameter` with SecureString type) with a placeholder — CDK cannot synthesize a SecureString with a real secret value; the actual secure value is set post-deploy via AWS Console or passed via `--context`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing TypeScript error in edge-handler/index.ts**
- **Found during:** Task 1 (TypeScript compile verification)
- **Issue:** `const occurrences: Occurrence[] = await res.json()` — `res.json()` returns `unknown` in newer TypeScript/fetch typings, causing TS2322 error
- **Fix:** Changed to `const occurrences = await res.json() as Occurrence[]`
- **Files modified:** infra/lib/edge-handler/index.ts
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** 22f5246 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for TypeScript compile to succeed. No scope creep.

## Issues Encountered

None beyond the pre-existing TypeScript error above.

## User Setup Required

Before deploying to production:
1. Bootstrap us-east-1: `cdk bootstrap aws://648183724555/us-east-1`
2. Deploy with anon key: `cdk deploy --context supabaseAnonKey=<SUPABASE_ANON_KEY>`
   - Or deploy without context and set `/salishsea/supabase-anon-key` manually in AWS SSM Console (SecureString)

## Next Phase Readiness

- CDK stack is synthesizable and deployable
- All CDK assertion tests and edge-handler unit tests pass
- Stack can be deployed to replace existing CloudFront distribution with Lambda@Edge viewer-request handler

## Known Stubs

None — the CDK stack is fully defined. The SSM parameter `/salishsea/supabase-anon-key` uses a placeholder value until deploy time; this is intentional per the CDK pattern for secrets.

## Threat Flags

None — no new network endpoints or auth paths beyond what the plan specifies. SSM parameters store existing Supabase credentials under tighter IAM scope (read-only, us-east-1 only).

## Self-Check: PASSED

- infra/lib/infra-stack.ts — FOUND
- infra/bin/infra.ts — FOUND
- infra/lib/edge-handler/index.ts — FOUND
- Commit 22f5246 (feat: InfraStack implementation) — FOUND
- Commit a9a5e74 (docs: deploy instructions) — FOUND
- All 13 tests pass — VERIFIED
