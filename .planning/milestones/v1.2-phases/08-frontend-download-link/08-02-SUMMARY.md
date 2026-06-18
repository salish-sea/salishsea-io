---
phase: 08-frontend-download-link
plan: 02
subsystem: ui
tags: [lit, dialog, head-on-open, session-cache, csp-noop]

requires:
  - phase: 07-nightly-workflow-hosting
    provides: /dwca/salishsea-occurrences-v1.{zip,parquet} URLs with Content-Length + Last-Modified headers (Lambda@Edge L-01 carve-out pre-shipped)
  - phase: 08-frontend-download-link/01
    provides: src/download-info.ts — DownloadInfo discriminated union, formatBytes, formatRelativeTime, fetchArchiveMetadata

provides:
  - "Data download" section appended to the About <dialog> in src/salish-sea.ts
  - downloadInfo @state field + augmented onAboutClicked + renderDownloadSection() method + 4 new CSS rules in src/salish-sea.ts
  - Four new DOM/spy tests in src/salish-sea.test.ts (download section renders, HEAD fires on open, HEAD does not refire, fallback on HEAD failure)

affects:
  - End-users — site visitors can now discover + download the DwC-A zip + GeoParquet sidecar (DOWNLOAD-01)

tech-stack:
  added: []
  patterns:
    - "@state field populated once-per-session by an async helper, guarded by `this.downloadInfo === null` check in onAboutClicked"
    - "Promise.allSettled HEAD pair fired from a Lit click handler — no Sentry wiring needed (existing global handler catches)"
    - "ResizeObserver + HTMLDialogElement.showModal jsdom stubs for DOM tests of <dialog>-using components"

key-files:
  created: []
  modified:
    - src/salish-sea.ts (+69 lines: 1 import, 1 @state field, augmented onAboutClicked, renderDownloadSection method, 4 CSS selectors)
    - src/salish-sea.test.ts (+148 lines: 4 new tests + jsdom polyfills for dialog/resize-observer)

key-decisions:
  - "Session cache via downloadInfo === null guard — explicitly tested to confirm second open does NOT refire HEADs"
  - "Whole-section failure fallback (not per-row) — simpler state machine; on either HEAD reject/non-ok, render static 'Updated nightly at 09:00 UTC.' line and hide sizes"
  - "No CSP edits (D-13) — same-origin /dwca/* falls under existing connect-src 'self'; confirmed by clean console on production"

patterns-established:
  - "HEAD-on-dialog-open pattern: trigger metadata fetch inside the existing click handler that opens a <dialog>, NOT in firstUpdated — only pay the round-trip when the user actually opens the panel"

requirements-completed:
  - DOWNLOAD-01

duration: ~12min (auto tasks) + production verify
completed: 2026-06-18
---

# Phase 8 Plan 02: Download Section Wiring Summary

**Wired the Plan 01 helpers into the existing About `<dialog>` in `src/salish-sea.ts`. Site visitors can now open the About modal and download the DwC-A `.zip` + `.parquet` (with `.sha256` verify links) from production, with live file sizes and a "updated X ago" freshness line.**

## Performance

- **Duration:** ~12 min auto-task execution + post-deploy human verify
- **Started:** 2026-06-18T20:50:00Z (Task 1)
- **Auto tasks completed:** 2026-06-18T21:23:00Z (Tasks 1 + 2 + test suite green)
- **Production deploy:** 2026-06-18T21:27:37Z (push) → 2026-06-18T21:28:30Z (deploy ✓ in 52s, GH Actions run 27790386170)
- **Production verified:** 2026-06-18T21:35:00Z (browser walk-through of all 10 approval criteria)
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 2

## Accomplishments

- **Task 1 (commit `634488a`):** Wired Plan 01 into `src/salish-sea.ts`. Added the import line, the `@state() private downloadInfo: DownloadInfo | null` field (mirroring the established `lastOwnOccurrence` pattern), augmented `onAboutClicked` with the `downloadInfo === null` guard + async metadata fetch, rendered the new `<h4>Data download</h4>` section between the data-sources `<ul>` and the closing feedback `<p>`, and added 4 CSS selectors (`.downloads`, `.downloads li`, `.sha-link`, `.freshness`) to the existing `static styles` block.
- **Task 2 (commit `a184f68`):** Appended 4 new DOM/spy tests to `src/salish-sea.test.ts` — `"download section renders…"`, `"HEAD fires on open…"`, `"HEAD does not refire…"`, `"fallback on HEAD failure…"`. Added `ResizeObserver` stub and `HTMLDialogElement.showModal` jsdom polyfill to make `<dialog>` testable. Full suite (`npm test --run`) is green.
- **Task 3 (post-deploy verify):** Push to `main` triggered `deploy.yml` run 27790386170 which completed successfully in 52s. Browser verification on https://salishsea.io confirmed all 10 approval criteria: section visible in the correct location, inclusion/exclusion copy + Darwin Core + CC-BY-NC 4.0 links present, exactly 2 HEAD requests on first dialog open, file sizes render (non-zero), all four downloads work (`.zip`, `.parquet`, both `.sha256` sidecars), freshness line reads relative time, no additional HEADs on second open (session cache working), no CSP errors.

## Verification Observations (notable but not bugs)

Three observations surfaced during the production walk-through, all reviewed and dispositioned:

1. **HEAD responses served from browser cache on second open.** Expected — even with the session cache, the browser's HTTP cache may serve repeat HEADs locally. Our `downloadInfo === null` guard still prevents the in-app code path from re-firing fetch at all, so no extra HEAD even hits the network layer. Correctness preserved.
2. **Data files in the zip are `occurrence.txt` / `multimedia.txt`, not `.tsv`.** This is Phase 6's intentional choice — the GBIF DwC-A convention declares the filename + delimiter in `meta.xml`, so the file extension is semantically irrelevant. Confirmed in `scripts/dwca/build.ts:50,364` with explicit "DwC-A convention" comment; Phase 6 passed the GBIF validator (DWCA-05 ✓) with this layout. Not a Phase 8 finding.
3. **Reported file size (243.1 KB) vs macOS Finder size (249 KB).** Binary KiB (1024-based) vs decimal KB (1000-based). Firefox's download manager uses the same binary convention, matching the modal. macOS Finder has used decimal since 10.6 (2009). Our `formatBytes` follows the more common technical convention and matches Firefox's display. Not a bug — convention mismatch only.

## Deferred / Backlog Candidates

None from this plan. The three observations above are all dispositioned to existing convention or upstream phases.

## What This Enables

`DOWNLOAD-01` is satisfied. The v1.2 milestone "Export to DarwinCore Archive" is now end-to-end visible to site visitors. Future enhancements (deferred ideas from CONTEXT.md): a dedicated `/data` route, a header-level Data entry point, a citation snippet, a `manifest.json` for programmatic discovery, and GBIF/OBIS registration UI.

## Commits

- `634488a` — feat(08-02): wire download-info helpers into About dialog
- `a184f68` — test(08-02): add DOM tests for download section + HEAD behavior
