# Phase 14: DwC-A Build Pre-Prod Gate (Seeded Local DB) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 14-dwc-a-build-pre-prod-gate-seeded-local-db
**Areas discussed:** CI job placement, Seed fixture & live-API seed, Fixture scope

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| CI job placement | Extend build.yml vs. dedicated new job | ✓ |
| Seed fixture & live-API seed | Where the deterministic fixture lives; what to do about the live-fetch seed.sql | ✓ |
| Fixture scope | How representative the fixture must be; ROW_FLOOR vs 1000+ rows | ✓ |
| Regression proof | One-time manual red-test vs permanent committed negative check | |

---

## CI job placement

| Option | Description | Selected |
|--------|-------------|----------|
| Extend build.yml | Add seed + export SUPABASE_DB_URL before the existing `npm test` step; reuses the already-running stack; part of existing required Build check | ✓ |
| New dedicated job | Separate workflow/job with its own stack; isolates timing/failures at the cost of a second `supabase db start` | |

**User's choice:** Extend build.yml
**Notes:** build.yml already runs `supabase db start` + `npm test` on every PR — the suite skips only because SUPABASE_DB_URL isn't exported.

### Gate scope (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| build.test.ts only | Build + artifact introspection (DWCA-01..04/06); guard.ts stays nightly-only; ROW_FLOOR untouched | ✓ |
| build.test.ts + guard.ts | Also run guard floor checks; requires ROW_FLOOR env override | |

**User's choice:** build.test.ts only
**Notes:** Retires draft SC#2 (no need to fabricate 1000+ rows).

---

## Seed fixture & live-API seed

| Option | Description | Selected |
|--------|-------------|----------|
| CI-only seed, leave seed.sql alone | Keep live-fetch seed.sql for local dev; apply a dedicated static CI fixture explicitly; two seed paths | ✓ |
| Static fixture in seed.sql | Replace live fetches with static INSERTs; single deterministic path; local devs lose auto-fetched live sample | |
| Static fixture + keep live as opt-in | Static baseline in seed.sql; relocate live fetches to a separate opt-in script | |

**User's choice:** CI-only seed, leave seed.sql alone
**Notes:** Discovered during discussion — reference tables (providers/orgs/collections) are seeded by migration `20260619184037`, so they exist in CI automatically; the fixture only adds source rows referencing them.

---

## Fixture scope

| Option | Description | Selected |
|--------|-------------|----------|
| Branch-covering minimal | Smallest fixture that passes the suite AND exercises trust/tagging/collection branches + ≥1 multimedia row | ✓ |
| Bare minimum | Just enough to make views non-empty; doesn't deliberately cover branches | |
| Broad coverage | Every conditional in build.ts queries; highest maintenance burden | |

**User's choice:** Branch-covering minimal
**Notes:** Export scope is native + Maplify only (SRC-01).

---

## Claude's Discretion

- **Regression-proof (draft SC#4)** — not selected for discussion. Default: one-time
  manual red-test during execute (revert `aad63dd`, confirm gate red, restore), preferred
  over a permanent committed negative test. Planner may adjust.
- **Exact CI wiring** (step ordering, env scoping, psql invocation) left to the planner.

## Deferred Ideas

- Running `guard.ts` floor checks as part of PR CI — deferred; nightly-only.
- A permanent committed negative/regression test — deferred in favor of the manual red-test.
