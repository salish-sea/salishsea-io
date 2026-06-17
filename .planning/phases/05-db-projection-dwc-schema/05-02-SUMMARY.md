---
phase: 05-db-projection-dwc-schema
plan: 02
subsystem: database
tags: [postgres, supabase, darwincore, dwc, view, union-all, native-branch]

# Dependency graph
requires:
  - phase: 05-db-projection-dwc-schema
    provides: 05-01-SUMMARY.md — dwc schema + dwc.taxa_classification helper view
  - phase: 04-rights-data-model-policy-gate
    provides: 04-POLICY §3.1 (native gap table), §2.1 (D-09), §2.3 (dynamicProperties), §2.4 (unvalidated identifiers), §1.1 (D-20 native license)
provides:
  - dwc._native_occurrences (internal branch view; 25 DwC-aligned columns; native source projection)
  - Frozen 25-column interface contract that plan 05-03 (dwc._maplify_occurrences) must mirror
  - Append point for plans 05-03..05-04 in 20260617203900_dwc_schema.sql
affects: [05-03-maplify-branch, 05-04-union-datasets-multimedia, 06-archive-generation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "View-as-export-contract — 25 columns frozen for UNION ALL with the Maplify branch (plan 05-03)"
    - "Explicit per-column type cast on every output expression (text / double precision / integer) — defends against UNION-ALL type drift (RESEARCH Pitfall 4)"
    - "jsonb_strip_nulls + outer NULLIF(..., '{}') as the canonical omit-when-empty pattern for dynamicProperties"
    - "Single-migration-multi-plan append: this plan adds to 20260617203900_dwc_schema.sql alongside 05-01's CREATE SCHEMA + dwc.taxa_classification"

key-files:
  created: []
  modified:
    - supabase/migrations/20260617203900_dwc_schema.sql

key-decisions:
  - "Encoded the 25-column interface contract from PLAN.md verbatim — column order, names (double-quoted to preserve case), and types are now frozen for plan 05-03's mirror"
  - "Every scalar column carries an explicit ::text / ::double precision / ::integer cast so the eventual `CREATE VIEW dwc.occurrences AS … UNION ALL …` in plan 05-04 will compile cleanly (RESEARCH Pitfall 4 — UNION-ALL type-mismatch is the canonical view failure mode)"
  - "Split the column-skeleton task (Task 1, placeholder dynamicProperties) from the JSON-assembly task (Task 2, real jsonb_strip_nulls expression) — each diff is independently reviewable per PLAN.md guidance"
  - "extract_identifiers result is left to propagate NULL into the JSON object (Pitfall 6) — did NOT wrap in COALESCE; jsonb_strip_nulls drops the key when NULL"
  - "Used PostgreSQL's standard `<expression> AS \"name\"` SELECT idiom rather than DDL-style column-name-first ordering — see Deviations re plan-level grep assertions"

patterns-established:
  - "Branch views in dwc.* emit columns in PLAN.md's canonical interface-contract order with explicit per-column casts. Plan 05-03's dwc._maplify_occurrences must mirror exactly."
  - "Per-row constant DwC terms (basisOfRecord, occurrenceStatus, geodeticDatum, datasetID, datasetName, license) live as inline literals in the view, not as joins to dwc.datasets, because they are knowable at write-time and the join would cost a planner pass."

requirements_completed: [ALIGN-01, ALIGN-02, ALIGN-04, ALIGN-05, ALIGN-06]

# Metrics
duration: ~10min
completed: 2026-06-17
---

# Phase 5 Plan 02: dwc._native_occurrences branch view Summary

**Adds the 25-column `dwc._native_occurrences` view to the Phase 5 migration — the canonical projection of `public.observations` × `public.contributors` × `dwc.taxa_classification` into DwC-aligned columns per 04-POLICY §3.1. Establishes the column-order/type interface contract that plan 05-03's Maplify branch must mirror exactly so the union view in plan 05-04 compiles.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-17T21:14:00Z (approx)
- **Completed:** 2026-06-17T21:24:00Z (approx)
- **Tasks:** 2
- **Files modified:** 1 (existing migration extended)

## Accomplishments

- **`dwc._native_occurrences` view appended** to `supabase/migrations/20260617203900_dwc_schema.sql` after the existing `dwc.taxa_classification` definition and before the placeholder for plans 05-03..05-04. View emits the 25 columns named in PLAN.md `<interface_contract>`, each double-quoted to preserve case for PostgREST and DuckDB consumers.
- **Discrepancy 1 honored:** every source reference uses `public.observations` (FK column `observation_id` on photos, joined contributor on `contributor_id`). Zero non-comment references to `public.sightings` / `public.sighting_photos` / `sighting_id` — verified by `grep -v '^--' | grep -cE 'public\.sightings\b|public\.sighting_photos\b|sighting_id\b'` → `0`.
- **All four GBIF-required terms non-null by construction (ALIGN-02):** `occurrenceID` = `'salishsea:' || o.id::text`; `basisOfRecord` = `'HumanObservation'`; `eventDate` = Z-suffixed UTC text from `to_char`; `scientificName` = `tc.scientific_name`. Each is a constant or comes from an INNER JOIN that cannot return NULL for in-scope rows.
- **Spatial axes correct (ALIGN-04):** `decimalLatitude` = `gis.ST_Y(o.subject_location::gis.geometry)` (Y axis = lat), `decimalLongitude` = `gis.ST_X(o.subject_location::gis.geometry)` (X axis = lon), both `::double precision`. Matches the existing `public.occurrences` UI view convention. `geodeticDatum` = constant `'WGS84'`. `coordinateUncertaintyInMeters` = `NULLIF(o.accuracy, 0)::integer` — never emits 0.
- **`eventDate` Z-suffixed UTC text (ALIGN-05):** `to_char(o.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')::text` — not the default `timestamptz::text` cast (which yields sub-RFC-3339 `2024-03-15 14:30:00+00`).
- **`occurrenceID` source-prefixed, deterministic (ALIGN-06):** `'salishsea:' || o.id::text`. The `'maplify:'` prefix used by plan 05-03 cannot collide by construction.
- **`license` constant CC-BY-NC 4.0 `/legalcode`** on every native row per D-20 / POLICY §1.1.
- **`recordedBy` = `rightsHolder` = `c.name`** per D-09 / POLICY §2.1, joined from `public.contributors c`.
- **`dynamicProperties` carries exactly two native-only keys** (Task 2): `travelDirection` (from `o.direction::text`) + `unvalidatedIdentifiers` (from `public.extract_identifiers(o.body)`). Maplify-only keys (`aggregatorSource`, `aggregatorChain`, `countIsMinimum`) are deliberately absent (POLICY §2.3). `jsonb_strip_nulls` drops keys whose values are NULL; outer `NULLIF(..., '{}')` collapses an entirely-empty object to NULL. Cast `::text` for UNION-ALL parity and Phase 6's opaque-text treatment (POLICY §5.4).
- **UNION-ALL type discipline:** every output column carries an explicit cast (text / double precision / integer). When plan 05-03 mirrors this contract and plan 05-04 assembles `dwc.occurrences = SELECT * FROM dwc._native_occurrences UNION ALL SELECT * FROM dwc._maplify_occurrences`, Postgres will catch any type drift at view-creation rather than silently coercing (RESEARCH Pitfall 4).

## Column-by-column projection (`dwc._native_occurrences`)

| # | DwC Term ("name") | SQL Expression | Cast | Source |
|---|-------------------|----------------|------|--------|
| 1 | `"occurrenceID"` | `'salishsea:' \|\| o.id::text` | `text` | observation id |
| 2 | `"basisOfRecord"` | `'HumanObservation'` | `text` | constant |
| 3 | `"eventDate"` | `to_char(o.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` | `text` | observed_at |
| 4 | `"scientificName"` | `tc.scientific_name` | `text` | taxa_classification |
| 5 | `"taxonRank"` | `tc.taxon_rank` | `text` | taxa_classification |
| 6 | `"kingdom"` | `tc.kingdom` | `text` | taxa_classification |
| 7 | `"phylum"` | `tc.phylum` | `text` | taxa_classification |
| 8 | `"class"` | `tc.class` | `text` | taxa_classification |
| 9 | `"order"` | `tc.order_` | `text` | taxa_classification (renamed from `order_` to escape SQL reserved word) |
| 10 | `"family"` | `tc.family` | `text` | taxa_classification |
| 11 | `"genus"` | `tc.genus` | `text` | taxa_classification (NULL when leaf rank ≥ family) |
| 12 | `"decimalLatitude"` | `gis.ST_Y(o.subject_location::gis.geometry)` | `double precision` | subject_location (Y axis) |
| 13 | `"decimalLongitude"` | `gis.ST_X(o.subject_location::gis.geometry)` | `double precision` | subject_location (X axis) |
| 14 | `"geodeticDatum"` | `'WGS84'` | `text` | constant |
| 15 | `"coordinateUncertaintyInMeters"` | `NULLIF(o.accuracy, 0)` | `integer` | accuracy (omit when 0/NULL) |
| 16 | `"individualCount"` | `o.count` (smallint→integer) | `integer` | count (CHECK > 0 in source) |
| 17 | `"occurrenceStatus"` | `'present'` | `text` | constant |
| 18 | `"occurrenceRemarks"` | `NULLIF(TRIM(regexp_replace(o.body, '<[^>]+>', '', 'g')), '')` | `text` | body (HTML stripped) |
| 19 | `"recordedBy"` | `c.name` | `text` | contributors (D-09) |
| 20 | `"rightsHolder"` | `c.name` | `text` | contributors (D-09) |
| 21 | `"datasetName"` | `'SalishSea.io Cetacean Occurrences (v1.2)'` | `text` | constant (must match dwc.datasets row in plan 05-04) |
| 22 | `"datasetID"` | `'https://salishsea.io/datasets/occurrences-v1'` | `text` | constant (D-17 / POLICY §6.3) |
| 23 | `"license"` | `'https://creativecommons.org/licenses/by-nc/4.0/legalcode'` | `text` | constant (D-20 / POLICY §1.1) |
| 24 | `"dynamicProperties"` | `NULLIF(jsonb_strip_nulls(jsonb_build_object('travelDirection', o.direction::text, 'unvalidatedIdentifiers', NULLIF(public.extract_identifiers(o.body), ARRAY[]::varchar[])))::text, '{}'::text)` | `text` | direction + identifiers |
| 25 | `"informationWithheld"` | `NULL` | `text` | optional (POLICY §2.4); Maplify mirror |

**Joins:**
- `FROM public.observations o`
- `JOIN public.contributors c ON c.id = o.contributor_id` (D-09)
- `JOIN dwc.taxa_classification tc ON tc.taxon_id = o.taxon_id` (M-05 / ALIGN-03)

**Filters:** None — POLICY §3.1 keeps all native observations in scope.

## Task Commits

Each task was committed atomically:

1. **Task 1: Append CREATE VIEW dwc._native_occurrences with scalar columns and joins** (placeholder `dynamicProperties` = `NULL::text`) — `04229bb` (feat)
2. **Task 2: Replace dynamicProperties placeholder with jsonb_strip_nulls expression (native key set)** — `b88e067` (feat)

## Files Created/Modified

- `supabase/migrations/20260617203900_dwc_schema.sql` — extended. Added `CREATE VIEW dwc._native_occurrences AS …` (25 columns, three joins) plus a multi-paragraph block comment naming the policy sections being encoded, the ALIGN coverage, and the rationale for splitting Task 1 (skeleton) from Task 2 (JSON). Added `COMMENT ON VIEW dwc._native_occurrences IS '…'`. Updated the trailing "continued" marker to name the remaining artifacts owned by 05-03..05-04.

## Decisions Made

- **Per-column explicit casts on every output expression.** RESEARCH Pitfall 4 names UNION-ALL type mismatch as the canonical view-failure mode. By making every cast explicit (`::text`, `::double precision`, `::integer`) the contract is testable at view-creation time and the Maplify branch's mirror obligation is unambiguous.
- **Split skeleton from JSON assembly across two tasks.** Task 1's diff is structural — 25 columns and three joins, almost no logic. Task 2's diff is a single column expression. Reviewing them separately keeps the JSON-omit-when-null semantics visible without the surrounding 25-column noise.
- **NULL-propagation through `jsonb_strip_nulls`, not COALESCE.** Established codebase patterns use `COALESCE(extract_identifiers(...), ARRAY[]::varchar[])` to materialize an empty array; here we want the opposite (`jsonb_strip_nulls` drops keys whose values are NULL). The outer `NULLIF(..., ARRAY[]::varchar[])` is defensive against a future regex change that returns `'{}'` instead of NULL.
- **Per-row constants instead of joining to `dwc.datasets`.** `datasetID`, `datasetName`, `license`, `basisOfRecord`, `occurrenceStatus`, `geodeticDatum` are knowable at write-time and identical on every native row. Inlining is cheaper than a 1-row join. (`dwc.datasets` in plan 05-04 is the source-of-truth for EML emission in Phase 6; the inlined constants here must stay textually in sync — flagged in the view's block comment.)
- **Did not pass plan-level lat/lon grep assertions as-written** (see Deviations).

## Deviations from Plan

### [Rule 1 — Spec/Assertion mismatch] Plan-level lat/lon grep regex assumes column-name-first ordering

- **Found during:** post-Task-2 verification of plan-level checks in `<verification>`.
- **Issue:** The plan's verification section lists `grep -c '"decimalLatitude".*ST_Y'` and `grep -c '"decimalLongitude".*ST_X'`, which require `"decimalLatitude"` to appear BEFORE `ST_Y` on the same line. My implementation follows standard PostgreSQL SELECT idiom (`<expression> AS <name>`), so the actual lines are `gis.ST_Y(o.subject_location::gis.geometry)::double precision AS "decimalLatitude"` — value first, name second.
- **Fix:** None applied to the SQL — the semantic correctness is preserved (ST_Y → decimalLatitude, ST_X → decimalLongitude on a single line; `grep -c '"decimalLatitude".*decimalLongitude" $\|$ ST_Y.*"decimalLatitude"' === 1` both pass). The plan's regex was authored assuming DDL-style column-name-first ordering rather than view-SELECT style. Per the plan's own statement that "Full assertion suite runs in plan 05-04; this plan stops at file authorship," the canonical assertions live downstream. No code change needed; flagging here so plan 05-04's assertion suite uses an order-agnostic pattern (e.g., `awk` over the column line, or `grep -E 'ST_Y.*decimalLatitude|decimalLatitude.*ST_Y'`).
- **Files modified:** None.
- **Commit:** N/A (observation only).

All other deviations: none. Tasks 1 and 2 executed exactly as the plan specifies. All Task-level `<verify><automated>` grep blocks pass.

## Issues Encountered

- Initial Task 2 implementation used a multi-line `jsonb_strip_nulls(jsonb_build_object(...))` formatting for readability; the verifier's `grep -q "jsonb_strip_nulls(jsonb_build_object('travelDirection', o.direction"` requires a single-line match. Consolidated to a single line so the verifier passes. Trade-off: line is ~250 chars wide. The block comment above explains the structure, so on-disk readability is preserved.

## User Setup Required

None. This plan is migration code only; local verification (`supabase db reset` + assertion suite) is added by plan 05-04 per the seed migration's header comment.

## Self-Check

Verified after writing this summary:

```
$ test -f supabase/migrations/20260617203900_dwc_schema.sql && echo FOUND
FOUND
$ grep -c 'CREATE VIEW dwc._native_occurrences' supabase/migrations/20260617203900_dwc_schema.sql
1
$ grep -v '^--' supabase/migrations/20260617203900_dwc_schema.sql | grep -cE 'public\.sightings\b|public\.sighting_photos\b|sighting_id\b'
0
$ grep -q "'salishsea:' || o.id::text" supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK
$ grep -q "gis.ST_Y(o.subject_location" supabase/migrations/20260617203900_dwc_schema.sql && grep -q "gis.ST_X(o.subject_location" supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK
$ grep -q "NULLIF(o.accuracy, 0)" supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK
$ grep -q "by-nc/4.0/legalcode" supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK
$ grep -q "jsonb_strip_nulls(jsonb_build_object('travelDirection', o.direction" supabase/migrations/20260617203900_dwc_schema.sql && grep -q "public.extract_identifiers(o.body)" supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK
$ git log --oneline | grep -E '04229bb|b88e067'
b88e067 feat(05-02): wire dwc._native_occurrences.dynamicProperties to extract helpers
04229bb feat(05-02): add dwc._native_occurrences branch view (placeholder dynamicProperties)
```

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 05-03 (Maplify branch view) unblocked and constrained.** Plan 05-03's `dwc._maplify_occurrences` MUST emit the same 25 columns in the same order with the same types (text / double precision / integer) so `CREATE VIEW dwc.occurrences AS SELECT * FROM dwc._native_occurrences UNION ALL SELECT * FROM dwc._maplify_occurrences;` in plan 05-04 will compile. The block comment above the view in the migration names this obligation in-place.
- **Plan 05-04 (UNION + datasets + multimedia + grants) unblocked.** It can `CREATE VIEW dwc.occurrences AS SELECT * FROM dwc._native_occurrences UNION ALL SELECT * FROM dwc._maplify_occurrences;` directly. The single `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated;` deferred from plan 05-01 will cover this view automatically.
- **Phase 6 (archive generation) unaffected for now.** It will read `dwc.occurrences` (the union), never `dwc._native_occurrences` directly. The leading-underscore convention is preserved.
- No blockers. No concerns.

---
*Phase: 05-db-projection-dwc-schema*
*Completed: 2026-06-17*
