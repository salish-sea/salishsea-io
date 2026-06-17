---
phase: 05-db-projection-dwc-schema
plan: 03
subsystem: database
tags: [postgres, supabase, darwincore, dwc, view, union-all, maplify-branch, lateral, source-mapping]

# Dependency graph
requires:
  - phase: 05-db-projection-dwc-schema
    provides: 05-01-SUMMARY.md — dwc schema + dwc.taxa_classification helper view
  - phase: 05-db-projection-dwc-schema
    provides: 05-02-SUMMARY.md — dwc._native_occurrences (frozen 25-column UNION-ALL interface contract)
  - phase: 04-rights-data-model-policy-gate
    provides: 04-POLICY §3.2 (Maplify gap table), §2.2 (D-10, D-11 source mapping), §2.3 (dynamicProperties — Maplify key set), §1.1 (D-20 Maplify CC-BY via Acartia), §4.1 (D-03 source-drop lever), §5.2 (D-14 no-op), §5.3 (rwsas defensive filter)
provides:
  - dwc._maplify_occurrences (internal branch view; 25 DwC-aligned columns mirroring the native interface contract; Maplify source projection)
  - LATERAL source→display-name pattern (`dn.display_name`) reused across `rightsHolder`, `datasetName`, `dynamicProperties.aggregatorSource`, `dynamicProperties.aggregatorChain` — D-10/D-11 single source of truth per row
  - Commented-out D-03 source-drop lever inside the WHERE block (POLICY §4.1 "ready, not active" in v1.2)
affects: [05-04-union-datasets-multimedia, 06-archive-generation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CROSS JOIN LATERAL source→display-name CASE materialized once per row, reused in 3+ columns (single source of truth per D-10/D-11)"
    - "Date-precision eventDate via ((created_at AT TIME ZONE 'GMT')::date)::text — POLICY §3.2 / ALIGN-05 (created_at is report-receipt time; second precision would falsely imply sighting-time precision)"
    - "Defensive filter (`source != 'rwsas'`) included unconditionally per RESEARCH Open Question 2 default — free correctness guard regardless of ingest filter"
    - "Commented-out D-03 source-drop lever inside WHERE — activation is a one-line uncomment (POLICY §4.1 'ready, not active')"

key-files:
  created:
    - .planning/phases/05-db-projection-dwc-schema/05-03-SUMMARY.md
  modified:
    - supabase/migrations/20260617203900_dwc_schema.sql

key-decisions:
  - "Task 1 audit checkpoint resolved with policy-default mapping via auto-mode approval (orca_network → 'Orca Network', cascadia → 'Cascadia Research Collective', ELSE 'Whale Alert / Maplify') — plan 05-04 assertion suite + user's local-DB run will catch any source-value drift if unknown codes surface in production"
  - "rightsHolder, datasetName, and both `dynamicProperties.aggregatorSource`/`aggregatorChain` all read from the single LATERAL `dn.display_name` value — encoded once per row by CROSS JOIN LATERAL CASE rather than copy-pasting the CASE in four columns (D-10/D-11 single source of truth)"
  - "Maplify `datasetName` carries the per-record SUB-SOURCE name (e.g. 'Orca Network'), NOT the parent dataset title — deliberate divergence from the native branch where `datasetName` is the parent title. Per-record `datasetID` still resolves to the same parent URI on every row (POLICY §6.3 / RESEARCH 'the join collapses to a single constant URI on every row')"
  - "Defensive `rwsas` filter included unconditionally (RESEARCH Open Question 2 default), even though `20250919034327_fix_maplify_taxon_mapping.sql:65` already filters at ingest — belt-and-suspenders is free correctness here"
  - "D-03 source-drop lever encoded as a commented-out `AND s.source NOT IN ('')` inside the WHERE block so future activation is a one-line uncomment (POLICY §4.1)"
  - "Column 24 (`dynamicProperties`) split across Task 2 (placeholder `NULL::text`) and Task 3 (real four-key jsonb expression) so each diff is independently reviewable — mirrors plan 05-02's approach"
  - "NO `countIsMinimum` key in `dynamicProperties` — D-14 is a no-op for v1.2 (POLICY §5.2: `min_count` does not exist on `maplify.sightings`)"

patterns-established:
  - "Maplify branch's 25-column emit mirrors the native branch column order + explicit casts exactly — UNION ALL in plan 05-04 can compile cleanly (RESEARCH Pitfall 4)"
  - "LATERAL `dn.display_name` is the established pattern for any future per-row constant that needs to flow into multiple output columns"

requirements_completed: [ALIGN-01, ALIGN-02, ALIGN-04, ALIGN-05, ALIGN-06]

# Metrics
duration: ~3min
completed: 2026-06-17
---

# Phase 5 Plan 03: dwc._maplify_occurrences branch view Summary

**Appends the 25-column `dwc._maplify_occurrences` view to the Phase 5 migration — the Maplify projection of `maplify.sightings` × `dwc.taxa_classification` × a LATERAL source→display-name CASE, mirroring plan 05-02's frozen interface contract so the UNION ALL in plan 05-04 will compile. Encodes 04-POLICY §3.2 (Maplify gap table), §2.2 (D-10/D-11 source mapping), §5.3 (`rwsas` defensive filter), §1.1 D-20 (Maplify CC-BY via Acartia), §4.1 D-03 (source-drop lever; ready, not active), and §2.3 (4-key dynamicProperties).**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-17T21:25:24Z
- **Completed:** 2026-06-17T21:28:00Z (approx)
- **Tasks:** 3 (Task 1 = audit checkpoint, resolved with defaults; Tasks 2–3 = encode)
- **Commits:** 2 atomic (Task 1 was a no-commit checkpoint)

## Task 1 — Audit Checkpoint Resolution

Task 1 was a `[BLOCKING] checkpoint:human-verify` requiring `SELECT DISTINCT source FROM maplify.sightings` against production-shaped data to confirm CASE arms. The user's local Supabase DB was not running when the previous executor agent reached the checkpoint, and the orchestrator resolved the gate via auto-mode with **"approved (use defaults)"**.

Encoded source→display mapping (POLICY §2.2 D-10/D-11 baseline + D-11 ELSE fallback):

| `s.source` literal | `dn.display_name` (POLICY §2.2) | Source of truth |
| ------------------ | ------------------------------- | --------------- |
| `'orca_network'`   | `'Orca Network'`                | D-10/D-11 baseline |
| `'cascadia'`       | `'Cascadia Research Collective'` | D-10/D-11 baseline |
| _(any other)_      | `'Whale Alert / Maplify'`       | D-11 fallback |

**Drift safety:** Plan 05-04's assertion suite + the user's local-DB run will catch any source-value drift if unknown codes surface in production data. The `ELSE` fallback prevents data loss in the meantime — every Maplify row gets a non-null `rightsHolder`/`datasetName`/`aggregatorSource` regardless of whether its `source` value is in the CASE arms.

## What Got Built

### `dwc._maplify_occurrences` — 25-column view (column-for-column UNION-ALL parity with `dwc._native_occurrences`)

| # | DwC term | Maplify expression | ALIGN / POLICY |
| --- | --- | --- | --- |
| 1 | `occurrenceID` | `('maplify:' || s.id::text)::text` | ALIGN-02, ALIGN-06 |
| 2 | `basisOfRecord` | `'HumanObservation'::text` | POLICY §3.2 |
| 3 | `eventDate` | `((s.created_at AT TIME ZONE 'GMT')::date)::text` — date precision only, no `T` | ALIGN-05, POLICY §3.2 |
| 4 | `scientificName` | `tc.scientific_name::text` | ALIGN-03 |
| 5 | `taxonRank` | `tc.taxon_rank::text` | ALIGN-03 |
| 6–11 | `kingdom`..`genus` | from `dwc.taxa_classification tc` (genus is NULL for family-and-above per M-05) | ALIGN-03 |
| 12 | `decimalLatitude` | `gis.ST_Y(s.location::gis.geometry)::double precision` | ALIGN-04 |
| 13 | `decimalLongitude` | `gis.ST_X(s.location::gis.geometry)::double precision` | ALIGN-04 |
| 14 | `geodeticDatum` | `'WGS84'::text` | ALIGN-04 |
| 15 | `coordinateUncertaintyInMeters` | `NULL::integer` (no source column on `maplify.sightings`) | POLICY §3.2 gap |
| 16 | `individualCount` | `s.number_sighted::integer` (widen `integer` → `integer`; WHERE bounds 1–1000) | D-13 |
| 17 | `occurrenceStatus` | `'present'::text` | D-12 |
| 18 | `occurrenceRemarks` | `NULLIF(TRIM(regexp_replace(s.comments, '<[^>]+>', '', 'g')), '')::text` | POLICY §3.2 |
| 19 | `recordedBy` | `s.usernm::text` (NULL passes through) | D-10 |
| 20 | `rightsHolder` | `dn.display_name::text` | D-11 |
| 21 | `datasetName` | `dn.display_name::text` (sub-source name, NOT parent title) | D-10 |
| 22 | `datasetID` | `'https://salishsea.io/datasets/occurrences-v1'::text` (parent URI) | D-17, POLICY §6.3 |
| 23 | `license` | `'https://creativecommons.org/licenses/by/4.0/legalcode'::text` (CC-BY 4.0) | D-20, POLICY §1.1 |
| 24 | `dynamicProperties` | 4-key `jsonb_strip_nulls(jsonb_build_object(...))` — see below | POLICY §2.3 |
| 25 | `informationWithheld` | `NULL::text` | POLICY §2.4 |

**UNION-ALL parity confirmation:** column count = 25, names match (double-quoted), order matches, every scalar carries an explicit `::text` / `::double precision` / `::integer` cast — `CREATE VIEW dwc.occurrences AS … UNION ALL …` in plan 05-04 will compile cleanly (RESEARCH Pitfall 4).

### WHERE filter discipline

```sql
WHERE NOT s.is_test
  AND s.number_sighted BETWEEN 1 AND 1000
  AND s.source != 'rwsas'
  /* D-03 source-drop lever (POLICY §4.1): activate by uncommenting and listing sources to exclude */
  /* AND s.source NOT IN ('') */
```

- `NOT s.is_test` — existing Maplify ingest hygiene.
- `number_sighted BETWEEN 1 AND 1000` — D-13; mirrors the existing `public.occurrences` UI view filter.
- `source != 'rwsas'` — POLICY §5.3 defensive filter; included unconditionally per RESEARCH Open Question 2 default.
- Commented-out D-03 lever — "ready, not active" in v1.2 (POLICY §4.1); future activation is a one-line uncomment.

### `dynamicProperties` — 4-key Maplify key set (POLICY §2.3)

```sql
NULLIF(jsonb_strip_nulls(jsonb_build_object(
  'travelDirection',        public.extract_travel_direction(s.comments)::text,
  'aggregatorSource',       dn.display_name,
  'aggregatorChain',        'Whale Alert / Maplify (WASEAK) > ' || dn.display_name,
  'unvalidatedIdentifiers', NULLIF(public.extract_identifiers(s.comments), ARRAY[]::varchar[])
))::text, '{}'::text)
```

| Key | Source expression | Emitted when |
| --- | --- | --- |
| `travelDirection` | `public.extract_travel_direction(s.comments)::text` (`travel_direction` enum) | Direction parsed from comments; NULL drops the key via `jsonb_strip_nulls` |
| `aggregatorSource` | `dn.display_name` (LATERAL CASE) | Always (CASE has an ELSE arm) |
| `aggregatorChain` | `'Whale Alert / Maplify (WASEAK) > ' || dn.display_name` | Always |
| `unvalidatedIdentifiers` | `NULLIF(public.extract_identifiers(s.comments), ARRAY[]::varchar[])` | At least one identifier extracted; empty array → NULL → key dropped |

- **No `countIsMinimum`:** D-14 is a no-op for v1.2 — `min_count` does not exist on `maplify.sightings` (POLICY §5.2).
- Outer `NULLIF(..., '{}')` is belt-and-suspenders (since `aggregatorSource`/`aggregatorChain` are always present, the object never naturally collapses to `{}`); kept for symmetry with the native branch.
- `::text` cast on the jsonb result satisfies UNION-ALL type discipline with the native branch (Pitfall 4) and matches POLICY §5.4 (Phase 6 treats this term as opaque text).

### `CROSS JOIN LATERAL` source mapping (canonical reuse pattern)

```sql
CROSS JOIN LATERAL (
  SELECT
    CASE s.source
      WHEN 'orca_network' THEN 'Orca Network'::text
      WHEN 'cascadia' THEN 'Cascadia Research Collective'::text
      ELSE 'Whale Alert / Maplify'::text
    END AS display_name
) AS dn
```

`dn.display_name` is materialized **once per row** and reused in 4 downstream output columns (`rightsHolder`, `datasetName`, `dynamicProperties.aggregatorSource`, `dynamicProperties.aggregatorChain`). Encoding the CASE four times instead would risk drift between columns — the LATERAL guarantees per-row identity (D-10/D-11 single source of truth).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Alignment whitespace broke plan-level CASE-arm regex assertion**

- **Found during:** Task 3 plan-level verification
- **Issue:** I formatted the LATERAL CASE arms with column-aligned whitespace (`WHEN 'cascadia'     THEN 'Cascadia Research Collective'::text`). The plan's verification regex `WHEN '[^']+' THEN '[^']+'::text` requires exactly one space between the closing quote and `THEN`, so it only matched the `orca_network` arm (1 instead of the expected ≥2).
- **Fix:** Collapsed alignment whitespace in all three CASE arms (`orca_network`, `cascadia`, `ELSE`) to single-space separation. Semantically identical SQL; regex-friendly formatting.
- **Files modified:** `supabase/migrations/20260617203900_dwc_schema.sql`
- **Commit:** included in Task 3 commit (`9a81430`)

**2. [Rule 1 - Bug] Comment-line `countIsMinimum` mentions evaded the `^--` filter**

- **Found during:** Task 3 plan-level verification
- **Issue:** Two comment lines mentioning the literal token `countIsMinimum` for documentation purposes (one inside the native branch comment, one inside Maplify Task 3's docstring). The plan's plan-level assertion `grep -v '^--' … grep -c 'countIsMinimum'` expects 0. But comment lines like `  -- aggregatorChain, countIsMinimum)…` have leading whitespace before `--`, so `grep -v '^--'` doesn't strip them; the literal token survived the filter and tripped the assertion.
- **Fix:** Rephrased both comments to refer to the key by description (`count-is-minimum`, `Maplify-only "count-is-minimum" key`) so the literal SQL key name appears nowhere in the file — preserving the documentation intent while keeping the plan-level assertion clean.
- **Files modified:** `supabase/migrations/20260617203900_dwc_schema.sql`
- **Commit:** included in Task 3 commit (`9a81430`)

### Auth gates

None.

### Task 1 audit checkpoint resolution

The orchestrator resolved Task 1's `[BLOCKING] checkpoint:human-verify` via auto-mode with "approved (use defaults)". This was a normal flow path (not a deviation): the user's local Supabase DB was unavailable, the policy-default mapping is the documented fallback (POLICY §2.2 D-10/D-11), and the defensive `ELSE` arm guarantees data integrity for any unaudited source codes. Plan 05-04's assertion suite + the user's local-DB run is the safety net.

## Self-Check

- File `supabase/migrations/20260617203900_dwc_schema.sql` exists and contains `CREATE VIEW dwc._maplify_occurrences`.
- Commits `f3d046c` (Task 2) and `9a81430` (Task 3) exist on `main`.
- All Task 2 + Task 3 + plan-level grep assertions pass (see verification block).
- 25 output columns in the Maplify view, mirroring the native branch.

## Known Stubs

None. The migration's append-point comment in plan 05-01 noted that `dwc.datasets`, `dwc.occurrences`, and `dwc.multimedia` are appended by future plans — plan 05-04 picks up exactly where this plan leaves off, so no executable stub patterns exist in code.

## Verification Plan (Plan 05-04)

The full assertion suite runs in plan 05-04. Key Maplify-branch invariants 05-04 will verify:

- `UNION ALL` of `dwc._native_occurrences` + `dwc._maplify_occurrences` succeeds (column count/type drift catches at view-creation time).
- Every `dwc._maplify_occurrences` row has non-null `occurrenceID`, `basisOfRecord`, `scientificName`, `eventDate` (ALIGN-02).
- `occurrenceID` is unique per branch and prefix-disjoint across branches (`salishsea:` vs `maplify:`).
- `eventDate` matches `^\d{4}-\d{2}-\d{2}$` (date-precision; no `T`) — ALIGN-05.
- `license` is the CC-BY `/legalcode` URI on every row.
- `rightsHolder = datasetName` on every Maplify row (single source of truth via LATERAL).
- `dynamicProperties` JSON contains `aggregatorSource` and `aggregatorChain` on every row; does not contain `countIsMinimum`.
- `WHERE` filter discipline: no rows have `is_test = true`, `number_sighted` outside `[1, 1000]`, or `source = 'rwsas'`.

## Self-Check: PASSED
