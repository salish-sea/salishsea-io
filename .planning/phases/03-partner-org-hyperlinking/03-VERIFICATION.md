---
phase: 03-partner-org-hyperlinking
verified: 2026-04-17T22:14:30Z
status: human_needed
score: 8/9
overrides_applied: 0
human_verification:
  - test: "Visual check — partner org link renders as hyperlink in browser"
    expected: "Orca Network appears as a blue clickable link in occurrence body text; clicking opens https://orcanetwork.org in a new tab"
    why_human: "Lit web component rendering in jsdom cannot fully substitute for browser Shadow DOM behavior; visual confirmation required by Plan 02 Task 2 (checkpoint:human-verify gate)"
  - test: "Visual check — bracket pattern renders as link without double brackets"
    expected: "Body text containing [Orca Network] renders as a linked [Orca Network] (not [[Orca Network](url)] literal)"
    why_human: "Requires live browser inspection of rendered Shadow DOM; cannot verify from source alone"
  - test: "Visual check — no console errors during rendering"
    expected: "Browser devtools console is clean (no JS errors, no CSP violations)"
    why_human: "Runtime browser environment only"
---

# Phase 3: Partner Org Hyperlinking — Verification Report

**Phase Goal:** Partner org names in occurrence body text render as clickable hyperlinks that open in a new tab. Maintained via a CSV-driven lookup (no code changes needed to add orgs). DOMPurify configured to preserve target and rel attributes.
**Verified:** 2026-04-17T22:14:30Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All truths derive from the ROADMAP.md success criteria and merged PLAN must_haves. ROADMAP has 5 explicit criteria; PARTNER-04 (target/rel) is an additional must-have from PLAN-02 and REQUIREMENTS.md.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Non-technical contributor can add a partner org by editing CSV only — no TypeScript changes | VERIFIED | `src/partners.csv` is plain text with `name,url` header; parsed at module load via Vite `?raw` import; adding a row requires no code change |
| 2 | Partner org names in occurrence body text render as clickable hyperlinks | human_needed | Code pipeline fully wired (see artifacts/links); visual browser verification pending (Plan 02 Task 2 gate) |
| 3 | Org name matching works regardless of capitalization in body text | VERIFIED | `injectOrgLink` uses `gi` flag regex; test passes: `injectPartnerLinks('spotted by orca network')` returns `[Orca Network](https://orcanetwork.org)` |
| 4 | Bracket pattern `[Org Name]` converts to link without malformed double-bracket output | VERIFIED | Single-pass regex with `(?!\()` negative lookahead; test passes: `injectPartnerLinks('[Orca Network] report')` equals `[Orca Network](https://orcanetwork.org) report` |
| 5 | Body text already containing a markdown hyperlink for an org is not double-linked | VERIFIED | Guard check `if (new RegExp('\\[' + e + '\\]\\(', 'i').test(body)) return body` before regex; test passes |
| 6 | Partner links open in new tab with `target="_blank" rel="noopener noreferrer"` | VERIFIED | `markedRenderer.link` outputs those attributes at obs-summary.ts line 23; `ADD_ATTR: ['target', 'rel']` preserves them through DOMPurify; PARTNER-04 pipeline test passes |
| 7 | Longest-name-first ordering prevents short names matching inside long names | VERIFIED | `sort((a, b) => b.name.length - a.name.length)` at partner-links.ts line 43; test: `injectPartnerLinks('Report from NOAA Fisheries')` links NOAA Fisheries, not NOAA |
| 8 | Full test suite is green | VERIFIED | `npx vitest run` — 25 tests across 7 test files, all passing |
| 9 | TypeScript compiles without errors | VERIFIED | `npx tsc --noEmit` exits 0, no output |

**Score:** 8/9 truths verified (1 requires human browser verification)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/partners.csv` | Partner org name-to-URL lookup data; `name,url` header | VERIFIED | Exists, 4 lines: header + 3 orgs (Orca Network, OrcaSound, NOAA Fisheries) |
| `src/partner-links.ts` | CSV parser and link injection utility; exports `injectPartnerLinks`, `partners` | VERIFIED | Exists, 45 lines, substantive implementation; both exports present; imported by obs-summary.ts |
| `src/partner-links.test.ts` | Unit tests for all behaviors | VERIFIED | Exists, 64 lines, 8 tests across 2 describe blocks; `// @vitest-environment jsdom` on line 1; all passing |
| `src/obs-summary.ts` | Integration of partner link injection into rendering pipeline; contains `injectPartnerLinks` | VERIFIED | Exists; imports `injectPartnerLinks` at line 17; calls it at line 183; `ADD_ATTR` at line 186 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/partner-links.ts` | `src/partners.csv` | Vite `?raw` import | VERIFIED | Line 1: `import partnersRaw from './partners.csv?raw'` |
| `src/obs-summary.ts` | `src/partner-links.ts` | `import { injectPartnerLinks }` | VERIFIED | Line 17: `import { injectPartnerLinks } from './partner-links.ts'` |
| `src/obs-summary.ts` | `dompurify` | `ADD_ATTR` config | VERIFIED | Line 186: `{ ADD_ATTR: ['target', 'rel'] }` as second argument to `domPurify.sanitize()` |
| `injectPartnerLinks` | `marked.parse` input | Pre-processes body | VERIFIED | Line 183: `injectPartnerLinks(body?.replace(/.../) || '')` wraps the body before `marked.parse` |
| `markedRenderer.link` | anchor output | `target` + `rel` attributes | VERIFIED | Line 22-23: renderer assigns `target="_blank" rel="noopener noreferrer"` on every link |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `src/obs-summary.ts` render | `body` | `this.sighting.body` (Occurrence property, from Supabase) | Yes — Supabase-sourced occurrence body text | FLOWING |
| `src/partner-links.ts` | `partners` | `parsePartnersCSV(partnersRaw)` — static CSV bundled by Vite | Yes — 3 real partner orgs | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CSV parsed with 3+ partners | `npx vitest run src/partner-links.test.ts` | 8 tests passed | PASS |
| Plain name injection | test: `injectPartnerLinks('Spotted by Orca Network today')` | `[Orca Network](https://orcanetwork.org)` | PASS |
| Case-insensitive match | test: `injectPartnerLinks('spotted by orca network')` | contains `[Orca Network](https://orcanetwork.org)` | PASS |
| Bracket pattern, no double-bracket | test: `injectPartnerLinks('[Orca Network] report')` | `[Orca Network](https://orcanetwork.org) report` | PASS |
| Double-link prevention | test: already-linked input returned unchanged | identity | PASS |
| Longest-match-first | test: `injectPartnerLinks('Report from NOAA Fisheries')` | links NOAA Fisheries, no `[NOAA]` | PASS |
| DOMPurify pipeline (PARTNER-04) | test: full marked + DOMPurify pipeline | `target="_blank"`, `rel="noopener noreferrer"`, correct href | PASS |
| Full test suite | `npx vitest run` | 25/25 passing | PASS |
| TypeScript compile | `npx tsc --noEmit` | exit 0, no errors | PASS |
| Visual link rendering in browser | requires running app | — | SKIP (human needed) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PARTNER-01 | 03-01 | CSV file with `name,url` columns; non-technical editable | SATISFIED | `src/partners.csv` exists with correct header; Vite `?raw` import; no TS change needed to add orgs |
| PARTNER-02 | 03-01, 03-02 | Partner org names render as clickable hyperlinks | human_needed | Pipeline wired; visual confirmation pending |
| PARTNER-03 | 03-01 | Org name matching is case-insensitive | SATISFIED | `gi` flag regex; test passes for lowercase input |
| PARTNER-04 | 03-02 | Partner links open in new tab (`target="_blank" rel="noopener noreferrer"`) | SATISFIED | `markedRenderer.link` outputs attributes; `ADD_ATTR` config preserves them; pipeline test passes |
| PARTNER-05 | 03-01 | `[Org Name]` bracket pattern converts without double brackets | SATISFIED | Single-pass regex with negative lookahead; test passes |
| PARTNER-06 | 03-01 | Already-linked text not double-linked | SATISFIED | Guard check before regex; test passes |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODOs, FIXMEs, placeholder returns, or hardcoded empty data found in any phase-modified file. The `parsePartnersCSV` function returns a populated array from real CSV data; `injectPartnerLinks` applies real regex transformations.

---

### Human Verification Required

#### 1. Partner org link renders in browser

**Test:** Start the dev server (`npx vite dev`). Open the app and find an occurrence whose body text mentions "Orca Network" (common in real sighting data). Inspect the rendered body text.

**Expected:**
- "Orca Network" appears as a blue clickable hyperlink (color `#1976d2`)
- Clicking opens `https://orcanetwork.org` in a NEW browser tab
- Hovering changes link color to a darker blue (`#1565c0`)

**Why human:** Lit web component rendering in Shadow DOM cannot be fully exercised by jsdom. The jsdom-based pipeline test (PARTNER-04) exercises marked + DOMPurify in isolation but not the Lit element's Shadow DOM rendering path. Plan 02 Task 2 is a `type="checkpoint:human-verify"` gate marked blocking.

---

#### 2. Bracket pattern renders correctly

**Test:** Find or create an occurrence whose body text contains `[Orca Network]` (no URL — bare bracket pattern).

**Expected:** Renders as a linked text `Orca Network` — not as literal `[[Orca Network](https://orcanetwork.org)]` with visible brackets.

**Why human:** markdown-to-HTML rendering of bracket edge cases is best confirmed visually in a real browser.

---

#### 3. No console errors

**Test:** With the dev server running and the app open, check the browser devtools Console tab while viewing an occurrence with partner org body text.

**Expected:** No JavaScript errors, no CSP violations. The `ADD_ATTR` DOMPurify config change is safe (only `target` and `rel` are widened), but runtime confirmation eliminates any CSP edge case.

**Why human:** CSP enforcement only visible in browser runtime.

---

### Gaps Summary

No blocking gaps. All code is fully implemented, wired, and tested. The single outstanding item is Task 2 from Plan 02: visual verification in a running browser. This was planned as a human checkpoint gate from the start (`type="checkpoint:human-verify" gate="blocking"`). The automated pipeline — CSV parsing, link injection, markdown rendering, DOMPurify sanitization — is verified working by 8 unit tests all passing.

The PARTNER-02 requirement status is `human_needed` rather than `SATISFIED` because link rendering in a Lit web component's Shadow DOM has not been visually confirmed. All evidence points to correct operation but a human eyeball is required to close the gate.

---

_Verified: 2026-04-17T22:14:30Z_
_Verifier: Claude (gsd-verifier)_
