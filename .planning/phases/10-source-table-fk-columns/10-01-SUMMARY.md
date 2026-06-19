---
phase: 10-source-table-fk-columns
plan: "01"
subsystem: database
tags: [migration, postgresql, fk-columns, provenance, supabase]
dependency_graph:
  requires: [09-01]
  provides: [provider_id-backfill, collection_id-index, source_url-generated, contributor_id-nullable]
  affects: [dwc-views-phase12, backfill-resolver-phase11]
tech_stack:
  added: []
  patterns: [generated-columns, migration-resolved-default, partial-btree-index, do-execute-format]
key_files:
  created:
    - supabase/migrations/20260619203013_source_table_fk_columns.sql
    - supabase/snippets/10_fk_columns_assertions.sql
  modified: []
decisions:
  - "HappyWhale source_url uses GENERATED ALWAYS AS repo-canonical form: individual_id + ';enc=' + id (15+ repo precedents; no /encounter/ form used anywhere in codebase)"
  - "provider_id NOT NULL on all four tables (D-05 intentional deviation from ROADMAP SC#1)"
  - "collection_id partial btree index WHERE IS NOT NULL on the two exported tables only"
  - "supabase db reset storage container restart error (status 500) is pre-existing, unrelated to Phase 10 migration"
metrics:
  duration: "7 minutes"
  completed_date: "2026-06-19"
  tasks: 3
  files: 2
---

# Phase 10 Plan 01: Source Table FK Columns Summary

Added the four per-sighting provenance FK columns (`provider_id`, `collection_id`, `contributor_id`, `source_url`) to all four source tables via a single additive migration with slug-resolved dynamic DEFAULTs and GENERATED ALWAYS AS source_url columns, verified by SC#1-SC#4 assertion snippet exiting 0 on a fresh local DB.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Author SC#1-SC#4 assertion snippet (Wave 0) | a6a0c03 | supabase/snippets/10_fk_columns_assertions.sql |
| 2 | Write additive FK-column migration for all four source tables | a196749 | supabase/migrations/20260619203013_source_table_fk_columns.sql |
| 3 | Apply against fresh local DB; prove SC#1-SC#4 | 75f4572 | supabase/snippets/10_fk_columns_assertions.sql (fix) |

## Verification Results

**`supabase db reset`:** All migrations applied cleanly in order, including `20260619203013_source_table_fk_columns.sql`. A post-restart "Error status 500" from the storage container is a pre-existing issue unrelated to this migration (UNION types mismatch in storage-api). The migration SQL itself exited 0.

**Assertion snippet:** `psql ... -v ON_ERROR_STOP=1 -f supabase/snippets/10_fk_columns_assertions.sql` exited 0.

- SC#1 PASS: All four columns present on all four tables; provider_id NOT NULL (D-05); collection_id + contributor_id nullable
- SC#2 PASS: `observations_collection_id` and `sightings_collection_id` partial btree indexes found in pg_indexes
- SC#3 PASS: 0 native rows where source_url != url; 0 iNat rows where source_url != uri
- SC#4 PASS: Synthetic maplify insert (id=999999999) succeeded with defaulted provider_id=2 and NULL collection_id; row count restored after DELETE
- Belt-and-suspenders 1 PASS: provider_id NULL count = 0 on all four tables
- Belt-and-suspenders 2 PASS: HappyWhale source_url matches individual/%;enc=% shape (0 HW rows locally — trivially satisfied, load-bearing vs prod)

**Local row counts at assertion time (post-reset):**
- `public.observations` (native): 0 rows
- `inaturalist.observations`: 1 row (seed)
- `happywhale.encounters`: 0 rows
- `maplify.sightings`: 416 rows

**provider_id DEFAULT values confirmed:** direct=1, maplify=2, inaturalist=3, happywhale=4 (resolved at migration time from slugs, never hardcoded in source).

## Migration End State

| Table | provider_id | collection_id | contributor_id | source_url |
|-------|-------------|---------------|----------------|------------|
| `public.observations` | NOT NULL, default=1 | nullable, indexed | nullable (was NOT NULL, relaxed D-11) | GENERATED AS (url) |
| `maplify.sightings` | NOT NULL, default=2 | nullable, indexed | nullable (new) | plain TEXT, NULL |
| `inaturalist.observations` | NOT NULL, default=3 | nullable | nullable (new) | GENERATED AS (uri) |
| `happywhale.encounters` | NOT NULL, default=4 | nullable | nullable (new) | GENERATED AS (individual/id;enc=id) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed RAISE format specifier in HappyWhale B&S assertion**
- **Found during:** Task 3 (first snippet run)
- **Issue:** The HappyWhale belt-and-suspenders RAISE EXCEPTION message contained `%;enc=%` as a literal string, but PL/pgSQL interprets `%` in RAISE messages as format parameters. With only one `%s` parameter (count `n`), the second `%` caused "too few parameters specified for RAISE".
- **Fix:** Doubled the literal `%` characters in the error message text to `%%` to escape them (`individual/%%enc=%%`).
- **Files modified:** supabase/snippets/10_fk_columns_assertions.sql
- **Commit:** 75f4572

### Noted Non-Issues

**`supabase db reset` exit code 1:** The CLI returned exit code 1 due to the post-migration container restart calling the storage-api and receiving a 500 from a UNION type mismatch (`text` vs `uuid` in `buckets_analytics`). This is a pre-existing issue present before Phase 10 — all migration SQL completed with exit 0 as confirmed by:
1. Output: `Applying migration 20260619203013_source_table_fk_columns.sql...` with no ERROR
2. `psql` query confirming all 16 new columns exist on all four tables
3. Assertion snippet exiting 0

**HappyWhale URL form (CONTEXT D-09 vs RESEARCH A1):** CONTEXT guessed `https://happywhale.com/encounter/{id}` but RESEARCH found 15+ repo migrations use `individual/{id};enc={enc_id}`. Used the repo-canonical generated form as directed by the plan. The generated column is cleaner than a plain column + UPDATE: it makes every HW row non-null by construction and removes drift risk.

## Invariants Confirmed

- No ingest RPC edited (D-14): `maplify.update_sightings` and `public.upsert_observation` unchanged
- No dwc view edited: `dwc._native_occurrences`, `dwc._maplify_occurrences`, `dwc.occurrences` unchanged
- No RLS policy added or changed
- No GRANT or REVOKE
- No NOT NULL constraint on collection_id (D-12)
- No hardcoded provider id literals in migration source (all four DEFAULT values resolved via `DO $$ EXECUTE format()`  from slug at apply time)

## Known Stubs

None — all four columns populated deterministically this phase where possible:
- `provider_id`: fully backfilled and defaulted on all four tables
- `source_url`: generated from `url` (native), `uri` (iNat), `individual_id+id` (HappyWhale); intentionally NULL for Maplify (Phase 11 resolver)
- `collection_id`: intentionally NULL everywhere (Phase 11 backfill)
- `contributor_id`: intentionally NULL on maplify/inat/happywhale (Phase 11); relaxed from NOT NULL on native

## Threat Flags

No new threat surface introduced. New columns:
- Inherit existing table RLS (`public.observations` keeps anon SELECT-all + authenticated-own-row)
- No new write surface (generated columns cannot be UPDATEd; `provider_id` DEFAULT fills new rows without RPC changes)
- Dynamic SQL interpolates a server-side integer (`SELECT id FROM public.providers`), never user input

## Self-Check: PASSED

- [x] supabase/migrations/20260619203013_source_table_fk_columns.sql exists (180 lines, > 60 min)
- [x] supabase/snippets/10_fk_columns_assertions.sql exists (231 lines)
- [x] Commit a6a0c03 (test: snippet) exists
- [x] Commit a196749 (feat: migration) exists
- [x] Commit 75f4572 (fix: snippet RAISE + db reset + assertion pass) exists
- [x] Assertion snippet exited 0 (SC#1-SC#4 all pass)
- [x] No STATE.md or ROADMAP.md modified
