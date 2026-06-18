---
phase: 08-frontend-download-link
verified: 2026-06-18T21:35:00Z
status: passed
score: 2/2 success criteria + 4/4 plan must-haves verified
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification:
  - criterion: production browser walk-through of the 10-step approval checklist
    verified_at: 2026-06-18T21:35:00Z
    verifier: rainhead@gmail.com
    notes: |
      All 10 criteria pass on https://salishsea.io. Three non-bug observations recorded in
      08-02-SUMMARY.md §"Verification Observations": browser-cached HEAD on second open
      (expected, our session cache still prevents in-app re-fire), `.txt` extension in the
      zip (Phase 6 deliberate DwC-A convention, not a Phase 8 finding), 243.1 KB vs 249 KB
      (binary vs decimal — Firefox matches us, macOS Finder uses decimal).
---

# Phase 8: Frontend Download Link — Verification Report

**Phase Goal:** A site visitor can discover and download the DarwinCore Archive from the site via one static, low-risk download link/page pointing at the stable published URL.

**Verified:** 2026-06-18T21:35:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

Both ROADMAP success criteria plus 4 plan-level must-haves verified:

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | A site visitor can find a clearly labeled "Data download / DwC-A" link on the site | VERIFIED | New `<h4>Data download</h4>` section visible in the existing About `<dialog>`, between the "We currently show:" list and the feedback/funding paragraph. Discoverable via the existing `ⓘ` link in the page header (`src/salish-sea.ts:320`). Confirmed in production browser walk-through. |
| SC-2 | Following the link downloads the current archive from the stable `https://salishsea.io/dwca/…` URL | VERIFIED | All four anchors carry `download` attribute + correct hrefs to `/dwca/salishsea-occurrences-v1.{zip,parquet}[.sha256]`. Each downloaded successfully from production: `.zip` (243.1 KiB), `.parquet` (388.5 KiB), both `.sha256` sidecars (~65 B text files with hex digests). |
| P8-01 | All four artifacts linked (zip, parquet, both sha256 sidecars) with `download` attr | VERIFIED | `src/salish-sea.ts` `renderDownloadSection()`; `<a download>` attribute confirmed on all four primary anchors and both verify-affordance sub-anchors. Live download check in browser confirms canonical filenames preserved. |
| P8-02 | HEAD-on-open fires exactly once per session, two parallel HEADs to `.zip` + `.parquet` only | VERIFIED | Production DevTools → Network tab filter `/dwca/`: first dialog open → exactly 2 HEADs (zip + parquet); second dialog open within the same page load → 0 additional in-app HEADs (`downloadInfo === null` guard in `onAboutClicked`). Browser HTTP cache may serve repeats locally — expected and not a correctness issue. |
| P8-03 | File sizes + relative "updated X ago" render from `Content-Length` + `Last-Modified` on `.zip` HEAD response | VERIFIED | Production rendered "243.1 KB" / "388.5 KB" + relative-time freshness line. Same-origin (`salishsea.io/dwca/…`) so no CORS — confirmed by `connect-src 'self'` CSP allowing the request with zero edits (D-13). |
| P8-04 | HEAD failure fallback renders static "Updated nightly at 09:00 UTC." copy, no error surface | VERIFIED | Unit test "fallback on HEAD failure" in `src/salish-sea.test.ts` mocks `fetch` rejection and asserts the fallback copy + no sizes rendered. Sentry catches actual production failures via the existing `sentry.ts` integration; no bespoke Sentry wiring required (per `08-RESEARCH.md` §"Architectural Responsibility Map"). |

**Score:** 6/6 truths verified (2 success criteria + 4 plan must-haves)

---

## Required Artifacts

| Artifact | Location | Status |
|---|---|---|
| `src/download-info.ts` — formatters + HEAD helper | `/Users/rainhead/dev/salishsea-io/src/download-info.ts` | CREATED (`044d17c`) |
| `src/download-info.test.ts` — 20 pure-function tests | `/Users/rainhead/dev/salishsea-io/src/download-info.test.ts` | CREATED (`c66fa8e`) |
| `src/salish-sea.ts` — wired download section | `/Users/rainhead/dev/salishsea-io/src/salish-sea.ts` (+69 lines) | MODIFIED (`634488a`) |
| `src/salish-sea.test.ts` — 4 new DOM/spy tests | `/Users/rainhead/dev/salishsea-io/src/salish-sea.test.ts` (+148 lines) | MODIFIED (`a184f68`) |
| Production deploy | `deploy.yml` run 27790386170 (52s) | DEPLOYED 2026-06-18T21:28:30Z |
| Production verification | https://salishsea.io browser walk-through (10/10 criteria) | VERIFIED 2026-06-18T21:35:00Z |

---

## Requirements Coverage

| Requirement | Plans | Status |
|---|---|---|
| DOWNLOAD-01 | 08-01 + 08-02 | SATISFIED |

---

## Decision Coverage (CONTEXT.md D-01..D-13)

All 13 trackable decisions referenced in at least one plan and surfaced in shipped code:

| D | Decision | Shipped in |
|---|---|---|
| D-01, D-02 | Append to existing About `<dialog>`, between data-sources `<ul>` and feedback `<p>` | `src/salish-sea.ts` `renderDownloadSection()` invoked inside the dialog template |
| D-03 | All four artifacts (zip + parquet + 2× sha256) | `renderDownloadSection()` emits four `<a>` elements |
| D-04 | HEAD on dialog open (not initial load), session cache, sizes from `.zip` + `.parquet` only | `onAboutClicked` + `downloadInfo === null` guard; `fetchArchiveMetadata` parallels two HEADs |
| D-05 | No citation snippet | Not rendered; verified absent in production walk-through |
| D-06, D-07 | Short paragraph + inclusion/exclusion bullets | `renderDownloadSection()` UI-SPEC copy block |
| D-08 | Outbound link to `https://dwc.tdwg.org/` | Anchor in section paragraph |
| D-09 | Inline CC-BY-NC 4.0 link to `creativecommons.org/licenses/by-nc/4.0/` | Anchor in section paragraph |
| D-10, D-11 | Relative-time freshness from `Last-Modified`, 7-day absolute fallback | `formatRelativeTime` in `src/download-info.ts` |
| D-12 | HEAD failure → static "Updated nightly at 09:00 UTC." + hide sizes silently | `renderDownloadSection()` fallback branch; "fallback on HEAD failure" test |
| D-13 | No CSP changes — same-origin | `index.html` unchanged; production console clean of CSP errors |

---

## Tests

| Suite | Tests | Status |
|---|---|---|
| `src/download-info.test.ts` | 20 (8 formatBytes, 7 formatRelativeTime, 5 fetchArchiveMetadata) | PASS |
| `src/salish-sea.test.ts` (new) | 4 (download section renders, HEAD fires on open, HEAD does not refire, fallback on HEAD failure) | PASS |
| Full suite | `npm test --run` | GREEN |

---

## Notable Findings (recorded but not deferred)

Three observations from the production verification walk-through, all dispositioned to existing convention or upstream phases:

1. **Browser cache on HEAD** — second dialog open within the same page may return HEAD responses from the browser HTTP cache. The in-app session cache (`downloadInfo === null` guard) still prevents the SPA code path from re-firing fetch, so correctness is preserved. Expected web behavior.
2. **Data files inside the zip are `occurrence.txt` / `multimedia.txt`** — Phase 6 deliberate choice per the GBIF DwC-A convention (`scripts/dwca/build.ts:50,364` comment). The filename + delimiter are declared in `meta.xml`, so the file extension is semantically irrelevant. Phase 6 passed the GBIF validator (DWCA-05) with this layout. Not a Phase 8 finding.
3. **Reported size 243.1 KB vs macOS Finder 249 KB** — binary KiB (1024-based, what we render and what Firefox uses) vs decimal KB (1000-based, what macOS Finder has used since 10.6). Convention mismatch only.

---

## Deferred Ideas (preserved from CONTEXT.md)

- Header-level "Data" entry point (own dialog or chip)
- `/data` route + dedicated public-data page
- `manifest.json` published by the nightly workflow
- Citation snippet in the modal
- CC license badge image
- File-size HEADs on initial page load
- GBIF/OBIS registration UI (already v1.2 out-of-scope per `REG-01`)

---

## Verdict

**PASSED.** Phase 8 closes the v1.2 milestone "Export to DarwinCore Archive." DOWNLOAD-01 is satisfied end-to-end: nightly archive is generated (Phase 6), published atomically to `https://salishsea.io/dwca/…` (Phase 7), and now discoverable + downloadable to site visitors via the About modal (Phase 8). All success criteria, must-haves, requirements, and tracked CONTEXT decisions are verified against production.
