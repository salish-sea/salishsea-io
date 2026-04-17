---
phase: 01-occurrence-links
plan: 01
subsystem: ui
tags: [lit, web-components, clipboard, svg-icons]

# Dependency graph
requires: []
provides:
  - linkIcon SVG path export in src/icons.ts
  - buildShareUrl pure helper exported from src/obs-summary.ts
  - Copy-link button in obs-summary header visible to all visitors (no login required)
  - Transient 2-second copied state (checkmark feedback after click)
affects:
  - 01-02-occurrence-links (uses buildShareUrl pattern as reference for URL format)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transient @state() boolean for 2-second feedback: set true → setTimeout 2000ms → set false"
    - "SVG icon export as bare <path> template; wrapped with <svg> at call site"
    - "Pure exported helper functions in LitElement files enable unit testing without DOM"

key-files:
  created:
    - src/obs-summary.test.ts
  modified:
    - src/icons.ts
    - src/obs-summary.ts

key-decisions:
  - "URL encodes only ?o=<id> — built from origin+pathname, not href, to strip any existing query params"
  - "Copy button placed outside when(this.user || editable) block so it appears regardless of login state"
  - "Used navigator.clipboard.writeText async in onCopyLink handler; no error handling needed for this MVP"

patterns-established:
  - "Icon pattern: export const fooIcon = svg`<path d='...'/>` from icons.ts; wrap with <svg> at call site"
  - "Testable URL helpers: export pure functions from component files, import directly in Vitest tests"

requirements-completed: [LINK-01, LINK-02]

# Metrics
duration: ~5min
completed: 2026-03-04
---

# Phase 1 Plan 01: Copy-Link Button Summary

**Copy-link icon button added to obs-summary header using linkIcon + buildShareUrl helper, producing clean ?o=<id>-only shareable URLs with 2-second checkmark feedback**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-04T20:55:29Z
- **Completed:** 2026-03-04T20:56:27Z
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 3

## Accomplishments
- Added `linkIcon` SVG path export to `src/icons.ts` (Material Symbols chain/link icon)
- Extracted and exported `buildShareUrl(id)` pure helper from `src/obs-summary.ts` — builds clean `origin+pathname+?o=<id>` URL without carrying over existing query params
- Added copy-link `<button>` to obs-summary header template, outside the login-gated `ul.actions` block, with transient `@state() copied` flag showing checkmark for 2 seconds after click
- All 3 Vitest unit tests for `buildShareUrl` pass (basic URL, no extra params, UUID round-trip)
- Human verification passed: button visible on all cards regardless of login, checkmark feedback works, clipboard content is clean `?o=<id>` URL

## Task Commits

Each task was committed atomically:

1. **Task 1: Add linkIcon and buildShareUrl helper (RED + GREEN)** - `798643f` (test) then `f3dcae8` (feat)
2. **Task 2: Add copy-link button with transient copied state** - `f3dcae8` (feat, combined with Task 1 GREEN)
3. **Task 3: Human verification checkpoint** - approved, no commit

## Files Created/Modified
- `src/icons.ts` - Added `linkIcon` export (Material Symbols link/chain SVG path)
- `src/obs-summary.ts` - Added `buildShareUrl` helper, `linkIcon` import, `@state() copied` field, `onCopyLink` handler, copy-link button in header template, `.copy-link` CSS
- `src/obs-summary.test.ts` - Created: 3 unit tests for `buildShareUrl`

## Decisions Made
- Build URL from `origin + pathname` (not `href`) to strip any existing query params — ensures clean `?o=<id>`-only output regardless of current page state
- Copy button placed in header outside `when(this.user || editable, ...)` gate — must be visible to all visitors per LINK-01
- Transient feedback via `@state() copied` boolean with 2-second `setTimeout` reset — simple, no library needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- LINK-01 and LINK-02 requirements satisfied
- Clean URL format (`?o=<id>`) is established — 01-02 deep-link hydration plan uses the same `?o=` parameter to detect and hydrate occurrence on load
- No blockers for 01-02

---
*Phase: 01-occurrence-links*
*Completed: 2026-03-04*
