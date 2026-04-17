# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Link Shareability

**Shipped:** 2026-04-17
**Phases:** 2 | **Plans:** 7 | **Tasks:** 12

### What Was Built
- Copy-link button on occurrence summary cards producing clean `?o=<id>` URLs (no extra params), visible to all visitors regardless of login state
- Deep-link hydration on page load: sets date from occurrence's `observed_at` and centers map, with no browser history pollution
- Lambda@Edge viewer-request handler for bot detection and OG tag generation, fetching Supabase occurrence data with SSM-cached credentials
- CDK infrastructure stack: CloudFront + Lambda@Edge VIEWER_REQUEST, deployed to production replacing the previous static distribution
- Static branded fallback preview image for occurrences without openly-licensed photos

### What Worked
- TDD Wave 0 scaffold (plan 02-01 writing all tests in RED before implementation) caught multiple behavior specification issues early — license list, description format, missing OG fields
- GSD atomic commit discipline made the production deploy debugging (timeout, SSM key retention) straightforward to bisect
- Reusing the existing `VITE_SUPABASE_KEY` GitHub Actions secret rather than adding a new one kept the deploy workflow simple
- `fail-open` design for the Lambda@Edge handler (pass-through on any error) meant production never served 500s during rollout

### What Was Inefficient
- Infrastructure approach (Lambda@Edge vs CloudFront Functions) required research to resolve before Phase 2 could be planned — could have been investigated during Phase 1 in parallel
- Brief DNS outage during production cutover (had to delete old distribution before CDK could claim the alias) — a staged alias transfer would have been cleaner
- CDK upgrade required mid-phase (schema version mismatch) added unplanned friction to the deploy plan

### Patterns Established
- `buildShareUrl`: build share URLs from `origin + pathname` (not `href`) to strip existing query params
- History-safe hydration: bypass Lit property setters to avoid triggering `setQueryParams` side-effects during deep-link load
- `skipEvent: true` on `setView` prevents map-move handler from writing position to URL history
- Lambda@Edge SSM credential caching at module scope — one SSM call per cold start, verified by unit test
- Icon export pattern: `export const fooIcon = svg\`<path d='...'/>\`` from `icons.ts`, wrapped with `<svg>` at call site

### Key Lessons
1. CDK cannot create SSM SecureString values — use a placeholder at synth time and set the real value post-deploy via AWS Console or a separate `aws ssm put-parameter` command
2. `cloudfront.experimental.EdgeFunction` (not `lambda.Function`) is required for Lambda@Edge; regular Lambda functions can't be attached to CloudFront viewer-request events
3. AWS does not allow two CloudFront distributions to share a domain alias — plan for a brief outage or use a staged DNS handoff when replacing a distribution

### Cost Observations
- Model mix: ~100% sonnet (no opus or haiku sessions observed)
- Sessions: ~6 sessions across 44 days (most work clustered in two bursts: Phase 1 on 2026-03-04, Phase 2 on 2026-04-17)
- Notable: Phase 2 infra work required multiple fix commits post-deploy (timeout, SSM key retention, bot UA matching) — integration testing before deploy would have caught these

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~6 | 2 | First milestone — baseline established |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 15 unit + 2 E2E smoke | partial | 0 |

### Top Lessons (Verified Across Milestones)

1. TDD Wave 0 scaffolds (RED before implementation) surface behavior specification gaps before any code is written
2. Fail-open error handling in infrastructure handlers prevents production outages during rollout
