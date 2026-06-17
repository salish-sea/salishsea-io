---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Export to DarwinCore Archive
status: executing
stopped_at: Completed 05-01-PLAN.md
last_updated: "2026-06-17T21:12:18Z"
last_activity: 2026-06-17 -- Phase 5 Plan 01 completed (dwc schema + taxa_classification helper)
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 8
  completed_plans: 2
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-09)

**Core value:** The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.
**Current focus:** Phase 5 — DB Projection (`dwc` schema)

## Current Position

Phase: 5 (DB Projection (`dwc` schema)) — EXECUTING
Plan: 2 of 4
Status: Executing Phase 5
Last activity: 2026-06-17 -- Phase 5 Plan 01 completed (dwc schema + taxa_classification helper)

Progress: [██▌       ] 25%

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 5 Plan 01]: M-05 higher-rank-only contract encoded in `dwc.taxa_classification` via explicit 12-rank IN list (genus/genushybrid/subgenus/species/complex/section/subsection/hybrid/subspecies/variety/form/infrahybrid) — survives any future inaturalist.rank enum reordering, where a positional `t.rank <= 'genus'` comparison would silently break.
- [Phase 5 Plan 01]: `inaturalist.rank::text` is cast directly to DwC `taxonRank` (no remapping CASE) — values match by construction for every in-scope rank per RESEARCH §rank-vocabulary-mapping.
- [Phase 5 Plan 01]: All four DwC views will live in a single migration (20260617203900_dwc_schema.sql); plans 05-02..05-04 append to it so the policy-to-SQL diff is reviewable in one file.
- [Phase 5 Plan 01]: `dwc` is intentionally NOT in `supabase/config.toml:api.schemas` (RESEARCH Pitfall 5) — it is a Phase 7 DuckDB consumer surface, not a PostgREST API surface; broad `GRANT SELECT` is deferred to plan 05-04.
- [v1.2 Roadmap]: Phase order honors the strict dependency chain from research — rights/gap policy (4) → DB projection (5) → archive generation (6) → nightly workflow (7) → frontend link (8). Phases 5–6 are offline-validatable before any prod-touching workflow exists.
- [v1.2 Scope]: Occurrence-record license = CC-BY-NC 4.0; assert license + document provenance, keep full native + Whale Alert scope (Phase 4 documents/encodes this policy rather than re-deciding it).
- [v1.2 Architecture]: DwC contract lives in a dedicated read-only `dwc` Postgres schema over source tables (not app-code mapping over `public.occurrences`); export script is a thin serializer; nightly via scheduled GitHub Actions reusing the existing AWS OIDC role + S3/CloudFront (no new AWS infra).
- [v1.0 Phase 02]: Lambda@Edge for rich previews; SSM credentials managed outside CDK
- [v1.1 Roadmap]: Pre-process body text before marked.parse to inject markdown links; CSV in src/ (bundled by Vite)

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

Last session: 2026-06-17T21:12:18Z
Stopped at: Completed 05-01-PLAN.md
Resume file: .planning/phases/05-db-projection-dwc-schema/05-02-PLAN.md
