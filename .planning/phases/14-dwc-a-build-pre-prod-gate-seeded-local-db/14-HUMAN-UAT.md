---
status: passed
phase: 14-dwc-a-build-pre-prod-gate-seeded-local-db
source: [14-VERIFICATION.md]
started: 2026-06-22
updated: 2026-06-22
---

## Current Test

[complete — gate confirmed green on a real CI runner]

## Tests

### 1. First real PR CI run exercises the seeded gate on ubuntu-latest
expected: On the first PR after this phase merges, the `build` job's `Apply CI seed fixture` step runs `psql ... -f supabase/ci-seed.sql` successfully on the GitHub Actions ubuntu-latest runner (psql is preinstalled), the fixture applies clean, and the `Run tests` step shows `build.test.ts` ACTIVATED (not skipped) with the DWCA-01..04/06 assertions passing. This is a confirmatory observation — all checks already pass locally (7/7 must-haves; full seeded `npm test` green: 20 files / 197 tests). The only thing not yet exercised is the real runner's psql availability + the live `supabase db start` → fixture → seeded-suite flow end-to-end in CI.

result: PASSED — PR #278, Build run 27929938027 (2026-06-22): every step green end-to-end on ubuntu-latest — `supabase db start` ✓, `Apply CI seed fixture` (psql) ✓, gen-types ✓, build ✓, `Run tests` (build.test.ts ACTIVATED, seeded suite) ✓, infra tests ✓. NOTE: a pre-existing stale `database.types.ts` (phases 9-10 schema drift, never regenerated) blocked the gen-types step on the first attempt; fixed by regenerating `database.types.ts` on the PR branch (a 4th file, separate from the 3 gate files). The gate's psql fixture-apply was confirmed working even on that first (otherwise-red) run.

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
