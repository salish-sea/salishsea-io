---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Export to DarwinCore Archive
status: SQL closer + assertion harness committed; live-DB validation DEFERRED to user (Tasks 3, 4 blocked on Docker daemon)
stopped_at: Phase 6 context gathered
last_updated: "2026-06-17T23:04:13.066Z"
last_activity: 2026-06-17
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 5
  completed_plans: 5
  percent: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-09)

**Core value:** The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.
**Current focus:** Phase 5 — DB Projection (`dwc` schema)

## Current Position

Phase: 6
Plan: Not started
Status: SQL closer + assertion harness committed; live-DB validation DEFERRED to user (Tasks 3, 4 blocked on Docker daemon)
Last activity: 2026-06-17

Progress: [████      ] 40%

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 5 Plan 04]: `dwc.occurrences` is a bare `SELECT * UNION ALL` of the two branch views (no explicit column projection) — Postgres enforces 25-column / type parity at `CREATE VIEW` time, so any future branch drift fails the migration loudly (RESEARCH §"Pattern 1: View-as-export-contract"). An explicit projection list would have to be maintained in lockstep with both branches.
- [Phase 5 Plan 04]: `dwc.datasets` is a view-over-VALUES (M-03 / D-15) with 19 columns sized for future per-constituent rows but shipping with exactly one row in v1.2 (D-16). M-04 commits `rainhead@gmail.com` verbatim in 3 places (creator_email / metadata_provider_email / contact_email) because `supabase/migrations/` is application code, not `.planning/`.
- [Phase 5 Plan 04]: `dwc.multimedia` is native-only — `maplify.sightings.photo_url` has no license column (POLICY §1.4 / assumption A3), so all Maplify photos are excluded. D-19 distinct CASE branches (`WHEN 'none' THEN NULL` terminal + `ELSE NULL` for IS NULL non-terminal) are encoded for forward-compat even though both currently map to NULL — a future "classify unknowns" workflow can swap `ELSE NULL` for a real URI without touching the `'none'` arm.
- [Phase 5 Plan 04]: Live-DB assertion run DEFERRED — Docker daemon not running, port 54322 closed, `supabase` CLI not on PATH. Per `<blocking_task_handling>` protocol, did NOT invent a passing verification. SQL + assertion harness committed; `05-VALIDATION.md` stays `nyquist_compliant: false` until the user runs `supabase db reset` + `psql -f supabase/snippets/05_dwc_assertions.sql` and the suite exits 0.
- [Phase 5 Plan 02]: `dwc._native_occurrences` freezes the 25-column UNION-ALL interface contract — every output column carries an explicit cast (`::text` / `::double precision` / `::integer`) so plan 05-03's Maplify branch must mirror exactly; cross-branch type drift would otherwise be Postgres's canonical UNION-ALL view failure mode (RESEARCH Pitfall 4).
- [Phase 5 Plan 02]: `dynamicProperties` lets NULL propagate through `jsonb_strip_nulls(jsonb_build_object(...))` rather than `COALESCE`-ing `extract_identifiers` to an empty array — opposite of the established `public.occurrences` pattern, because here we WANT the key dropped when there's no data (POLICY §2.3 omit-when-null).
- [Phase 5 Plan 02]: Per-row DwC constants (`datasetID`, `datasetName`, `license`, `basisOfRecord`, `occurrenceStatus`, `geodeticDatum`) are inlined as text literals rather than joined from `dwc.datasets` — they're identical on every native row and the join would buy nothing. Plan 05-04's `dwc.datasets` view is the source-of-truth for EML emission in Phase 6.
- [Phase 5 Plan 01]: M-05 higher-rank-only contract encoded in `dwc.taxa_classification` via explicit 12-rank IN list (genus/genushybrid/subgenus/species/complex/section/subsection/hybrid/subspecies/variety/form/infrahybrid) — survives any future inaturalist.rank enum reordering, where a positional `t.rank <= 'genus'` comparison would silently break.
- [Phase 5 Plan 01]: `inaturalist.rank::text` is cast directly to DwC `taxonRank` (no remapping CASE) — values match by construction for every in-scope rank per RESEARCH §rank-vocabulary-mapping.
- [Phase 5 Plan 01]: All four DwC views will live in a single migration (20260617203900_dwc_schema.sql); plans 05-02..05-04 append to it so the policy-to-SQL diff is reviewable in one file.
- [Phase 5 Plan 01]: `dwc` is intentionally NOT in `supabase/config.toml:api.schemas` (RESEARCH Pitfall 5) — it is a Phase 7 DuckDB consumer surface, not a PostgREST API surface; broad `GRANT SELECT` is deferred to plan 05-04.
- [v1.2 Roadmap]: Phase order honors the strict dependency chain from research — rights/gap policy (4) → DB projection (5) → archive generation (6) → nightly workflow (7) → frontend link (8). Phases 5–6 are offline-validatable before any prod-touching workflow exists.
- [v1.2 Scope]: Occurrence-record license = CC-BY-NC 4.0; assert license + document provenance, keep full native + Whale Alert scope (Phase 4 documents/encodes this policy rather than re-deciding it).
- [v1.2 Architecture]: DwC contract lives in a dedicated read-only `dwc` Postgres schema over source tables (not app-code mapping over `public.occurrences`); export script is a thin serializer; nightly via scheduled GitHub Actions reusing the existing AWS OIDC role + S3/CloudFront (no new AWS infra).
- [v1.0 Phase 02]: Lambda@Edge for rich previews; SSM credentials managed outside CDK
- [v1.1 Roadmap]: Pre-process body text before marked.parse to inject markdown links; CSV in src/ (bundled by Vite)
- [Phase ?]: [Phase 5 Plan 03]: Maplify branch source→display-name CASE materialized once per row via CROSS JOIN LATERAL — dn.display_name reused in rightsHolder, datasetName, dynamicProperties.aggregatorSource, and dynamicProperties.aggregatorChain. Single source of truth per row prevents drift across the four downstream columns (D-10/D-11).
- [Phase ?]: [Phase 5 Plan 03]: Task 1 audit checkpoint resolved with policy-default mapping via auto-mode (orca_network/cascadia + ELSE 'Whale Alert / Maplify'); defensive ELSE arm prevents data loss for unaudited source codes; plan 05-04 assertion suite catches any production drift.
- [Phase ?]: [Phase 5 Plan 03]: rwsas defensive filter (POLICY §5.3) included unconditionally in Maplify WHERE clause per RESEARCH Open Question 2 default — belt-and-suspenders against the ingest-time filter in 20250919034327_fix_maplify_taxon_mapping.sql.
- [Phase ?]: [Phase 5 Plan 03]: Maplify datasetName carries the per-record SUB-SOURCE name (e.g. 'Orca Network'), NOT the parent dataset title — deliberate divergence from the native branch; per-record datasetID still resolves to the parent URI on every row (POLICY §6.3).

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 4]: Whale Alert / Maplify redistribution terms are an external legal/ToS question — may need light phase-level research and could rescope to a native-only first cut. Sequenced first as a gate.
- [Phase 7]: Confirm the CloudFront behavior passes `/dwca/*` straight through to S3 rather than rewriting to the SPA `index.html` (verify against Lambda@Edge / behavior config).
- [Phase 7]: Introduces a possible NEW `production` GitHub environment secret (Supabase service-role / DB connection string). Per deployment memory, confirm with the user before the first workflow run.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260526-scf | Add taxon id 526556 Lutrinae to iNaturalist observations query migration | 2026-05-27 | 370c786 | [260526-scf-add-taxon-id-526556-lutrinae-to-inatural](./quick/260526-scf-add-taxon-id-526556-lutrinae-to-inatural/) |

## Session Continuity

Last session: 2026-06-17T23:04:13.059Z
Stopped at: Phase 6 context gathered
Resume file: .planning/phases/06-archive-generation/06-CONTEXT.md

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 5 P3 | 3min | 3 tasks | 1 files |
| Phase 5 P4 | 12min | 3 tasks committed (T1 SQL, T2 harness, T5 validation fill-in); T3+T4 deferred to user (Docker daemon down at execution time) | 2 created (snippets/05_dwc_assertions.sql, 05-04-SUMMARY.md), 2 modified (migration file, 05-VALIDATION.md) |
