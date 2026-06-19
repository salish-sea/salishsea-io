---
phase: 11
slug: resolution-backfill
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-19
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing, `vitest.config.ts`) + psql SQL assertions |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- scripts/ingest/` |
| **Full suite command** | `npm test` |
| **SQL assertions** | `supabase db reset && psql "$LOCAL_DSN" -f supabase/snippets/11_resolution_assertions.sql` |
| **Estimated runtime** | ~30 seconds (vitest) + ~20 seconds (db reset + psql) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (vitest) and, for SQL tasks, `supabase db reset && psql -f supabase/snippets/11_resolution_assertions.sql`
- **After every plan wave:** Run `npm test` (full) + full SQL assertion snippet
- **Before `/gsd-verify-work`:** All local assertions green; SC#1 prod count verified read-only against prod
- **Max feedback latency:** ~50 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-xx | TS | 1 | RESOLVE-01 | — | resolver returns {provider,collection} for known patterns; null for unknown | unit | `npm test -- resolve-provider` | ❌ W0 | ⬜ pending |
| 11-xx | SQL | 1 | RESOLVE-02 | T-11-01 (RLS on mint) | `resolve_collection` returns correct id for bracket/attribution/source; NULL for unrecognized | SQL (local) | `psql -f supabase/snippets/11_resolution_assertions.sql` | ❌ W0 | ⬜ pending |
| 11-xx | SQL | 2 | RESOLVE-03 | — | SC#2 comments type unchanged; SC#3 Trusted-Observer rows NULL contributor_id; SC#4 iNat/native provider+collection set | SQL (local) | `psql -f supabase/snippets/11_resolution_assertions.sql` | ❌ W0 | ⬜ pending |
| 11-xx | SQL | 2 | RESOLVE-03 | — | SC#1 bracket-tagged rows have collection_id (prod) | manual SQL (prod) | `psql "$PROD_DSN" -c '...'` | ❌ W0 | ⬜ pending |
| 11-xx | SQL | 2 | RESOLVE-04 | — | SC#5 `update_sightings` produces collection_id for known tags (synthetic insert) | SQL (local, synthetic) | `psql -f supabase/snippets/11_resolution_assertions.sql` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/ingest/resolve-provider.ts` — new file; pure URL-pattern resolver (RESOLVE-01)
- [ ] `scripts/ingest/resolve-provider.test.ts` — new file; vitest unit tests (mirror `scripts/dwca/*.test.ts` conventions)
- [ ] `supabase/snippets/11_resolution_assertions.sql` — new file; SQL smoke tests covering SC#1–SC#5 + the D-08 diff-gate (mirror `09_*` / `10_*` precedents)
- [ ] `.planning/phases/11-resolution-backfill/maplify_census.tsv` — prod census artifact; MUST be produced before `collection_rule` seed rows are written

*Note: prod data is NOT present on local `supabase db reset`, so row-level backfill assertions (SC#1) are manual-only against prod; local assertions prove function/rule/DEFAULT existence + synthetic-row resolution.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC#1: every non-empty-bracket-tagged Maplify row has collection_id | RESOLVE-03 | Prod data not present locally; backfill UPDATE is a no-op on local reset | Read-only `psql "$PROD_DSN" -c "SELECT COUNT(*) FROM maplify.sightings WHERE comments ~ '^\[[^\]]+\]' AND collection_id IS NULL"` → expect 0 |
| Acronym → collection expansions (PSWS, MCW, CWW, WSSJI, HIWS, SBW, WA, SSCH, SA, PSWW, Bremerton) | RESOLVE-02 | Community-specific knowledge; LOW-confidence from training data | `checkpoint:human-verify` task: operator confirms each expansion against the prod census before `collection_rule` seed is written |

*Census-first: the prod `SELECT DISTINCT` census drives the dictionary; diff-gate assertion fails if any prod tag/attribution/source code is uncovered.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
