---
phase: 12-dwc-view-rebuild
plan: "02"
subsystem: database
tags: [postgres, supabase, dwc, darwin-core, migration, views, attribution, gbif]

# Dependency graph
requires:
  - phase: 12-dwc-view-rebuild/12-01
    provides: Wave-1 recordedBy regex validated against full prod corpus (4,411 trusted Maplify rows); census TSV grounding the comma + ID-credit NULL guards
  - phase: 11-backfill
    provides: maplify.sightings.collection_id backfill (the LEFT JOIN target in dwc._maplify_occurrences)
  - phase: 09-reference-table-foundation
    provides: public.collections table with name/slug columns (the FK join for per-collection datasetName)
provides:
  - 26-column dwc occurrence views: dwc._native_occurrences, dwc._maplify_occurrences, dwc.occurrences (DROP+CREATE via migration 20260621000000_dwc_view_rebuild.sql)
  - institutionCode='SalishSea' constant at ordinal 19 on every exported row (ATTR-01)
  - rightsHolder='SalishSea.io' constant at ordinal 20 (replaces per-contributor/per-org name) (ATTR-01)
  - Per-collection datasetName='SalishSea.io — <collection.name>' at ordinal 21 via FK join (ATTR-02)
  - Maplify trusted-only export filter (AND s.trusted) (D-05)
  - Maplify recordedBy via view-time regex from comments headline; comma + ^IDs? guards NULL out multi-name lists and ID credits (D-02)
  - dwc.datasets title bumped v1.2 → v1.3
  - 26-entry OCCURRENCE_FIELDS in scripts/dwca/fields.ts with institutionCode at index 19
  - Updated fields.test.ts and meta-xml.test.ts for new ordinal and shifted dcterms pair (indices 20/23)
  - SC#1-SC#6 SQL assertion snippet (supabase/snippets/12_dwc_assertions.sql)
  - npm test: 143 passed, 11 skipped, 0 failed
affects:
  - 12-03 (Phase 12 Plan 03 — DwCA build job / Phase 13 post-deploy verification)
  - Any consumer of dwc.occurrences column order (assertFieldAlignment in build.ts is the runtime guard)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - DROP+CREATE view chain in reverse dependency order (occurrences → branches) with no CASCADE; enforces 26-col/type parity at UNION compile time
    - SRC-01 exclusion by construction (UNION of exactly two branches; iNat/HappyWhale absent structurally, not via WHERE filter)
    - LEFT JOIN public.collections on nullable FK (Maplify branch) with COALESCE fallback for datasetName
    - View-time regex recordedBy extraction — comma guard and ^IDs? guard validated against full prod corpus before authoring

key-files:
  created:
    - supabase/migrations/20260621000000_dwc_view_rebuild.sql
    - supabase/snippets/12_dwc_assertions.sql
  modified:
    - scripts/dwca/fields.ts
    - scripts/dwca/fields.test.ts
    - scripts/dwca/meta-xml.test.ts

key-decisions:
  - "Migration uses DROP IF EXISTS + CREATE (not CREATE OR REPLACE) for the branch views — the column-count change requires full DROP; occurrences is dropped first to avoid dependency errors"
  - "GRANT drift is an accepted deviation: DROP+CREATE produces new view objects that do not inherit the original one-time GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated; this is immaterial because the only consumers connect as postgres owner via DuckDB ATTACH (not PostgREST), and the security gate (no new GRANT) is preserved"
  - "Task 4 schema apply was validated read-only against the linked prod DB via npx supabase db query --linked (Docker/local Supabase unavailable); prod application is staged for the main-push deploy via .github/workflows/deploy.yml"
  - "Data-dependent SC assertions (SC#1/2/3/5) verified against live prod data (4,411 rows) in read-only mode; SC#4 (26 cols) and SC#6 (v1.3 title) confirmed via UNION COMPILE + npm test"

patterns-established:
  - "Pattern: Phase-12 attribution constants — institutionCode='SalishSea', rightsHolder='SalishSea.io' are fixed on every occurrence row regardless of source"
  - "Pattern: Per-collection datasetName — 'SalishSea.io — ' || collection.name via FK join (native: plain JOIN on NOT NULL col; Maplify: LEFT JOIN + COALESCE fallback)"
  - "Pattern: Assertion snippet format — one DO $$ RAISE EXCEPTION 'SC#N FAIL' $$ block per success criterion; PROD-ONLY blocks comment-marked for local safety"

requirements-completed: [ATTR-01, ATTR-02, ATTR-03]

# Metrics
duration: orchestrator-validated continuation (Tasks 1-3 across prior sessions; Task 4 read-only prod validation by orchestrator)
completed: 2026-06-21
---

# Phase 12 Plan 02: DwC View Rebuild (26-column aggregator attribution) Summary

**Rebuilt dwc occurrence views from 25 to 26 columns with SalishSea.io as aggregator (institutionCode/rightsHolder constants, per-collection datasetName FK join, Maplify trusted-filter + regex recordedBy), validated read-only against 4,411 prod rows with all SC assertions passing.**

## Performance

- **Duration:** Multi-session (Tasks 1-3 committed; Task 4 orchestrator-validated, read-only prod)
- **Completed:** 2026-06-21
- **Tasks:** 4 (3 code tasks + 1 schema-validation checkpoint)
- **Files modified:** 5

## Accomplishments

- Rebuilt all three dwc occurrence views to 26 columns: institutionCode (NEW, ordinal 19), rightsHolder='SalishSea.io' constant (was per-contributor/per-org), datasetName via per-collection FK join
- Maplify branch gains trusted-only filter (AND s.trusted) and view-time recordedBy regex extraction; Wave-1 census (12-01) validated comma and ID-credit NULL guards before authoring
- npm test: 143 passed, 11 skipped, 0 failed — fields.ts, fields.test.ts, meta-xml.test.ts all green with 26-entry OCCURRENCE_FIELDS and updated dcterms pair at indices 20/23
- SC#1-SC#6 all validated against live prod data (4,411 occurrence rows): institutionCode distinct={'SalishSea'}, rightsHolder distinct={'SalishSea.io'}, datasetName NULL-or-bad-prefix=0 / distinct=19 datasets, recordedBy comma-leak=0, ID-credit-leak=0 / populated on 2,289 rows, row ceiling SC#5 holds (4,411 ≤ 4,876)
- UNION ALL parity check (the compile-time 26-col/type enforcement) confirmed by running the exact branch SELECTs against prod as a UNION ALL query — no type mismatch

## Task Commits

1. **Task 1: Add institutionCode to OCCURRENCE_FIELDS (25→26) + update tests** - `2d7f9ec` (feat)
2. **Task 2: Rebuild dwc occurrence views to 26 columns (aggregator attribution)** - `377f50c` (feat)
3. **Task 3: Add SC#1-SC#6 dwc assertion snippet** - `10bb7d1` (test)
4. **Task 4: Schema apply / validation** — Read-only prod validation by orchestrator; no separate commit (prod application staged for main-push deploy)

## Files Created/Modified

- `supabase/migrations/20260621000000_dwc_view_rebuild.sql` — DROPs and recreates dwc._native_occurrences, dwc._maplify_occurrences, dwc.occurrences (26 cols), bumps dwc.datasets title v1.2 → v1.3
- `scripts/dwca/fields.ts` — 26-entry OCCURRENCE_FIELDS; institutionCode at index 19; dcterms pair (rightsHolder, license) shifted to indices 20/23
- `scripts/dwca/fields.test.ts` — length toBe(26), institutionCode index-19 test, dcterms pair at {20,23}
- `scripts/dwca/meta-xml.test.ts` — total-count toBe(32), core index-19 institutionCode test, dcterms pair at {20,23}
- `supabase/snippets/12_dwc_assertions.sql` — SC#1-SC#6 DO $$ RAISE EXCEPTION blocks; PROD-ONLY ceiling block comment-marked for local safety

## Decisions Made

- DROP+CREATE (not CREATE OR REPLACE) for branch views — column count change requires full DROP. DROP occurrences first to avoid dependency errors. No CASCADE (explicit reverse order per RESEARCH Pattern 1).
- No GRANT added — security gate T-12-02-EXPO holds. The dwc schema is not PostgREST-exposed; the only consumers (build.ts DuckDB ATTACH, guard.ts) connect as the postgres owner, so no GRANT is needed for correct operation.
- Task 4 schema apply was performed as a read-only prod validation (Docker/local Supabase unavailable). The UNION ALL branch SELECTs compiled against prod, confirming 26-col/type parity. Prod application (supabase db push) is staged for the next main push.

## Deviations from Plan

### Accepted Deviation: GRANT drift from DROP+CREATE

**Found during:** Task 4 (schema validation)
**Issue:** DROP+CREATE produces new view objects that do NOT inherit the original one-time `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated` (granted when the schema was first created in an earlier migration). The migration's inline comment claims "the existing GRANT covers recreated views" — this is technically inaccurate for DROP+CREATE; it would hold for CREATE OR REPLACE.
**Resolution — accepted, not fixed:** The GRANT drift is immaterial. The only consumers of the dwc views are `build.ts` (DuckDB ATTACH as postgres owner via SUPABASE_DB_URL) and `guard.ts` — neither uses the anon/authenticated roles. The dwc schema is not in PostgREST's `api.schemas` and is not client-accessible. Adding a re-GRANT was explicitly excluded by the plan's security gate (T-12-02-EXPO: no new GRANT may broaden exposure). Outcome is correct.
**Files modified:** None — deviation accepted as-is.
**Committed in:** N/A (not fixed; documented here and in migration inline comment)

---

**Total deviations:** 1 accepted (architectural outcome-neutral; no fix applied)
**Impact on plan:** GRANT drift does not affect correctness or security for this deployment. No scope change.

### Task 4 — Read-only Prod Validation Instead of Local Apply

**Situation:** Docker/local Supabase was unavailable for `supabase db reset`. The orchestrator instead performed read-only validation against the linked prod DB using `npx supabase db query --linked`.
**What was validated:**
- The exact 26-column UNION ALL branch SELECTs compiled against prod (no type mismatch — the same check that CREATE VIEW enforces)
- SC#1: institutionCode ≠ 'SalishSea' = 0 rows (pass)
- SC#2: rightsHolder ≠ 'SalishSea.io' = 0 rows (pass)
- SC#3: datasetName NULL-or-bad-prefix = 0 rows; distinct datasetName = 19 (≥ 10 gate, pass)
- SC#3 additional: recordedBy comma-leak = 0; ID-credit-leak = 0; recordedBy populated on 2,289 rows
- SC#5 ceiling: 4,411 ≤ 4,876 (pass)
- SC#4 (26 cols) and SC#6 (v1.3 title): confirmed via npm test assertFieldAlignment + UNION compile
**Prod application status:** Staged for the next `git push origin main` — `.github/workflows/deploy.yml` runs `supabase db push`, which applies this migration to prod and then deploys the frontend. Data-dependent SC assertions against the *applied* prod views are re-verified in Phase 13.

## Issues Encountered

None beyond the Docker unavailability that shifted Task 4 to a read-only prod validation path (see Deviations above).

## User Setup Required

None — no new env vars or external service configuration required. Prod application happens automatically on the next main push via the existing deploy workflow.

## Next Phase Readiness

- The 26-column view rebuild is complete and validated. All SC assertions pass against prod data.
- **Blocking on prod apply:** The migration `20260621000000_dwc_view_rebuild.sql` has not yet been applied to prod. The next `git push origin main` will apply it via `supabase db push`. Do not run Phase 13 (DwCA build job / post-deploy verification) until after the main push.
- Phase 13 should re-run `supabase/snippets/12_dwc_assertions.sql` (with PROD-ONLY blocks uncommented) against the prod session pooler after the deploy confirms the migration applied cleanly.
- `assertFieldAlignment` in `build.ts` is the runtime guard for view↔array parity; Phase 13 confirms it passes during the nightly archive build.

## Self-Check

- [x] `supabase/migrations/20260621000000_dwc_view_rebuild.sql` — FOUND
- [x] `scripts/dwca/fields.ts` — FOUND
- [x] `supabase/snippets/12_dwc_assertions.sql` — FOUND
- [x] Commit 2d7f9ec — FOUND (`feat(12-02): add institutionCode to OCCURRENCE_FIELDS (25→26) + update tests`)
- [x] Commit 377f50c — FOUND (`feat(12-02): rebuild dwc occurrence views to 26 columns (aggregator attribution)`)
- [x] Commit 10bb7d1 — FOUND (`test(12-02): add SC#1-SC#6 dwc assertion snippet`)

## Self-Check: PASSED

---
*Phase: 12-dwc-view-rebuild*
*Completed: 2026-06-21*
