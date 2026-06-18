---
phase: 05-db-projection-dwc-schema
plan: 01
subsystem: database
tags: [postgres, supabase, darwincore, dwc, recursive-cte, taxonomy, view, schema]

# Dependency graph
requires:
  - phase: 04-rights-data-model-policy-gate
    provides: 04-POLICY.md §3.1/§3.2/§6.7 — gap mappings + Phase 5/6 ownership split + M-05 higher-rank-only contract
provides:
  - dwc schema with USAGE granted to anon, authenticated
  - dwc.taxa_classification helper view (recursive walk over inaturalist.taxa.parent_id)
  - Migration file 20260617203900_dwc_schema.sql with marked append-point for plans 05-02..05-04
affects: [05-02-native-branch, 05-03-maplify-branch, 05-04-union-datasets-multimedia, 06-archive-generation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "View-as-export-contract — dwc.* views freeze column types/order for the Phase 7 DuckDB consumer"
    - "Recursive CTE with depth guard — WITH RECURSIVE + WHERE depth < 50 defense-in-depth for accidental cycles"
    - "Single-migration-multi-plan — plans 05-01..05-04 all append to one cohesive 20260617203900 migration so the policy-to-SQL diff is reviewable in one file"

key-files:
  created:
    - supabase/migrations/20260617203900_dwc_schema.sql
  modified: []

key-decisions:
  - "Encode the inaturalist.rank → DwC taxonRank mapping as a direct text cast (t.rank::text) — values match by construction for every in-scope rank (RESEARCH §rank-vocabulary-mapping)"
  - "Gate the genus column with an explicit 12-rank IN list rather than a positional enum comparison so the M-05 higher-rank-only contract survives any future enum reordering"
  - "Add a depth < 50 guard on the recursive arm even though iNaturalist tree depth is well below 30 — pure defense in depth against accidental future cycles (RESEARCH A2)"
  - "Keep dwc out of supabase/config.toml:api.schemas — it is a Phase 7 DuckDB consumer surface, NOT a PostgREST API surface (Pitfall 5)"
  - "Grant USAGE on the schema in this plan; defer the broad GRANT SELECT ON ALL TABLES IN SCHEMA dwc to plan 05-04 so it covers every view in one statement"

patterns-established:
  - "Schema header documents known discrepancies (table renames, today-unreachable CASE arms) in the file itself — reviewers of plans 05-02..05-04 can see the rationale without round-tripping to .planning/"
  - "All references to source tables are fully qualified (inaturalist.taxa, not bare taxa) to mitigate T-05-04 search-path hijack"

requirements_completed: [ALIGN-03]

# Metrics
duration: ~8min
completed: 2026-06-17
---

# Phase 5 Plan 01: dwc schema scaffolding + taxa_classification helper Summary

**Seed migration creates the `dwc` schema (USAGE-only to anon/authenticated) plus `dwc.taxa_classification`, a recursive view over `inaturalist.taxa.parent_id` that pivots Linnaean ancestors into columns while enforcing the M-05 higher-rank-only contract.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-17T21:04:00Z (approx)
- **Completed:** 2026-06-17T21:12:18Z
- **Tasks:** 2
- **Files modified:** 1 (new file)

## Accomplishments

- **`dwc` schema created** with `GRANT USAGE … TO anon, authenticated` — service role inherits via Supabase defaults. The schema is deliberately NOT added to `supabase/config.toml:api.schemas` (RESEARCH Pitfall 5), so PostgREST cannot expose it.
- **`dwc.taxa_classification` helper view** walks `inaturalist.taxa.parent_id` via `WITH RECURSIVE`, pivots the ancestor chain into one Linnaean column per rank, and emits the per-taxon row consumed by both branch views in plans 05-02 and 05-03.
- **Higher-rank-only contract encoded** — for taxa whose own rank is `family` or above, `scientific_name` carries the taxon's own name (e.g., `Delphinidae`) and `genus` is `NULL`. No fabricated binomial. Closes ALIGN-03 at the SQL surface.
- **Migration header documents both schema discrepancies** flagged by RESEARCH (table rename `sightings → observations`, and the D-19 `IS NULL` arm being today-unreachable on `public.observation_photos.license_code`) so reviewers of plans 05-02..05-04 do not flag those choices as wrong.
- **Append-point marker** left at file tail so plans 05-02..05-04 know exactly where to add their statements.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author migration header, CREATE SCHEMA, and GRANT USAGE** — `58e4233` (feat)
2. **Task 2: Append CREATE VIEW dwc.taxa_classification (recursive CTE + Linnaean pivot)** — `bb62272` (feat)

**View output columns (in declaration order):**
`taxon_id`, `taxon_rank`, `scientific_name`, `kingdom`, `phylum`, `class`, `order_`, `family`, `genus`.

**Genus CASE rank list (12 ranks at or below genus that get a genus value populated):**
`genus`, `genushybrid`, `subgenus`, `species`, `complex`, `section`, `subsection`, `hybrid`, `subspecies`, `variety`, `form`, `infrahybrid`. Any taxon whose own rank is outside this list gets `genus = NULL` (M-05 contract).

This file is the **seed for plans 05-02..05-04**, which append `dwc.datasets`, `dwc._native_occurrences`, `dwc._maplify_occurrences`, `dwc.occurrences`, `dwc.multimedia`, and the broad `GRANT SELECT` to the same migration.

## Files Created/Modified

- `supabase/migrations/20260617203900_dwc_schema.sql` — new migration. Header comment names Phase 5 ownership + both schema discrepancies; emits `CREATE SCHEMA dwc`, `GRANT USAGE ON SCHEMA dwc TO anon, authenticated`, and `CREATE VIEW dwc.taxa_classification AS …` (recursive CTE + Linnaean pivot, with `depth < 50` cycle guard and explicit-rank-list genus CASE); leaves a marked placeholder for plans 05-02..05-04.

## Decisions Made

- **Migration-header-documents-discrepancies.** Both RESEARCH-flagged discrepancies (table rename, today-unreachable D-19 NULL arm) live as block comments in the migration itself, so reviewers can see the rationale alongside the code rather than having to round-trip through `.planning/`. (RESEARCH §"CRITICAL Schema Discrepancies".)
- **Direct enum-to-text cast for `taxon_rank`.** `inaturalist.rank` values match the DwC `taxonRank` vocabulary by construction for every rank in scope; the `CASE` remap RESEARCH considered would have been zero-information. (RESEARCH §"`inaturalist.rank` → DwC `taxonRank` Vocabulary Mapping".)
- **Explicit-rank-list genus CASE rather than `t.rank <= 'genus'`.** Positional enum comparison would silently re-shape if the enum was ever reordered; the IN list is reviewable on its own and survives reorderings. (Same as M-05 contract intent.)
- **No per-view `GRANT SELECT` yet.** Deferred to the single `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated;` at the end of plan 05-04 — covers every view at once and means each plan does not have to remember.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. Local verification is a future task (plan 05-04 will add the assertion suite and run `supabase db reset`).

## Self-Check

Verified after writing this summary:

```
$ test -f supabase/migrations/20260617203900_dwc_schema.sql && echo FOUND
FOUND
$ grep -c 'CREATE SCHEMA dwc' supabase/migrations/20260617203900_dwc_schema.sql
1
$ grep -c 'CREATE VIEW dwc.taxa_classification' supabase/migrations/20260617203900_dwc_schema.sql
1
$ grep -v '^--' supabase/migrations/20260617203900_dwc_schema.sql | grep -c -E ' (FROM|JOIN) taxa[[:space:]]'
0
$ git diff supabase/config.toml | wc -l
0
$ git log --oneline | grep -E '58e4233|bb62272'
bb62272 feat(05-01): add dwc.taxa_classification recursive helper view
58e4233 feat(05-01): create dwc schema with USAGE grants
```

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 05-02 (native branch view) unblocked.** It can `JOIN dwc.taxa_classification ON taxon_id = o.taxon_id` and pick up `taxon_rank`, `scientific_name`, `kingdom`..`genus` directly — the M-05 contract is already enforced upstream, so the native branch does not need to re-decide what to do for family-rank taxa.
- **Plan 05-03 (Maplify branch view) unblocked** for the same reason; same JOIN shape on `s.taxon_id`.
- **Plans 05-02..05-04 append to this same migration file.** The trailing `-- (continued: …)` comment marks the append point.
- No blockers. No concerns.

---
*Phase: 05-db-projection-dwc-schema*
*Completed: 2026-06-17*
