---
phase: 12-dwc-view-rebuild
plan: 03
subsystem: api
tags: [eml, gbif, dwca, xml, duckdb, attribution]

# Dependency graph
requires:
  - phase: 12-dwc-view-rebuild
    plan: 02
    provides: "Rebuilt trusted-only 26-column dwc.occurrences view; dwc.datasets row bumped to v1.3"
provides:
  - AssociatedParty interface and EmlInput.associatedParties field in eml.ts
  - <associatedParty> rendering in buildEml (xmlEsc on name/url; GBIF EML 2.1.1 placement)
  - Build-time Step 15.5 associated-parties query in build.ts (data-driven, trusted-only)
  - associatedParties passed into buildEml in Step 17
  - Confirmed guard.ts reads dwc.occurrences with ROW_FLOOR=1000 unchanged (ATTR-03)
affects: [future EML edits, GBIF validator upload, nightly build pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AssociatedParty interface pattern: readonly name/url/role typed struct for EML attribution"
    - "associatedPartyXml computed via .map().join() — same shape as other xmlEsc interpolations"
    - "Step 15.5 DuckDB query: runAndReadAll + getRowObjects().map() pattern (mirrors Step 16)"

key-files:
  created: []
  modified:
    - scripts/dwca/eml.ts
    - scripts/dwca/eml.test.ts
    - scripts/dwca/build.ts

key-decisions:
  - "D-08 enforced: only orgs with exported rows credited — DISTINCT JOIN over collections, not all seeded orgs"
  - "D-09 enforced: role is always 'contentProvider'; upstream orgs NEVER appear as institutionCode"
  - "Pitfall 7 placement: associatedParty goes after </metadataProvider> and before <pubDate>"
  - "Empty associatedParties list emits no <associatedParty> element (no empty tag)"
  - "guard.ts ROW_FLOOR=1000 confirmed unchanged — trusted-only count (~4,411 prod rows) exceeds floor"
  - "build.test.ts needs no new stubs — it is an integration test gated on SUPABASE_DB_URL (skipped in unit mode)"

patterns-established:
  - "AssociatedParty interface: export readonly struct from eml.ts, import type into build.ts"
  - "EML block interpolation: conditional '\n' + block so empty list produces no whitespace artifact"

requirements-completed: [ATTR-04, ATTR-03]

# Metrics
duration: 2min
completed: 2026-06-21
---

# Phase 12 Plan 03: EML AssociatedParty + Build-time Org Query Summary

**EML <associatedParty> rendering with xmlEsc, data-driven trusted-only build query, and confirmed ROW_FLOOR guard — ATTR-04 and ATTR-03 complete**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-21T19:56:19Z
- **Completed:** 2026-06-21T19:58:54Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added AssociatedParty interface and EmlInput.associatedParties to eml.ts; buildEml now renders data-driven `<associatedParty>` elements with xmlEsc on name and url in the GBIF EML 2.1.1 schema-correct position (after `<metadataProvider>`, before `<pubDate>`)
- Added Step 15.5 in build.ts: DuckDB query selecting DISTINCT org name/url via collections JOIN organizations, filtered to the trusted-only Maplify rows UNION native branch, ORDER BY name — passes result as AssociatedParty[] to buildEml
- Confirmed guard.ts reads `COUNT(*) FROM pgdb.dwc.occurrences` with env-overridable ROW_FLOOR=1000 unchanged; full test suite green (148 passed, 11 skipped via DSN gate)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add associatedParty to the EML builder** - `f54ffee` (feat)
2. **Task 2: Wire the build-time associated-parties query into build.ts** - `c9202f2` (feat)
3. **Task 3: Confirm guard reads rebuilt view + full suite green** - no code change; verified by running full test suite

**Plan metadata:** (committed with this SUMMARY)

## Files Created/Modified

- `scripts/dwca/eml.ts` - Added AssociatedParty interface, extended EmlInput, added associatedPartyXml computation and interpolation; no changes to methodsPara2
- `scripts/dwca/eml.test.ts` - Added associatedParties to mockInput; bumped mock title and assertion from v1.2 to v1.3; added 5 new tests (presence/placement/pubDate-before/empty/xmlEsc); fixed 3 inline buildEml calls missing the new required field
- `scripts/dwca/build.ts` - Imported AssociatedParty type; added Step 15.5 associated-parties query; updated Step 17 buildEml call to include associatedParties

## Decisions Made

- Empty associatedParties list produces no `<associatedParty>` element (not an empty tag) — achieved via conditional newline interpolation
- build.test.ts required no new stubs because it is a DSN-gated integration test (not a unit test with mocked DB sequence); 10 tests skipped without DSN, as expected
- guard.ts ROW_FLOOR=1000 confirmed valid: plan notes ~6,800 total prod rows and ~4,411 trusted-only rows, both well above the 1,000 floor; no constant edit needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed three pre-existing buildEml calls missing the new required `associatedParties` field**
- **Found during:** Task 1 (eml.test.ts update)
- **Issue:** Three inline `buildEml({...})` calls in the existing "determinism and parameter routing" and "XML escaping" test suites did not include `associatedParties`, which would cause TypeScript compile errors
- **Fix:** Added `associatedParties: mockInput.associatedParties` to each of the three calls
- **Files modified:** scripts/dwca/eml.test.ts
- **Verification:** `npm test -- --run scripts/dwca/eml.test.ts` exits 0, all 25 tests pass
- **Committed in:** f54ffee (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — existing tests needed the new required field)
**Impact on plan:** Fix was necessary for TypeScript correctness. No scope creep.

## Issues Encountered

None — plan executed without unexpected blockers. The TDD task structure was executed with all tests passing on first attempt after implementing the changes.

## User Setup Required

None — no external service configuration required. The associated-parties query in build.ts is exercised at runtime during the nightly archive build (when SUPABASE_DB_URL is set).

## Next Phase Readiness

- EML builder now produces ATTR-04-compliant `<associatedParty>` elements for upstream orgs (Orca Network, Cascadia Research Collective) with role `contentProvider`
- The 26-column field lockstep across fields.ts, meta-xml, eml, build, and guard is coherent (full suite green)
- Ready for GBIF validator upload (manual checkpoint from plan 06) and the production archive rebuild

---
*Phase: 12-dwc-view-rebuild*
*Completed: 2026-06-21*

## Self-Check: PASSED

- FOUND: scripts/dwca/eml.ts
- FOUND: scripts/dwca/eml.test.ts
- FOUND: scripts/dwca/build.ts
- FOUND: .planning/phases/12-dwc-view-rebuild/12-03-SUMMARY.md
- FOUND: commit f54ffee (Task 1)
- FOUND: commit c9202f2 (Task 2)
