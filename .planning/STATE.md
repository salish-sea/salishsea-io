---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Export to DarwinCore Archive
status: planning
stopped_at: Phase 4 context gathered
last_updated: "2026-06-10T17:41:32.136Z"
last_activity: 2026-06-10 — v1.2 roadmap created (Phases 4–8), 20/20 requirements mapped
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-09)

**Core value:** The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.
**Current focus:** v1.2 Export to DarwinCore Archive — Phase 4 (Rights & Data-Model Policy) ready to plan

## Current Position

Phase: 4 of 8 (Rights & Data-Model Policy) — first phase of v1.2
Plan: — (not yet planned)
Status: Roadmap created — ready to plan Phase 4
Last activity: 2026-06-10 — v1.2 roadmap created (Phases 4–8), 20/20 requirements mapped

Progress: [░░░░░░░░░░] 0%

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

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

Last session: 2026-06-10T17:41:32.126Z
Stopped at: Phase 4 context gathered
Resume file: .planning/phases/04-rights-data-model-policy-gate/04-CONTEXT.md
