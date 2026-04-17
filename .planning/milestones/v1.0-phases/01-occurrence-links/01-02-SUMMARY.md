---
phase: 01-occurrence-links
plan: 02
subsystem: ui
tags: [lit, temporal, openlayers, supabase, vitest, deep-link, url-params]

# Dependency graph
requires:
  - phase: 01-occurrence-links
    provides: "Plan 01 copy-link button — generates ?o=<id> URLs that plan 02 hydrates"
provides:
  - "hydrateFromOccurrenceId private method on SalishSea component"
  - "dateFromObservedAt exported pure helper function"
  - "Deep-link hydration: ?o=<id> loads occurrence date and centers map"
  - "Unit tests for dateFromObservedAt in src/salish-sea.test.ts"
affects: [01-occurrence-links, phase-2-rich-previews]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bypass date setter during hydration to avoid history pollution: use this.#date = date; await this.fetchOccurrences(date)"
    - "Use setView with skipEvent:true to avoid writing ?x=/?y=/?z= to history"
    - "maybeSingle() pattern for silent not-found fallback on occurrence lookup"
    - "fromLonLat coordinate conversion for WGS-84 to EPSG:3857"
    - "jsdom environment via // @vitest-environment jsdom comment for browser-only modules"

key-files:
  created:
    - src/salish-sea.test.ts
  modified:
    - src/salish-sea.ts

key-decisions:
  - "Use coord[0]!/coord[1]! indexing instead of destructuring [x, y] from fromLonLat to satisfy TypeScript (number[] vs [number, number])"
  - "Test file uses // @vitest-environment jsdom because salish-sea.ts references document at module top level"
  - "Silent fallback on unknown occurrence ID — if !occurrence return without error, app loads with defaults"

patterns-established:
  - "History-safe hydration: bypass Lit property setter to avoid triggering setQueryParams side-effects"
  - "skipEvent: true on setView prevents map-move event handler from writing position to URL history"

requirements-completed: [LINK-03, LINK-04]

# Metrics
duration: 15min
completed: 2026-03-04
---

# Phase 1 Plan 02: Deep-Link Hydration Summary

**Deep-link hydration via ?o=<id>: sets date from occurrence.observed_at and centers map on occurrence location at zoom 12, with silent fallback and no history pollution**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-04T22:57:00Z
- **Completed:** 2026-03-04T23:12:00Z
- **Tasks:** 3 of 3 complete (human verification approved)
- **Files modified:** 2

## Accomplishments
- Extracted `dateFromObservedAt` as a pure exported helper from the `focusOccurrence` date pattern
- Added `salish-sea.test.ts` with 3 Vitest unit tests covering Pacific timezone date derivation edge cases
- Implemented `hydrateFromOccurrenceId` private method: fetches occurrence by ID, sets date without history pollution, loads occurrences, centers map, sets focused occurrence
- Wired hydration into `firstUpdated` (now async) — only runs when `?o=` param present at page load
- Full test suite: 15 tests passing across 6 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract dateFromObservedAt helper and write unit test** - `134b08b` (test)
2. **Task 2: Implement hydrateFromOccurrenceId and wire into firstUpdated** - `0d4741f` (feat)
3. **Task 3: Verify deep-link hydration in browser** - human-verify checkpoint (approved — all 7 checks passed)

## Files Created/Modified
- `src/salish-sea.test.ts` - Vitest unit tests for dateFromObservedAt (3 tests, jsdom environment)
- `src/salish-sea.ts` - Added fromLonLat import, async firstUpdated, hydrateFromOccurrenceId method, dateFromObservedAt export

## Decisions Made
- Used `coord[0]!/coord[1]!` indexing instead of destructuring `[x, y]` — TypeScript infers `fromLonLat` return as `number[]` not `[number, number]`, so non-null assertion on index access is required
- Added `// @vitest-environment jsdom` to test file because `salish-sea.ts` accesses `document.location.search` at module evaluation time
- Silent fallback on unknown ID: `if (!occurrence) return` — per plan decisions, no error thrown

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] jsdom environment needed for salish-sea.test.ts**
- **Found during:** Task 1 (RED phase)
- **Issue:** First test run failed with `ReferenceError: document is not defined` because `salish-sea.ts` calls `document.location.search` at module top level
- **Fix:** Added `// @vitest-environment jsdom` comment to test file (matching pattern from obs-summary.test.ts)
- **Files modified:** src/salish-sea.test.ts
- **Verification:** Tests run successfully in jsdom environment
- **Committed in:** 134b08b (Task 1 commit)

**2. [Rule 1 - Bug] TypeScript error on fromLonLat destructuring**
- **Found during:** Task 2 (tsc --noEmit verification)
- **Issue:** `const [x, y] = fromLonLat([lon, lat])` gives `number | undefined` — TypeScript can't guarantee array length
- **Fix:** Changed to `const coord = fromLonLat([lon, lat]); this.mapRef.value!.setView(coord[0]!, coord[1]!, ...)`
- **Files modified:** src/salish-sea.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** 0d4741f (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking environment issue, 1 type error)
**Impact on plan:** Both required for correct test execution and TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- LINK-03 and LINK-04 are satisfied — human verification approved all 7 checks
- Phase 1 (Occurrence Links) is fully complete: copy-link button (01-01) + deep-link hydration (01-02) both working in browser
- Phase 2 (Rich Previews) is blocked pending infrastructure decision: static S3/CloudFront deployment can't serve dynamic meta tags without Lambda@Edge or CloudFront Functions — approach must be resolved before Phase 2 can be planned

## Self-Check: PASSED

- src/salish-sea.test.ts: FOUND
- src/salish-sea.ts: FOUND
- 01-02-SUMMARY.md: FOUND
- Commit 134b08b (Task 1): FOUND
- Commit 0d4741f (Task 2): FOUND

---
*Phase: 01-occurrence-links*
*Completed: 2026-03-04*
