---
phase: 07-nightly-workflow-hosting
plan: "02"
subsystem: infra/lambda-edge
tags: [phase-07, lambda-edge, cloudfront, og-meta, carve-out, jest, infra-deploy-gate]

requires:
  - Plan 07-01 (OIDC + CDK pipeline assumed healthy)

provides:
  - "L-01 Lambda@Edge /dwca/* carve-out — handler returns request unmodified before the bot-UA branch for all /dwca/* URIs"
  - "L-01 Lambda@Edge /dwca/* carve-out deployed to production CloudFront — Plan 07-03 is unblocked (pending Task 2 human-verify)"

affects:
  - "Plan 07-03 (V-01 smoke check now safe to run once Task 2 confirms deploy)"

tech-stack:
  added: []
  patterns:
    - "Path-prefix early-return at the top of a multi-branch Lambda@Edge handler — same pattern as a Connect/Express middleware short-circuit"

key-files:
  modified:
    - infra/lib/edge-handler/index.ts
    - infra/lib/edge-handler/index.test.ts

key-decisions:
  - "L-01 uses `request.uri.startsWith('/dwca/')` (not regex, not includes) — path is fully under our control (CONTEXT specifics). Trailing slash ensures /dwca (sans slash) continues to the OG-meta branch (documented inline)."
  - "3-line braced if-block with blank line separators per existing file style — not a 1-line ternary."
  - "makeEvent helper extended with optional uri parameter (default '') so all 10 existing call sites are unchanged."
  - "Task 2 human-verify curl output (confirming carve-out live on prod CloudFront) pending — plan paused at checkpoint."

patterns-established:
  - "All Lambda@Edge path-specific bypasses go at the very top of handler() before any header reads — prevents accidental side-effects from UA-sniff or SSM fetch paths."

requirements-completed:
  - "EXPORT-02 (partial — Lambda@Edge prerequisite shipped; full close requires Plan 07-03 to publish + smoke-check the stable URL)"
---

# Phase 7 Plan 02: L-01 Lambda@Edge `/dwca/*` Carve-Out Summary

**One-liner:** Lambda@Edge OG-meta handler gains a path-prefix early-return for `/dwca/*` binary downloads, preventing bot UAs from receiving synthesized HTML instead of the archive.

## What Was Built

Added a 3-line path-gate at the top of the `handler` export in `infra/lib/edge-handler/index.ts`, immediately after `const request = event.Records[0].cf.request;` and before the `const ua = ...` line. The gate is:

```ts
if (request.uri.startsWith('/dwca/')) {
  return request;
}
```

A 2-line comment explains the rationale and cross-references CONTEXT §L-01.

The Jest suite was extended with 5 new tests in a `'L-01 carve-out: /dwca/* path-gate'` describe block:

1. Bot UA (`facebookexternalhit/1.1`) + `/dwca/*.zip` → pass-through, fetch not called
2. Non-bot UA (`Mozilla/5.0`) + `/dwca/*.zip` → pass-through
3. Bot UA (`twitterbot/1.0`) + `/dwca/*.zip` + querystring `foo=bar` → pass-through, fetch not called
4. Bot UA (`slackbot/1.0`) + `/dwca/*.parquet` → pass-through (guards against hardcoded filename)
5. Bot UA (`facebookexternalhit/1.1`) + `/observation/dwca/x` → OG-meta HTML returned (proves `startsWith` not `includes`)

All 15 tests pass (10 pre-existing + 5 new). TypeScript compiles clean.

## Status

**Task 1:** COMPLETE — committed `0fbec49`
**Task 2:** PAUSED at checkpoint — awaiting human verification that `deploy.yml` ran successfully and the new Lambda@Edge version has replicated to production CloudFront.

## Commits

| Task | Hash    | Message                                                     |
|------|---------|-------------------------------------------------------------|
| 1    | 0fbec49 | feat(07-02): add L-01 /dwca/* carve-out to Lambda@Edge handler |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `infra/lib/edge-handler/index.ts` contains `request.uri.startsWith('/dwca/')`: confirmed (grep count = 1)
- Carve-out appears before `const ua = request.headers`: confirmed (awk check returned "ok")
- `infra/lib/edge-handler/index.test.ts` contains L-01 describe block: confirmed (grep count = 1)
- 15 `it(` invocations in test file: confirmed
- Jest: 15/15 passed
- tsc --noEmit: clean
- No .github/workflows/ changes: confirmed (0 modified files)
- No infra-stack.ts changes: confirmed (0 modified files)
- Commit `0fbec49` exists: confirmed
