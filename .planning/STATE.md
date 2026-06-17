---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Export to DarwinCore Archive
status: verifying
stopped_at: Phase 5 context gathered
last_updated: "2026-06-17T20:35:26.241Z"
last_activity: 2026-06-10
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
  percent: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-09)

**Core value:** The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.
**Current focus:** Phase 04 — rights-data-model-policy-gate

## Current Position

Phase: 04 (rights-data-model-policy-gate) — EXECUTING
Plan: 1 of 1
Status: Phase complete — ready for verification
Last activity: 2026-06-10

Progress: [██████████] 100%

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

Last session: 2026-06-17T20:35:26.237Z
Stopped at: Phase 5 context gathered
Resume file: .planning/phases/05-db-projection-dwc-schema/05-CONTEXT.md
