---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: — Providers, Collections & Contributors
status: executing
stopped_at: Phase 10 context gathered
last_updated: "2026-06-19T20:37:56.485Z"
last_activity: 2026-06-19 -- Phase 10 planning complete
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
  percent: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-19)

**Core value:** The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.
**Current focus:** Phase 9 — Reference Table Foundation

## Current Position

Phase: 10
Plan: Not started
Status: Ready to execute
Last activity: 2026-06-19 -- Phase 10 planning complete

Progress: `░░░░░░░░░░` 0% (0/5 phases complete)

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.3 Roadmap]: Provider ≠ collection — Maplify is the provider, Orca Network FB Group is the collection. A channel is stable if re-sourced; provider is per-record provenance on the sighting, never a property of the collection. `aggregator_ingest` dropped from `collection_kind` enum by construction.
- [v1.3 Roadmap]: FK columns go directly on each source table (Option A) — established by the existing `public.observations.contributor_id` and `maplify.sightings.taxon_id REFERENCES inaturalist.taxa(id)` cross-schema FK precedent.
- [v1.3 Roadmap]: SalishSea.io is the GBIF aggregator — `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"` fixed on every exported row. Upstream org credit goes in EML `associatedParty`, never `institutionCode`.
- [v1.3 Roadmap]: One collection per external platform for iNat and HappyWhale (not per project). Per-project granularity adds complexity with no GBIF payoff.
- [v1.3 Roadmap]: URL-pattern resolver is ingest-time TypeScript (pure function, ~20 lines in `scripts/ingest/resolve-provider.ts`), not a DB function. Results stored as FKs; views read pre-resolved FKs.
- [v1.3 Roadmap]: Exact-match backfill dictionary only — no alias table, no fuzzy match. Typo variants (e.g. "Orca Neteork") go in the VALUES dictionary. Full `SELECT DISTINCT` bracket-tag census against prod required before any UPDATE.
- [v1.3 Roadmap]: `collection_id` is nullable at column-creation time; NOT NULL constraint (if applied at all) only after backfill completeness verified. Some Maplify rows will permanently have collection_id = NULL.
- [v1.3 Roadmap]: `comments` column is immutable during backfill — bracket tags and trailing attributions are the audit trail. Strip at view/read time only, never as an UPDATE.
- [v1.3 Roadmap]: Trailing "Submitted by … Trusted Observer" lines yield collection/org only, never contributor. Using them for `contributor_id` is a category error that silently corrupts ~2,740 rows.
- [v1.3 Roadmap]: DwC view rebuild is the highest-risk phase — 26-column coordinated change across `dwc._native_occurrences`, `dwc._maplify_occurrences`, `dwc.occurrences`, `scripts/dwca/fields.ts`, `scripts/dwca/fields.test.ts`, and `meta.xml` output. Must be a single PR with `npm test` gate before merge.
- [v1.3 Roadmap]: SRC-01 export exclusion of iNat/HappyWhale preserved by construction (UNION of exactly two branches), not by WHERE filter. Row-count gate in the nightly job is the runtime guard.
- [v1.3 Roadmap]: SELECT grants on new reference tables (`providers`, `organizations`, `collections`) must be included in the table-creation migration — not a follow-up. Supabase RLS defaults can silently zero-out DwC JOINs.
- [v1.3 Roadmap]: `contributor.orcid` nullable column added in Phase 9 (CONTRIB-02); population requires manual curation of the 28 native contributors and is deferred.
- [v1.3 Roadmap]: Cross-provider contributor unification deferred (`jmaughn` iNat ≈ James Maughn native is a known probable match, not a confirmed identity). A `contributor_links` table is the future extension point; no shared FK across providers this milestone.
- [v1.2 Phase 5 Plan 04]: `dwc.occurrences` is a bare `SELECT * UNION ALL` of the two branch views — Postgres enforces 25-column / type parity at `CREATE VIEW` time, so any future branch drift fails the migration loudly.
- [v1.2 Phase 5 Plan 04]: `dwc.datasets` is a view-over-VALUES (M-03 / D-15) with 19 columns sized for future per-constituent rows but shipping with exactly one row in v1.2 (D-16).
- [v1.2 Phase 5 Plan 04]: `dwc.multimedia` is native-only — `maplify.sightings.photo_url` has no license column (POLICY §1.4 / assumption A3), so all Maplify photos are excluded.
- [v1.2 Phase 5 Plan 02]: `dwc._native_occurrences` freezes the 25-column UNION-ALL interface contract — every output column carries an explicit cast so plan 05-03's Maplify branch must mirror exactly.
- [v1.0 Phase 02]: Lambda@Edge for rich previews; SSM credentials managed outside CDK.
- [v1.1 Roadmap]: Pre-process body text before marked.parse to inject markdown links; CSV in src/ (bundled by Vite).
- [Phase ?]: [Phase 9 Plan 01]: aggregator_ingest excluded from collection_kind enum by construction; SC-3 assertion verifies via failed cast (D-09)
- [Phase ?]: [Phase 9 Plan 01]: rights_holder_text column added to public.organizations for EML associatedParty display in Phase 12 (A1 assumption confirmed)

### Pending Todos

- [database]: Model embedded dataset attributions as first-class sources — THIS IS THE v1.3 MILESTONE. The v1.2 todo (bracket tags + trailing "Submitted by …" lines becoming real source refs) is the core work of Phases 9-13. Mark resolved when Phase 13 passes.
- [verification]: Retry GBIF DwC-A validator for DWCA-05 — the v1.2 validator run was blocked by the gbif.org service being offline (2026-06-19). Re-upload the existing zip to gbif.org/tools/data-validator when the service returns; this is pre-v1.3 work independent of the milestone. (See `.planning/todos/pending/2026-06-18-retry-gbif-validator-for-dwca-05.md`)

### Blockers/Concerns

None at roadmap time. Phase 11 (Backfill) requires a full `SELECT DISTINCT` bracket-tag census against prod as its first action — do not skip this step.

## Deferred Items

Items acknowledged and deferred at v1.3 roadmap creation (2026-06-19):

| Category | Item | Status / Notes |
|----------|------|----------------|
| verification | Phase 04 04-VERIFICATION.md (v1.2) | human_needed — three policy-doc human-review advisories (Sections 1-2 completeness, Section 4 conferral framing, Section 3 gap coverage). All auto checks green. |
| quick_task | 260526-scf-add-taxon-id-526556-lutrinae-to-inatural | unknown — shipped in commit 370c786; status flag remains stale. |
| todo (database) | 2026-06-17-model-embedded-dataset-attributions-as-first-class-sources.md | PROMOTED to v1.3 milestone (Phases 9-13). |
| todo (phase-06-followup) | 2026-06-18-retry-gbif-validator-for-dwca-05.md | pending — re-upload deterministic zip when gbif.org validator service returns. Independent of v1.3 work. |
| future | Cross-provider contributor unification (jmaughn case) | Deferred — `contributor_links` table is the extension point; no shared FK this milestone. |
| future | URL → whole-occurrence importer (source_url Layer 2) | Deferred — seeded at seeds/url-to-occurrence-importer.md. |
| future | Populate contributor ORCIDs for native contributors | Deferred — CONTRIB-02 ships the column; data entry is later. |
| future | App UI org/collection browse pages | Deferred to a later frontend phase. |

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260526-scf | Add taxon id 526556 Lutrinae to iNaturalist observations query migration | 2026-05-27 | 370c786 | [260526-scf-add-taxon-id-526556-lutrinae-to-inatural](./quick/260526-scf-add-taxon-id-526556-lutrinae-to-inatural/) |

## Session Continuity

Last session: 2026-06-19T20:19:36.682Z
Stopped at: Phase 10 context gathered
Resume: `/gsd-plan-phase 9` to begin Phase 9 (Reference Table Foundation)

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 5 P3 | 3min | 3 tasks | 1 files |
| Phase 5 P4 | 12min | 3 tasks committed (T1 SQL, T2 harness, T5 validation fill-in); T3+T4 deferred to user (Docker daemon down at execution time) | 2 created (snippets/05_dwc_assertions.sql, 05-04-SUMMARY.md), 2 modified (migration file, 05-VALIDATION.md) |
| Phase 09-reference-table-foundation P01 | 10min | 3 tasks | 2 files |

## Operator Next Steps

- Run `/gsd-plan-phase 9` to begin Phase 9: Reference Table Foundation
