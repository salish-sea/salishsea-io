---
phase: 04-rights-data-model-policy-gate
plan: 01
subsystem: documentation
tags: [darwincore, dwc-a, creative-commons, rights, attribution, gbif, maplify, whale-alert]

# Dependency graph
requires: []
provides:
  - "04-POLICY.md: single authoritative rights & data-model policy document for DwC-A archive"
  - "CC-BY-NC 4.0 legalcode URI as constant license for all occurrence records"
  - "Per-photo CC license converter table (cc0/cc-by/cc-by-nc/etc. → GBIF-parseable URIs)"
  - "Attribution/provenance field mappings for native (D-09) and third-party (D-10/D-11) records"
  - "dynamicProperties key/value schema: travelDirection, aggregatorSource, aggregatorChain, countIsMinimum, unvalidatedIdentifiers"
  - "Per-source data-model gap table with explicit resolutions (GAP-01)"
  - "Third-party redistribution conferral questions + include-and-attribute/hosted-but-unlinked hold rule"
  - "D-14 correction: min_count is happywhale-only; Maplify uses exact number_sighted; D-14 is no-op for v1.2"
affects:
  - phase-05-db-projection
  - phase-06-archive-generation
  - phase-07-nightly-workflow
  - phase-08-frontend-download-link

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Policy-first gate: document rights/gaps before encoding in SQL or generator"
    - "Hosted-but-unlinked hold: publish archive to stable URL; suppress only frontend link"
    - "Include-and-attribute default: retreat only on explicit prohibition or conferral no"
    - "Per-source drop granularity: filter by maplify.source to drop a sub-source without dropping the feed"

key-files:
  created:
    - .planning/phases/04-rights-data-model-policy-gate/04-POLICY.md
  modified: []

key-decisions:
  - "Occurrence-record license = https://creativecommons.org/licenses/by-nc/4.0/legalcode (constant column on all records)"
  - "Per-photo CC license converter pinned at version 4.0 for all CC variants (Assumption A1)"
  - "Native consent basis: platform-policy assertion for existing records + submission-form notice going forward (D-08)"
  - "D-14 no-op for v1.2: min_count is happywhale.encounters column, not maplify.sightings; Maplify uses exact number_sighted"
  - "Third-party redistribution: include-and-attribute default (D-02) + hosted-but-unlinked hold (D-05) pending conferral"
  - "Native records publicly eligible independently of third-party conferral (D-06); D-07 implementation question open for Phase 7/8"

patterns-established:
  - "Policy sections 1-5 are stable anchors cited by Phases 5-8 — do not rename without updating downstream references"
  - "Every gap in Section 3 has an explicit resolution row — no silent defaults"
  - "D-NN citations in policy sections are the canonical cross-references; downstream phases encode, they do not re-decide"

requirements-completed: [GAP-01, GAP-02, GAP-03, GAP-04]

# Metrics
duration: 4min
completed: 2026-06-10
---

# Phase 4 Plan 01: Rights & Data-Model Policy Summary

**Single authoritative 04-POLICY.md closes all four rights/gap requirements: CC-BY-NC 4.0 legalcode URI, per-photo CC converter, native/third-party attribution model, per-source gap table with explicit resolutions, and include-and-attribute/hosted-but-unlinked hold rule with per-org conferral questions**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-10T18:07:01Z
- **Completed:** 2026-06-10T18:10:54Z
- **Tasks:** 3 (all tasks authored in one contiguous writing pass)
- **Files modified:** 1

## Accomplishments

- Authored 333-line `04-POLICY.md` with all five named sections (## 1..## 5) and all D-01..D-14 cited
- Resolved every audited data/datatype gap with an explicit encoding rule (Section 3 gap tables) — GAP-01
- Recorded CC-BY-NC 4.0 legalcode URI, per-photo converter, and native consent basis (D-08) — GAP-02
- Specified `recordedBy`/`rightsHolder`/`datasetName` for native (D-09) and third-party (D-10/D-11) sources plus `dynamicProperties` schema — GAP-03
- Documented include-and-attribute default + hosted-but-unlinked hold + per-org conferral questions for Whale Alert/Conserve.IO, Orca Network, and Cascadia Research — GAP-04
- Recorded the D-14 min-count correction: CONTEXT.md's "maplify `min_count`" is a documentation inaccuracy; `min_count` is `happywhale.encounters` only; D-14 is a no-op for v1.2

## Task Commits

All three tasks were authored as one coherent writing pass over the single deliverable `04-POLICY.md`:

1. **Task 1: License & Rights and Attribution & Provenance sections** - `631bf50` (docs)
2. **Task 2: Data-Model Gaps & Resolutions and Scope Clarifications sections** - `631bf50` (docs)
3. **Task 3: Third-Party Redistribution Status section** - `631bf50` (docs)

## Files Created/Modified

- `.planning/phases/04-rights-data-model-policy-gate/04-POLICY.md` — Single authoritative rights & data-model policy document, 333 lines, five named sections

## Decisions Made

- All D-01..D-14 decisions are documented in `04-POLICY.md`; the key new contributions of this phase are the `dynamicProperties` key/value schema proposal (Claude's Discretion per CONTEXT.md), the D-14 no-op correction, and the precisely framed per-organization conferral questions.
- Assumption A1 (per-photo licenses pinned at v4.0) and Assumption A2 (expected `maplify.source` values) are recorded explicitly in the policy document so Phase 5 knows to verify before encoding.

## Deviations from Plan

None — plan executed exactly as written. Documentation-only phase; no code, SQL, schema changes, or migrations produced.

## Issues Encountered

None. The research in `04-RESEARCH.md` provided all necessary grounding. The D-14 schema discrepancy (CONTEXT.md referencing "maplify `min_count`") was already identified and analyzed in RESEARCH.md, so it required only recording the correction in the policy document.

## User Setup Required

None — no external service configuration required. Organizational conferral (contacting Whale Alert/Conserve.IO, Orca Network, Cascadia Research) is an out-of-band, non-engineering task tracked as the gate that un-hides third-party records.

## Next Phase Readiness

- `04-POLICY.md` is ready for Phase 5 (DB Projection) to encode as SQL predicates and computed columns in the `dwc` schema
- Section 3 gap tables provide direct column-level guidance for `dwc.occurrences` view construction
- Section 2.3 `dynamicProperties` schema is ready for Phase 5 SQL assembly
- Section 4 holding rule (D-05) is ready for Phase 7 hosting implementation
- Phase 8 planner must resolve the D-07 open question (native-only archive variant mechanism)
- Blockers: None from this phase. The D-08 submission-form notice needs a roadmap home (small frontend task or Phase 8 extension) before the public download link goes live.

---
*Phase: 04-rights-data-model-policy-gate*
*Completed: 2026-06-10*
