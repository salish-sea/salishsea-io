---
phase: 12-dwc-view-rebuild
verified: 2026-06-21T21:00:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 12: DwC View Rebuild Verification Report

**Phase Goal:** The `dwc.occurrences` view emits 26 columns with correct aggregator-pattern attribution — `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, per-collection `datasetName` — with SRC-01 exclusion preserved by construction, `npm test` green, and the nightly row-count guard in place.
**Verified:** 2026-06-21T21:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Prod Application Status

The migration `20260621000000_dwc_view_rebuild.sql` is **committed but not yet applied to prod**. Per the project's deploy model, pushing `main` triggers `.github/workflows/deploy.yml` which runs `supabase db push`. The live prod views still have 25 columns until that push. All Phase 12 SC assertions were validated by running the rebuilt view SQL **read-only** against prod data via `npx supabase db query --linked` (the same column/type parity check that CREATE VIEW enforces). Prod application + GBIF re-validation (ATTR-05) are Phase 13 scope. This is not a gap — it is the design of the project's deploy pipeline.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | dwc.occurrences emits exactly 26 columns | VERIFIED | Migration defines both branches with 26 columns; UNION ALL enforces parity at CREATE VIEW time; SC#4 assertion confirmed; `fields.test.ts` `toBe(26)` green |
| 2 | Every exported row has institutionCode = 'SalishSea' | VERIFIED | `'SalishSea'::text AS "institutionCode"` at ordinal 19 in both branch views; SC#1 read-only prod check: 0 deviating rows across 4,411 prod rows |
| 3 | Every exported row has rightsHolder = 'SalishSea.io' | VERIFIED | `'SalishSea.io'::text AS "rightsHolder"` at ordinal 20 in both branch views; SC#2 read-only prod check: 0 deviating rows |
| 4 | Every datasetName is prefixed 'SalishSea.io — ' and is non-NULL | VERIFIED | Native branch: plain JOIN `c_coll.name` (NOT NULL col); Maplify branch: LEFT JOIN + `COALESCE(c_coll.name, 'Whale Alert (Global)')`. SC#3 read-only prod: 0 NULL or wrong-prefix rows; 19 distinct datasetName values (≥10 gate) |
| 5 | SRC-01 exclusion (iNat/HappyWhale) preserved by construction | VERIFIED | `dwc.occurrences` is `SELECT * FROM dwc._native_occurrences UNION ALL SELECT * FROM dwc._maplify_occurrences` with no WHERE filter; exactly two branches, no third source possible (D-11); SC#5 ceiling 4,411 ≤ 4,876 holds |
| 6 | OCCURRENCE_FIELDS.length === 26; assertFieldAlignment confirms view parity; meta.xml declares 26 occurrence fields at correct ordinals | VERIFIED | `fields.ts` has 26-entry array; `institutionCode` at index 19 with `http://rs.tdwg.org/dwc/terms/institutionCode`; dcterms pair at {20, 23}; `meta-xml.test.ts` `toBe(32)` (26 occ + 6 multimedia); core index 19 institutionCode test; full suite 148 passed, 11 skipped, 0 failed |
| 7 | EML emits `<associatedParty role=contentProvider>` for each upstream org represented in the export; orgs appear as associatedParty, never as institutionCode | VERIFIED | `eml.ts` exports `AssociatedParty` interface, `EmlInput.associatedParties`; `buildEml` renders `<associatedParty>` block between `</metadataProvider>` and `<pubDate>`; `xmlEsc` applied to name and url; empty list produces no element; `eml.test.ts` tests: presence/placement/pubDate-before/coverage-before/empty/xmlEsc all green |
| 8 | Build pipeline queries orgs data-driven (only orgs with exported rows) and passes list into buildEml | VERIFIED | `build.ts` Step 15.5 runs DISTINCT org.name/org.url via `collections JOIN organizations` filtered to trusted-only Maplify UNION native rows, ORDER BY name; `AssociatedParty[]` passed into `buildEml({..., associatedParties})` at Step 17; read-only prod check: 5 represented orgs returned |
| 9 | Nightly row-count guard reads the rebuilt trusted-only view; npm test passes green | VERIFIED | `guard.ts` queries `COUNT(*) FROM pgdb.dwc.occurrences` with env-overridable `ROW_FLOOR=1000`; no code change needed — view name unchanged; trusted-only prod count 4,411 >> 1,000 floor; `vitest run` 16 files, 148 passed, 11 skipped (DSN-gated build.test.ts), 0 failed |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260621000000_dwc_view_rebuild.sql` | DROP+CREATE of three dwc occurrence views (26 cols) + dwc.datasets v1.3 bump | VERIFIED | DROP reverse-dependency order (occurrences→branches, no CASCADE); both branch views 26 cols; institutionCode at ordinal 19; rightsHolder/datasetName constants; Maplify trusted filter + regex recordedBy; UNION ALL; v1.3 title; no GRANT |
| `scripts/dwca/fields.ts` | 26-entry OCCURRENCE_FIELDS; institutionCode at index 19 | VERIFIED | Array length 26; `{ name: 'institutionCode', termUri: 'http://rs.tdwg.org/dwc/terms/institutionCode' }` at index 19; dcterms pair at indices 20/23 |
| `scripts/dwca/fields.test.ts` | Length toBe(26); index-19 institutionCode test; dcterms at {20,23} | VERIFIED | `toBe(26)` present; `OCCURRENCE_FIELDS[19]?.name === 'institutionCode'` test present; dcterms pair tests at indices 20 and 23 |
| `scripts/dwca/meta-xml.test.ts` | Total count toBe(32); core index-19 institutionCode; dcterms {20,23} | VERIFIED | `toBe(32)` at line 70; `pairs[19]` === institutionCode dwc/terms URI test at line 97; dcterms pair at pairs[20]/pairs[23] |
| `scripts/dwca/eml.ts` | AssociatedParty interface; EmlInput.associatedParties; `<associatedParty>` rendering with xmlEsc; v1.3 title in mock | VERIFIED | `AssociatedParty` interface exported; `EmlInput.associatedParties: readonly AssociatedParty[]`; `associatedPartyXml` computed via `.map().join()`; interpolated after `</metadataProvider>` before `<pubDate>` |
| `scripts/dwca/eml.test.ts` | Presence/placement/pubDate-before/empty/xmlEsc tests; v1.3 title assertion | VERIFIED | All five new test cases present; mock title `'SalishSea.io Cetacean Occurrences (v1.3)'`; assertion at line 82 checks `v1.3` |
| `scripts/dwca/build.ts` | Step 15.5 associated-parties query + associatedParties into buildEml | VERIFIED | Step 15.5 at lines 334–359; DISTINCT org.name/url via collections JOIN organizations, trusted-only Maplify UNION native, ORDER BY name; `buildEml({..., associatedParties})` at line 375 |
| `supabase/snippets/12_dwc_assertions.sql` | SC#1-SC#6 DO $$ RAISE EXCEPTION blocks; PROD-ONLY ceiling commented | VERIFIED | Six SC blocks present; SC#4 (26 cols) and SC#6 (v1.3) structural/locally runnable; SC#1/2/3/5 PROD-ONLY marked and commented out for local runs |
| `supabase/snippets/12_comments_census.sql` | Read-only D-03 census; embeds Wave 2 regex; no DDL | VERIFIED | Exists; `regexp_match(split_part(comments, '<br>', 1)` present; `trusted = TRUE` scoped; no UPDATE/DROP/CREATE/DELETE |
| `.planning/phases/12-dwc-view-rebuild/maplify_trusted_comments_census.tsv` | Committed census output from prod | VERIFIED | File committed at `e3a7ecc`; 1900 kept / 2151 NULL / 353 comma-NULLed / 82 ID-credit-NULLed |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/dwca/fields.ts (OCCURRENCE_FIELDS)` | `dwc._native_occurrences / dwc._maplify_occurrences` column order | `assertFieldAlignment` position-by-position parity | VERIFIED | UNION ALL enforces type parity at CREATE VIEW time; `fields.test.ts` index assertions lock ordinals |
| `dwc._maplify_occurrences` | `public.collections c_coll` via `s.collection_id` | `LEFT JOIN public.collections c_coll ON c_coll.id = s.collection_id` + `COALESCE(..., 'Whale Alert (Global)')` | VERIFIED | Present in migration at lines 199 + 182; COALESCE fallback confirmed |
| `dwc.occurrences` | `dwc._native_occurrences + dwc._maplify_occurrences` | `SELECT * UNION ALL SELECT *` (SRC-01 by construction, 26-col parity) | VERIFIED | Migration lines 214–217; no WHERE; compile-time parity enforcement |
| `build.ts Step 15.5` | `public.organizations` via `public.collections` (trusted Maplify + native) | `DuckDB runAndReadAll + getRowObjects` | VERIFIED | Lines 339–354 in build.ts; DISTINCT JOIN pattern; ORDER BY name |
| `build.ts` | `eml.ts buildEml` | `buildEml({ datasets, temporalCoverage, associatedParties })` | VERIFIED | Line 375 in build.ts |
| `eml.ts buildEml` | EML `<dataset>` document | `<associatedParty>` block before `<pubDate>`, xmlEsc on name/url | VERIFIED | Lines 135–144 in eml.ts; interpolated at line 195 after `</metadataProvider>` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `dwc.occurrences` (via migration) | institutionCode, rightsHolder, datasetName | Constants + `public.collections c_coll.name` FK join | Yes — constants are structural; datasetName from FK (19 distinct values confirmed prod) | FLOWING |
| `scripts/dwca/eml.ts buildEml` | associatedParties | `build.ts` Step 15.5 DuckDB query → `public.organizations` | Yes — 5 orgs returned from prod data; data-driven, not static | FLOWING |
| `scripts/dwca/guard.ts` | row count | `SELECT COUNT(*) FROM pgdb.dwc.occurrences` | Yes — reads rebuilt view; 4,411 prod rows | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite green | `npx vitest run` | 16 files passed, 1 skipped (build.test.ts DSN-gated), 148 tests passed, 11 skipped, 0 failed | PASS |
| SC#1: institutionCode = 'SalishSea' on all rows | Read-only prod query via `npx supabase db query --linked` | 0 deviating rows across 4,411 prod rows | PASS |
| SC#2: rightsHolder = 'SalishSea.io' on all rows | Read-only prod query | 0 deviating rows | PASS |
| SC#3: datasetName prefixed 'SalishSea.io — ', non-NULL | Read-only prod query | 0 NULL or wrong-prefix rows; 19 distinct values | PASS |
| SC#5: row ceiling ≤ native + trusted Maplify | Read-only prod query | 4,411 ≤ 4,876 | PASS |
| ATTR-04: Step 15.5 associated-parties query | Read-only prod query | 5 orgs returned (Cascadia Research Collective, MBARI, Orca Network, Orcasound, The Marine Mammal Center) | PASS |

---

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` declared or conventional for this phase.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ATTR-01 | 12-01, 12-02 | Exported rows carry `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, `recordedBy` from contributor | SATISFIED | institutionCode/rightsHolder constants in both branches; recordedBy regex validated by D-03 census before embedding; SC#1/SC#2 prod checks pass |
| ATTR-02 | 12-02 | `datasetName` is per-collection (`"SalishSea.io — {collection}"`) for exported records | SATISFIED | FK join via `public.collections c_coll`; COALESCE fallback; SC#3 prod check: 19 distinct datasetName values, 0 bad-prefix rows |
| ATTR-03 | 12-02, 12-03 | iNat/HappyWhale excluded by construction; row-count gate fails if count exceeds native + Maplify baseline | SATISFIED | UNION of exactly two branches (D-11); `guard.ts` reads `dwc.occurrences` with ROW_FLOOR=1000; SC#5 ceiling holds; `AND s.trusted` in Maplify WHERE |
| ATTR-04 | 12-03 | Upstream organizations surface in EML as `associatedParty`, never as `institutionCode` | SATISFIED | `AssociatedParty` interface; `EmlInput.associatedParties`; buildEml renders per-org `<associatedParty>` with role=contentProvider and xmlEsc; build.ts Step 15.5 data-driven query; eml.test.ts 5 new tests green |
| ATTR-05 | Phase 13 | Regenerated archive passes GBIF DwC-A validator; no attribution regressions | PENDING (Phase 13) | Explicitly deferred per CONTEXT.md and ROADMAP.md — Phase 13 scope |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scripts/dwca/eml.ts` | 151 | `TODO: link Acartia cooperative boundary doc once published URL is confirmed` | Info | Pre-existing from Phase 6-03 (commit `b0a51c7`); not introduced by Phase 12; refers to a future documentation enrichment when an external URL becomes available; does not affect archive correctness or any Phase 12 deliverable |

No BLOCKER or WARNING anti-patterns found. The eml.ts TODO predates this phase and is a documentation-quality item, not unresolved implementation debt.

---

### Human Verification Required

None. All must-haves were verified programmatically via:
- Direct codebase inspection (migration SQL, fields.ts, eml.ts, build.ts, guard.ts)
- Committed test assertions (fields.test.ts, meta-xml.test.ts, eml.test.ts) verified green by orchestrator-run `npx vitest run`
- Read-only prod data checks (SC#1-SC#5 via `npx supabase db query --linked`)

Prod application and GBIF re-validation (ATTR-05) are human-checkpoints in Phase 13, not a gap here.

---

### Gaps Summary

No gaps. All nine observable truths verified. Four requirements (ATTR-01 through ATTR-04) satisfied. ATTR-05 is Phase 13 scope by design.

**Accepted deviation (carried from 12-02-SUMMARY.md):** DROP+CREATE produces new view objects that do not inherit the original one-time `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated`. This is immaterial — the only consumers (`build.ts` via DuckDB ATTACH as `postgres` owner, `guard.ts`) do not use the anon/authenticated roles, and the dwc schema is not PostgREST-exposed. No new GRANT was added (security gate T-12-02-EXPO preserved).

---

_Verified: 2026-06-21T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
