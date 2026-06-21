---
phase: 13-verification-gbif-re-validation
plan: 01
subsystem: testing
tags: [vitest, darwincore, gbif, eml, dwca, typescript]

# Dependency graph
requires:
  - phase: 12-dwc-view-rebuild
    provides: 26-column dwc.occurrences view with institutionCode/rightsHolder/datasetName/associatedParty EML support
  - phase: 11-maplify-backfill
    provides: Maplify bracket-tag and trailing-attribution backfill; comments immutability invariant
  - phase: 10-source-table-fk
    provides: nullable collection_id FK on maplify.sightings
  - phase: 9-reference-tables
    provides: providers/organizations/collections tables with SELECT grants

provides:
  - "scripts/dwca/verify-artifact.ts: artifact-level SC#2/SC#3/SC#4 verifier (buildHeaderIndex + row/EML assertions + main CLI)"
  - "scripts/dwca/verify-artifact.test.ts: 32 fixture-driven unit tests, no build/DB required"
  - ".planning/phases/13-verification-gbif-re-validation/13-CHECKLIST.md: 11 prod-DB checklist query results (5 active + 6 prior-phase confirmations; all 12 PITFALLS items green)"

affects:
  - 13-02-validate-gbif (Wave 2 — GBIF REST API submission/poll/assert)
  - 13-03-remediation (Wave 2 — inline fix + final VERIFICATION.md)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Artifact-level verification: resolve columns by name from OCCURRENCE_FIELDS via buildHeaderIndex (no hardcoded indices)"
    - "Pure assertion functions (assertNoExcludedOccurrenceIDs, assertInstitutionCode, etc.) wrapping file I/O in verifyArtifact for testability"
    - "EML assertions via regex over associatedParty blocks — mirrors the literal shape in eml.ts"

key-files:
  created:
    - scripts/dwca/verify-artifact.ts
    - scripts/dwca/verify-artifact.test.ts
    - .planning/phases/13-verification-gbif-re-validation/13-CHECKLIST.md
  modified: []

key-decisions:
  - "Separate verify-artifact.ts from verify-publish.ts (verify-publish is HTTP-only / never reads disk; artifact parsing is a distinct concern)"
  - "Column resolution by name via buildHeaderIndex keyed off OCCURRENCE_FIELDS — throws on drift (Pitfall 6 prevention)"
  - "Pure assertion cores (assertOccurrenceRows family + assertEmlTitle/assertEmlAssociatedParties) with verifyArtifact wrapping fs reads — enables fixture-driven tests with no disk I/O"
  - "SC#4a uses regex over associatedParty block spans to extract organizationNames — mirrors exact eml.ts literal shape; then checks those names against institutionCode elements"
  - "All 12 PITFALLS checklist items recorded PASS via prod-DB read-only queries; prior-phase items confirmed with 'verified by Phase N' evidence notes"

patterns-established:
  - "Artifact-level verifier pattern: pure assertion functions + verifyArtifact wrapper + main() CLI guard (mirrors verify-publish.ts shape)"
  - "buildHeaderIndex: Map<name, index> from header line, throws on missing OCCURRENCE_FIELDS columns"

requirements-completed: [ATTR-05]

# Metrics
duration: 12min
completed: 2026-06-21
---

# Phase 13 Plan 01: Artifact Verifier + DB Checklist Summary

**Artifact-level SC#2/SC#3/SC#4 verifier (verify-artifact.ts) with 32 fixture-driven tests + all 12 PITFALLS checklist items recorded green via prod-DB read-only queries**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-21T21:45:00Z
- **Completed:** 2026-06-21T21:57:28Z
- **Tasks:** 2
- **Files modified:** 3 created

## Accomplishments

- Created `scripts/dwca/verify-artifact.ts` with column-name-keyed TSV parsing, SC#2/SC#3/SC#4 assertions, and a CLI `main()` entry point mirroring `verify-publish.ts`'s shape
- Wrote `scripts/dwca/verify-artifact.test.ts` with 32 fixture-driven unit tests covering all success/failure branches (including SC#4a presence check, SC#4a org-in-institutionCode leak check, SC#4b v1.3 title check) — all pass with no build or DB needed
- Ran 11 read-only prod-DB queries via `npx supabase db query --linked`, recording all results in `13-CHECKLIST.md`: 5 active Phase-13 SC checks (all PASS) + 6 prior-phase confirmations (all PASS) — all 12 PITFALLS "Looks Done But Isn't" items are green

## Task Commits

1. **Task 1: verify-artifact.ts + test suite** - `f34b773` (feat)
2. **Task 2: 13-CHECKLIST.md prod-DB results** - `b10cc1c` (chore)

## Files Created/Modified

- `scripts/dwca/verify-artifact.ts` — exports `buildHeaderIndex`, assertion cores, `verifyArtifact`, `main`; resolves columns by name from `OCCURRENCE_FIELDS`; SC#2/SC#3/SC#4 checks
- `scripts/dwca/verify-artifact.test.ts` — 32 fixture-driven unit tests (inline TSV + EML strings; no build/DB)
- `.planning/phases/13-verification-gbif-re-validation/13-CHECKLIST.md` — 11 prod-DB checklist query results with actual values and PASS verdicts

## Prod-DB Checklist Results (5 Active)

| Check | Result | Verdict |
|-------|--------|---------|
| SRC-01 | dwc=4413 ≤ native(436)+maplify(4442)=4878 | PASS |
| institutionCode | exactly `{'SalishSea'}` | PASS |
| rightsHolder | exactly `{'SalishSea.io'}` | PASS |
| datasetName | 19 distinct values, all `'SalishSea.io — …'` | PASS |
| occurrenceID prefix | 0 excluded IDs | PASS |

## Prior-Phase Confirmations (6)

| Item | Check | Result | Evidence |
|------|-------|--------|----------|
| 1 | Backfill completeness | 0 unresolved bracket-tagged rows | verified by Phase 11 |
| 2 | Trailing-attribution completeness | 0 unresolved Trusted Observer rows | verified by Phase 11 |
| 8 | Submitted by not contributor | 0 contributor_id from Trusted Observer | verified by Phase 11 |
| 9 | comments immutability | 2354 tagged rows intact | verified by Phase 11/12 |
| 11 | RLS/grants | providers=4, orgs=5, collections=22 | verified by Phase 9 |
| 12 | FK ingest safety | collection_id is_nullable=YES | verified by Phase 10 |

## Decisions Made

- Created a new `verify-artifact.ts` rather than extending `verify-publish.ts` (the existing verifier is HTTP-only / "NEVER ATTACHes / reads disk" per its header — artifact parsing is a distinct concern; Claude's-discretion D from plan)
- SC#4a implemented with a two-phase regex: first extract all `<associatedParty>` block spans, then extract `<organizationName>` inside each block; then check those names against any `<institutionCode>` elements — mirrors the literal shape in `eml.ts`
- `spotCheckRecordedBy` (SC#3d) is implemented as a non-fatal report (logs to stdout) with a boolean return value for testability — plan specifies it as "reported, not a hard gate"

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Two pre-existing test failures (`src/obs-map.test.ts`, `src/salish-sea.test.ts` — OpenLayers CSS import issue) are unrelated to this plan and were present before execution.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes were introduced. The verifier reads local files (occurrence.txt, eml.xml) and the checklist queries are read-only via the existing Supabase CLI mechanism. No new trust boundaries opened.

## Next Phase Readiness

- `verify-artifact.ts` is ready for consumption by Wave 2 (Plan 13-03 verification pass) after a fresh local build
- `13-CHECKLIST.md` provides the DB-side baseline for reconciliation against the artifact-level run in Plan 13-03
- All 12 PITFALLS items confirmed green — no defects found for Plan 13-03 inline remediation (D-06)

## Self-Check: PASSED

All 4 created files found at expected paths. Both task commits (f34b773, b10cc1c) confirmed in git log.

---
*Phase: 13-verification-gbif-re-validation*
*Completed: 2026-06-21*
