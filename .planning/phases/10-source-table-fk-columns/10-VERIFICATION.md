---
phase: 10-source-table-fk-columns
verified: 2026-06-19T21:00:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 10: Source Table FK Columns Verification Report

**Phase Goal:** Every source table carries nullable `provider_id`, `collection_id`, `contributor_id`, and `source_url` columns — ready to receive backfill, with `collection_id` indexed on the two exported tables. (4 success criteria in ROADMAP § Phase 10.)
**Verified:** 2026-06-19T21:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Step 0: Previous Verification

None found. Initial verification mode.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All four source tables carry provider_id, collection_id, contributor_id, source_url | VERIFIED | `information_schema.columns` query returns 16 rows (4 columns × 4 tables); assertion SC#1 passes |
| 2 | provider_id is NOT NULL on all four tables (D-05 intentional deviation); collection_id and contributor_id are nullable | VERIFIED | `is_nullable='NO'` for provider_id, `'YES'` for collection_id and contributor_id on all four tables; SC#1 DO block passes |
| 3 | native contributor_id relaxed from NOT NULL to nullable (D-11); FK and ON DELETE CASCADE intact | VERIFIED | `information_schema.columns` shows `is_nullable='YES'` for `public.observations.contributor_id`; migration uses `ALTER COLUMN contributor_id DROP NOT NULL` not DROP COLUMN |
| 4 | collection_id indexed on public.observations and maplify.sightings only | VERIFIED | `pg_indexes` shows `observations_collection_id` and `sightings_collection_id` (partial btree WHERE IS NOT NULL); zero collection_id indexes on inaturalist/happywhale; SC#2 passes |
| 5 | native source_url equals url where url is not null; iNat source_url equals uri for every row | VERIFIED | 0 mismatches in both spot-check queries; SC#3 passes; iNat: 200/200 rows with source_url populated |
| 6 | HappyWhale source_url is GENERATED in repo-canonical form (individual_id + ';enc=' + id); no /encounter/ form | VERIFIED | `generation_expression` in catalog: `((('https://happywhale.com/individual/'::text \|\| individual_id) \|\| ';enc='::text) \|\| id)`; grep confirms no `/encounter/` in migration; B&S #2 passes |
| 7 | New Maplify insert with NULL collection_id succeeds; provider_id DEFAULT applied; row count unchanged after DELETE | VERIFIED | SC#4 DO block passes: defaulted=2 (not NULL), collection_id=NULL, before/after count match |
| 8 | Assertion snippet (SC#1-SC#4 + belt-and-suspenders) exits 0 on the live local DB | VERIFIED | `psql ... -f supabase/snippets/10_fk_columns_assertions.sql` exits 0; all 6 echo lines printed including `=== All Phase 10 assertions passed ===` |

**Score:** 8/8 truths verified

### D-05 Deviation Note

ROADMAP SC#1 says "all are nullable." The implementation makes `provider_id` NOT NULL. This is an intentional, documented deviation approved in CONTEXT.md (D-05) and carried explicitly into PLAN.md `must_haves.truths` #2. The PLAN's must_haves are the execution contract — they captured the user's approved decision to strengthen the constraint. The deviation is correctly flagged in the migration header comment, the assertion snippet, and the SUMMARY. Verification accepts this as a documented intentional deviation, not a gap.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260619203013_source_table_fk_columns.sql` | Additive FK-column migration for all four source tables | VERIFIED | 180 lines; contains `GENERATED ALWAYS AS (url) STORED`, `GENERATED ALWAYS AS (uri) STORED`, repo-canonical HW GENERATED expression, 4x `SET DEFAULT %s`, `DROP NOT NULL`, no `/encounter/`, no GRANT/REVOKE/policy |
| `supabase/snippets/10_fk_columns_assertions.sql` | SC#1-SC#4 psql assertion gate | VERIFIED | 231 lines; contains `RAISE EXCEPTION` per criterion; references `individual/` URL form; SC#4 insert/delete/count pattern; exits 0 on live DB |

### Level 2 (Substantive) Check

**Migration:** 180 lines, well above 60-line minimum. Contains all required structural elements: four per-table blocks, `GENERATED ALWAYS AS` on native/iNat/HW, plain `TEXT` on maplify, 4x `DO $$ BEGIN EXECUTE format(...SET DEFAULT %s...) END $$`, `ALTER COLUMN contributor_id DROP NOT NULL`, two partial btree indexes.

**Assertion snippet:** 231 lines, well above 40-line minimum. Contains four `DO $$ ... $$` blocks with `RAISE EXCEPTION` in each. SC#4 performs transactional insert/assert/delete with count verification. B&S blocks check all-four-table provider_id NULL counts and HW URL shape.

### Level 3 (Wired) Check

Both artifacts are wired into the Supabase migration chain (`supabase db reset` applies the migration in timestamp order after Phase 9). The snippet consumes the live DB state produced by the migration. No orphaned files.

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| migration provider_id backfill | public.providers.slug | `UPDATE ... FROM public.providers p WHERE p.slug = '<slug>'` | VERIFIED | All four UPDATE statements confirmed in migration; zero NULL provider_id rows post-reset (B&S #1 passes) |
| migration provider_id DEFAULT | public.providers.id resolved at migration time | `DO $$ EXECUTE format('... SET DEFAULT %s', (SELECT id FROM public.providers WHERE slug=...)) $$` | VERIFIED | DEFAULT values confirmed: direct=1, maplify=2, inaturalist=3, happywhale=4; never a hardcoded literal in source |
| happywhale.encounters.source_url | individual_id + id | `GENERATED ALWAYS AS ('https://happywhale.com/individual/' \|\| individual_id \|\| ';enc=' \|\| id) STORED` | VERIFIED | `generation_expression` in pg catalog confirms the expression; B&S #2 shape check passes |

---

## Data-Flow Trace (Level 4)

All four source_url columns are GENERATED or plain-NULL (not dynamic fetch targets). Provider_id values flow from the migration's slug-join UPDATE, confirmed zero NULLs. No rendering or fetch-based data path — this is a pure schema phase. Level 4 does not apply.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SC#1: all 16 column/nullability combos correct | `information_schema.columns` query | 16 rows returned, all nullabilities match | PASS |
| SC#2: two partial btree indexes on exported tables only | `pg_indexes` query | `observations_collection_id` + `sightings_collection_id` found; 0 on inat/hw | PASS |
| SC#3: source_url consistency (native 0 rows, iNat 200/200 populated) | `IS DISTINCT FROM` count queries | 0 mismatches on both tables | PASS |
| SC#4: maplify insert with NULL collection_id succeeds + count restored | assertion DO block | defaulted provider_id=2, collection_id=NULL, before=after count | PASS |
| Regression: Phase 5 DwC assertions | `psql ... -f supabase/snippets/05_dwc_assertions.sql` | `=== All assertions passed ===` | PASS |
| Regression: Phase 9 reference assertions | `psql ... -f supabase/snippets/09_reference_assertions.sql` | `=== All Phase 9 assertions passed ===` | PASS |

---

## Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `supabase/snippets/10_fk_columns_assertions.sql` | `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/snippets/10_fk_columns_assertions.sql` | exit 0; all 6 echo lines printed | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LINK-01 | 10-01-PLAN.md | Each source schema's records carry nullable provider_id, collection_id, contributor_id, and source_url columns; collection_id is indexed | SATISFIED | All 16 columns confirmed in `information_schema.columns`; provider_id intentionally NOT NULL (D-05, approved deviation); 2 partial btree collection_id indexes confirmed |
| LINK-02 | 10-01-PLAN.md | Records inserted after deploy resolve a collection_id; NOT NULL applied only after backfill completes (nullable → backfill → constrain) | SATISFIED (Phase 10 scope) | collection_id nullable on all four tables (no premature NOT NULL); SC#4 proves new maplify insert with NULL collection_id succeeds; provider_id DEFAULT covers forward-population without RPC edits; full collection_id resolution is Phase 11 resolver work (RESOLVE-01/04) |
| LINK-03 | 10-01-PLAN.md | source_url populated from each provider's existing record URL where available (iNaturalist uri, native url) | SATISFIED | native: GENERATED ALWAYS AS (url); iNat: GENERATED ALWAYS AS (uri); 200/200 iNat rows source_url populated; SC#3 passes |

### Orphaned Requirements Check

REQUIREMENTS.md maps LINK-01, LINK-02, LINK-03 to Phase 10 — all three are claimed by 10-01-PLAN.md. No orphaned requirements.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found in either artifact |

No stub or placeholder patterns found. Both artifacts are fully substantive implementations.

---

## Human Verification Required

### 1. HappyWhale source_url resolves to a real viewable page (prod only)

**Test:** After production deploy, pick one `happywhale.encounters` row with a non-null `source_url` and open it in a browser.
**Expected:** The URL `https://happywhale.com/individual/{individual_id};enc={id}` opens the correct HappyWhale encounter page.
**Why human:** Local HW table has 0 rows (trivially satisfied); the repo-canonical URL form comes from 15+ codebase precedents, not live URL verification. The URL structure must be confirmed against the live HappyWhale website after production deploy.

(Source: 10-VALIDATION.md § Manual-Only Verifications)

---

## Gaps Summary

No gaps. All 8 must-have truths are verified, all required artifacts are substantive and wired, all three requirement IDs are satisfied, no anti-patterns found. The one human verification item (HW URL live check) is a post-deploy spot-check flagged in the original VALIDATION.md — it does not block phase completion.

The single structural deviation (provider_id NOT NULL vs. ROADMAP SC#1 "all nullable") is a documented, user-approved decision (CONTEXT.md D-05) carried explicitly into the PLAN must_haves and migration header. It does not constitute a gap.

---

_Verified: 2026-06-19T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
