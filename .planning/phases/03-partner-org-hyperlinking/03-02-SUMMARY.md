---
phase: 03-partner-org-hyperlinking
plan: "02"
subsystem: ui
tags: [vite, typescript, marked, dompurify, vitest]

# Dependency graph
requires:
  - "src/partner-links.ts — injectPartnerLinks and Renderer used in this plan"
  - "src/partners.csv — partner data consumed via injectPartnerLinks"
provides:
  - "src/obs-summary.ts — rendering pipeline now injects partner links and preserves target/rel through DOMPurify"
  - "src/partner-links.test.ts — PARTNER-04 DOMPurify integration test"
affects:
  - "End users see partner org names as clickable hyperlinks in occurrence body text"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "marked Renderer instance with link() override for target=_blank rel=noopener noreferrer on all rendered links"
    - "DOMPurify ADD_ATTR config to preserve target and rel attributes through sanitization"
    - "Pre-process body text with injectPartnerLinks before marked.parse to inject markdown links"

key-files:
  created: []
  modified:
    - src/obs-summary.ts
    - src/partner-links.test.ts

key-decisions:
  - "Use new Renderer() instance with link() override instead of partial renderer object — marked v17 requires a full Renderer instance, not a plain object with partial methods"
  - "Place markedRenderer and domPurify at module level (not per-render) — constructed once, reused on every render"
  - "ADD_ATTR: ['target', 'rel'] added to DOMPurify config to preserve new-tab link attributes injected by the custom renderer"

# Metrics
duration: 15min
completed: 2026-04-18
---

# Phase 3 Plan 02: Partner Link Integration into obs-summary Summary

**Rendering pipeline integration: injectPartnerLinks pre-processes body text, marked Renderer adds target/rel to all links, DOMPurify ADD_ATTR config preserves those attributes through sanitization**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-18T03:29:00Z
- **Completed:** 2026-04-18T03:43:00Z (Task 1 only; Task 2 pending human verification)
- **Tasks:** 1 of 2 complete (Task 2 awaiting visual verification)
- **Files modified:** 2

## Accomplishments

- Modified `src/obs-summary.ts` to import `injectPartnerLinks` and `Renderer` from their respective modules
- Created module-level `markedRenderer` with `link()` override producing `target="_blank" rel="noopener noreferrer"` on all anchor tags
- Updated `marked.parse()` call to pre-process body with `injectPartnerLinks` and use the custom renderer
- Updated `domPurify.sanitize()` call with `{ ADD_ATTR: ['target', 'rel'] }` to preserve target and rel through sanitization
- Added PARTNER-04 test to `src/partner-links.test.ts` exercising the full marked + DOMPurify pipeline
- All 20 tests pass (the 2 suite-level failures in obs-map.test.ts and salish-sea.test.ts are pre-existing, caused by `ol.css?url` denial, unrelated to this plan)

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Integrate injectPartnerLinks into obs-summary.ts and add PARTNER-04 DOMPurify test | bafe6e4 | src/obs-summary.ts, src/partner-links.test.ts |
| 2 | Visual verification of partner org links in the running application | PENDING | none |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] marked v17 requires Renderer instance, not partial renderer object**
- **Found during:** Task 1
- **Issue:** The plan specified `renderer: { link({ href, text }) { ... } }` as an inline partial object in the `marked.parse()` options. marked v17 requires a full `Renderer` instance — passing a plain object causes `TypeError: this.renderer.paragraph is not a function` because all renderer methods must exist on the object.
- **Fix:** Imported `Renderer` from `marked`, created a module-level `markedRenderer = new Renderer()` instance, and assigned `markedRenderer.link = ...`. Updated the test to use the same pattern with a local `Renderer` instance.
- **Files modified:** src/obs-summary.ts, src/partner-links.test.ts
- **Commit:** bafe6e4

## Task 2 Status

**PENDING HUMAN VERIFICATION**

Task 2 requires visual inspection of the running application. A dev server must be started and an occurrence with partner org body text (e.g., "Orca Network") must be found and inspected.

See checkpoint details below for verification steps.

## Known Stubs

None — integration is fully wired. `injectPartnerLinks` is called with real body text, links are rendered with target/rel attributes, and DOMPurify preserves them.

## Threat Flags

None — changes stay within the existing DOMPurify sanitization boundary. Only `target` and `rel` attributes are added to the allowlist, both safe. All href values continue to pass through DOMPurify which strips `javascript:` protocol links. The custom renderer pairs `target="_blank"` with `rel="noopener noreferrer"` preventing tab-napping (T-03-03, T-03-04 mitigated).

## Self-Check: PASSED

- [x] src/obs-summary.ts exists and contains `import { injectPartnerLinks } from './partner-links.ts'`
- [x] src/obs-summary.ts contains `injectPartnerLinks(body?.replace`
- [x] src/obs-summary.ts contains `ADD_ATTR: ['target', 'rel']`
- [x] src/obs-summary.ts contains `target="_blank"` in renderer config
- [x] src/obs-summary.ts contains `rel="noopener noreferrer"` in renderer config
- [x] src/partner-links.test.ts contains test with `target="_blank"` assertion
- [x] `npx vitest run` exits with all 20 tests passing
- [x] Commit bafe6e4 exists
