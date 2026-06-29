---
type: quick
slug: 260629-ggu
title: Break the About popover out into its own /about.html page
date: 2026-06-29
status: complete
commits:
  - 9c6143b: test(260629-ggu): add failing tests for about-page component [TDD RED]
  - 973ffed: feat(260629-ggu): implement about-page Lit component [TDD GREEN]
  - c49e9fb: feat(260629-ggu): wire Vite about entry, convert info trigger to link, remove dialog
  - 0caddd6: fix(260629-ggu): point feedback copy at the map's Feedback button (post-checkpoint)
  - c8ddad5: chore: merge executor worktree
files_created:
  - src/about-page.ts
  - src/about-page.test.ts
  - about.html
files_modified:
  - vite.config.js
  - src/salish-sea.ts
  - src/salish-sea.test.ts
---

# Quick Task 260629-ggu Summary

## One-liner

`<about-page>` Lit component lifts the modal body verbatim; `about.html` Vite multi-page entry serves it at `/about.html`; header info control becomes a plain `<a href="/about.html">` and the `<dialog>` is gone.

## What was built

### src/about-page.ts (new)
`@customElement('about-page')` Lit component containing all prior modal content:
- "Back to the map" link (href `/`) as first focusable element
- Single page-level `<h1>About SalishSea.io</h1>`
- Intro paragraph, "We currently show:" list (iNaturalist, Whale Alert, Orca Network, HappyWhale)
- `<h2>Data download</h2>` with the DwC-A paragraph (rel="noopener noreferrer" on both outbound links), `ul.downloads` with four `/dwca/` links (.zip, .zip.sha256, .parquet, .parquet.sha256) + size smalls, and `.freshness` line
- Feedback/funding paragraph (mailto, GitHub, Beam Reach)
- `firstUpdated` fires `fetchArchiveMetadata()` once per page load (no session cache needed — standalone page mounts once)
- Download styles migrated from salish-sea.ts; page-layout styles added (`:host` max-width, `a` color, `.back`)

### src/about-page.test.ts (new)
Three tests (all passing):
1. renders four /dwca hrefs + dwc + cc links with rel="noopener noreferrer"
2. HEAD fires on mount: exactly two requests (.zip and .parquet)
3. fallback on HEAD failure: `.freshness` text is "Updated nightly at 09:00 UTC." and no `.downloads li small` elements

### about.html (new)
Valid HTML5 page at project root:
- CSP meta with tightened directives (no Google/Sentry/Supabase origins, no inline-script hash)
- Static title "About SalishSea.io", description meta, Open Graph + twitter:card tags
- Inline `<style>` mirroring src/index.css baseline (avoids inline-critical-css plugin path)
- Mounts `<about-page>` + `<script type=module src=src/about-page.ts>`

### vite.config.js (modified)
Added `about: resolve(__dirname, 'about.html')` to `build.rollupOptions.input` alongside existing `main` entry. Vite emits `dist/about.html` as a real static object.

### src/salish-sea.ts (modified)
- Header info control: `<a class="about-link" href="/about.html" title="About SalishSea.io">ℹ</a>` (plain anchor, no @click handler)
- Removed: `<dialog>` block, `dialogRef`, `onAboutClicked`, `onCloseModal`, `renderDownloadSection`, `downloadInfo @state`, dialog/download CSS rules, `fetchArchiveMetadata/formatBytes/formatRelativeTime/DownloadInfo` imports

### src/salish-sea.test.ts (modified)
Removed: four download/HEAD tests, `makeEl` helper with showModal stub, okZip/okParquet/bad503 fixtures, fetchSpy plumbing, DownloadInfo import.
Added: one focused test asserting `a.about-link` has `href="/about.html"` and `dialog` is null.

## Build result

`npm run build` (from worktree) passed:
- tsc: clean
- vite build: 755 modules transformed, emits `dist/about.html` (2.06 kB) + `dist/index.html` (3.15 kB)
- html-validate on `dist/**/*.html`: passed (no errors)
- verify-csp-inline-hash on `dist/index.html`: OK (hash unchanged)

## Deviations from Plan

One content fix at the human-verify checkpoint (approved by user): the lifted
copy said "tap the Feedback button in the bottom-right of the page," but that
widget lives on the map app, not the standalone page. Reworded to "use the
Feedback button on the map, or email …" (commit `0caddd6`). No test asserted the
old wording; `npm run build` re-verified green after the change.

The human visual browser check (navigation, refresh, look) was deferred to the
user per their choice ("Fix copy + I'll verify"). Worktree merged back to
`clear-observation-on-day-change` via `worktree.cleanup-wave` (merge commit
`c8ddad5`).

## Known Caveats

- **Social-bot OG cards (confirmed non-blocking, per plan):** The Lambda@Edge interceptor returns the generic site-preview HTML for listed social bots (`/about.html` carries no `?o=`). Human direct load, refresh, and share all get the real page. Flagged and accepted as out of scope per the zero-infra decision documented in the plan objective.
- **Worktree test execution:** Running `npx vitest run` from the worktree root fails for `salish-sea.test.ts` and `obs-map.test.ts` with "Denied ID /…/node_modules/ol/ol.css?url" — vite restricts serving files from outside the worktree root. This is a pre-existing worktree/vite limitation; both files pass when run from the main project directory (`cd /Users/rainhead/dev/salishsea-io && npx vitest run src/salish-sea.test.ts`). All 14 tests green from the main project path.

## Self-Check

- [x] `dist/about.html` exists
- [x] `src/about-page.ts` exists
- [x] `src/about-page.test.ts` exists
- [x] All three commits present (9c6143b, 973ffed, c49e9fb)
- [x] `npm run build` succeeded
- [x] TDD gate: RED commit (9c6143b) precedes GREEN commit (973ffed)

## Self-Check: PASSED
