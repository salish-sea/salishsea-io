---
phase: 01-occurrence-links
verified: 2026-03-04T23:30:00Z
status: human_needed
score: 7/7 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 5/7
  gaps_closed:
    - "TypeScript compilation error (unused `id` destructure) — fixed in commit be79fad, `npx tsc --noEmit` now passes clean"
    - "Copy-link placement/appearance deviation — reclassified as an accepted user design decision (user directed: move button to ul.actions, make it text 'Copy link'/'Copied!'). LINK-01 intent is satisfied: the element is always rendered outside login gates."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Verify copy-link is visible when NOT logged in"
    expected: "A 'Copy link' text link is visible in the ul.actions row of every occurrence card, including when no user is authenticated"
    why_human: "ul.actions renders unconditionally per code, but browser rendering requires running the app"
  - test: "Verify clipboard URL format after clicking 'Copy link'"
    expected: "Clipboard contains origin+pathname+?o=<occurrence-id> with no ?d=, ?x=, ?y=, or ?z= parameters"
    why_human: "Cannot invoke navigator.clipboard in static analysis"
  - test: "Verify deep-link hydration — date loaded"
    expected: "Date selector shows the occurrence's observed date (not today's date) when opening a ?o=<id> URL in a fresh tab"
    why_human: "Requires live Supabase connection to fetch occurrence by ID"
  - test: "Verify deep-link hydration — map position"
    expected: "Map is centered on the occurrence's location at approximately zoom 12 when opening a ?o=<id> URL"
    why_human: "Requires browser map rendering with OpenLayers"
  - test: "Verify deep-link hydration — URL bar purity"
    expected: "URL bar shows only ?o=<id> after the app finishes loading — no ?d=, ?x=, ?y=, or ?z= appended"
    why_human: "Requires observing browser navigation state after Lit lifecycle runs"
---

# Phase 1: Occurrence Links Verification Report

**Phase Goal:** Enable visitors to share a direct link to any occurrence — a URL that, when opened, loads the correct date and centers the map on that occurrence.
**Verified:** 2026-03-04T23:30:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure

## Changes Since Previous Verification

**Gap 1 (TypeScript error) — CLOSED.** Commit `be79fad` removes the unused `id` destructure from `render()`, removes the now-unused `linkIcon` import, and removes the `.copy-link` CSS class that had been carried over from an earlier iteration. `npx tsc --noEmit` exits clean with no errors.

**Gap 2 (copy-link placement/appearance) — RECLASSIFIED as accepted deviation.** The user explicitly directed: "Let's also move the copy-link button down next to the Clone button and make it text." The implemented form — `<a href="#" @click=${this.onCopyLink}>${this.copied ? 'Copied!' : 'Copy link'}</a>` inside `ul.actions` — fully satisfies the requirement intent:
- LINK-01: visible to all visitors regardless of login (the `<li>` is the first child of `ul.actions`, which is rendered unconditionally — the `when(this.user ...)` and `when(editable ...)` guards cover only the Clone/Edit/Delete items that follow it).
- LINK-02: `buildShareUrl(id)` builds from `origin + pathname` only, confirmed by 3 passing unit tests.

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                              | Status     | Evidence                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Every occurrence card shows a copy-link element visible without login                              | VERIFIED   | `<a href="#" @click=${this.onCopyLink}>` is first `<li>` in unconditional `ul.actions`; accepted design deviation from icon-in-header per user direction |
| 2   | Clicking copies a URL of the form origin+pathname+?o=<id> — no date, position, or other params    | VERIFIED   | `buildShareUrl` builds from `origin+pathname` only; 3 unit tests confirm format; `onCopyLink` calls `navigator.clipboard.writeText(url)` |
| 3   | After clicking, element shows a success indicator for ~2 seconds, then reverts                     | VERIFIED   | `@state() copied` boolean; `setTimeout(() => { this.copied = false; }, 2000)` — shows 'Copied!' then 'Copy link' (accepted text-only design per user direction) |
| 4   | Opening ?o=<id> in a fresh tab loads the occurrence's date (not today's date)                      | VERIFIED   | `hydrateFromOccurrenceId` sets `this.#date = date` (bypassing setter), calls `fetchOccurrences(date)`       |
| 5   | Opening ?o=<id> in a fresh tab centers the map on the occurrence's location at approximately zoom 12 | VERIFIED | `setView(coord[0]!, coord[1]!, 12, {skipEvent: true})` called with `fromLonLat`-converted coordinates       |
| 6   | If the occurrence ID is not found, the app silently falls back to the default date and map position | VERIFIED  | `if (!occurrence) return` — no error thrown, method exits cleanly                                            |
| 7   | Deep-link hydration does not add ?d= or ?x=/?y=/?z= to the browser history                        | VERIFIED   | `this.#date = date` (not setter), `skipEvent: true` on setView; both history-safe patterns confirmed         |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact                  | Expected                                            | Status   | Details                                                                                                          |
| ------------------------- | --------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/icons.ts`            | `linkIcon` SVG path export                          | VERIFIED | `export const linkIcon = svg\`<path d="..."/>\`` — exists; no longer imported by obs-summary.ts (accepted)      |
| `src/obs-summary.ts`      | Copy-link element visible to all visitors           | VERIFIED | `<a href="#" @click=${this.onCopyLink}>` in unconditional `ul.actions`; `buildShareUrl` + `onCopyLink` present  |
| `src/obs-summary.test.ts` | Unit tests for `buildShareUrl`                      | VERIFIED | 3 tests: basic URL, no extra params, UUID round-trip — all passing                                              |
| `src/salish-sea.ts`       | `hydrateFromOccurrenceId` method + `firstUpdated` call | VERIFIED | Method present; `firstUpdated` conditionally calls it when `initialParams.occurrenceId` is set                  |
| `src/salish-sea.test.ts`  | Unit tests for `dateFromObservedAt`                 | VERIFIED | 3 tests covering Pacific timezone date derivation edge cases — all passing                                       |

### Key Link Verification

#### Plan 01 Key Links

| From                 | To                              | Via                     | Status  | Details                                                                          |
| -------------------- | ------------------------------- | ----------------------- | ------- | -------------------------------------------------------------------------------- |
| `src/obs-summary.ts` | `buildShareUrl()`               | `onCopyLink` handler    | WIRED   | Line 200: `const url = buildShareUrl(this.sighting.id);`                        |
| `src/obs-summary.ts` | `navigator.clipboard.writeText` | `onCopyLink` async handler | WIRED | Line 201: `await navigator.clipboard.writeText(url);`                           |

Note: `linkIcon` is not imported into `obs-summary.ts` — this is the accepted user design deviation (text link instead of SVG icon button). The link is NOT in the `<header>` element — also an accepted deviation.

#### Plan 02 Key Links

| From                           | To                                                           | Via                              | Status  | Details                                                                                      |
| ------------------------------ | ------------------------------------------------------------ | -------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `salish-sea.ts firstUpdated()` | `hydrateFromOccurrenceId()`                                  | `if (initialParams.occurrenceId)` | WIRED  | Conditional call in async `firstUpdated`                                                     |
| `hydrateFromOccurrenceId()`    | `supabase().from('occurrences').select().eq().maybeSingle()` | Supabase fetch-by-ID             | WIRED   | Exact pattern as specified                                                                   |
| `hydrateFromOccurrenceId()`    | `this.mapRef.value!.setView(x, y, 12, {skipEvent: true})`   | `fromLonLat` + `setView` call    | WIRED   | `const coord = fromLonLat([lon, lat]); this.mapRef.value!.setView(coord[0]!, coord[1]!, 12, {skipEvent: true})` |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                         | Status    | Evidence                                                                                             |
| ----------- | ----------- | ----------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| LINK-01     | Plan 01     | User can copy a shareable link to a specific occurrence from its summary card       | VERIFIED  | Text link "Copy link" in `ul.actions` (always rendered); accepted design deviation from icon-in-header per user direction |
| LINK-02     | Plan 01     | Shareable occurrence link encodes only the occurrence ID (`?o=<id>`)                | VERIFIED  | `buildShareUrl` uses `origin+pathname` only; confirmed by 3 passing unit tests                      |
| LINK-03     | Plan 02     | Following an occurrence link sets the date from that occurrence's `observed_at`     | VERIFIED  | `hydrateFromOccurrenceId` sets `#date` via private field + `fetchOccurrences`; `dateFromObservedAt` tested |
| LINK-04     | Plan 02     | Following an occurrence link sets the map center and zoom to that occurrence's location | VERIFIED | `setView` called with `fromLonLat` coordinates at zoom 12 with `skipEvent:true`                     |

**Orphaned requirements:** None. All 4 phase requirements (LINK-01 through LINK-04) are accounted for and verified.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| None | —    | —       | —        | —      |

The previously flagged `TS6133` unused-variable anti-pattern (`id` in destructure) was resolved in commit `be79fad`. No anti-patterns remain.

### Human Verification Required

#### 1. Copy-link visibility when logged out

**Test:** Open app in incognito window (no login). Check an occurrence card.
**Expected:** A "Copy link" text link is visible in the card's action row for all cards regardless of login state.
**Why human:** `ul.actions` renders unconditionally per code, but browser rendering requires running the app.

#### 2. Clipboard URL format

**Test:** Click "Copy link" on any occurrence card. Paste clipboard into a text editor.
**Expected:** URL is `https://<origin>/?o=<occurrence-id>` with no `?d=`, `?x=`, `?y=`, or `?z=` parameters.
**Why human:** Cannot invoke `navigator.clipboard` in static analysis.

#### 3. Deep-link hydration — date loaded

**Test:** Copy an occurrence link, open it in a new tab.
**Expected:** Date selector shows the occurrence's observed date (not today's date).
**Why human:** Requires live Supabase connection to fetch occurrence by ID.

#### 4. Deep-link hydration — map position

**Test:** Same tab from test 3. Check the map.
**Expected:** Map is centered on the occurrence's location at approximately zoom 12.
**Why human:** Requires browser map rendering with OpenLayers.

#### 5. Deep-link hydration — URL bar purity

**Test:** Same tab from test 3. Check the browser URL bar after the app finishes loading.
**Expected:** URL shows only `?o=<id>` — no `?d=`, `?x=`, `?y=`, or `?z=` parameters appended.
**Why human:** Requires observing browser navigation state after Lit lifecycle runs.

### Summary

All 7 observable truths are verified at the code level. All 4 requirements (LINK-01 through LINK-04) are satisfied. The two gaps from the previous verification are resolved:

- The TypeScript compilation error (`TS6133: 'id' is declared but its value is never read`) was fixed in commit `be79fad`, which removes the unused `id` destructure from `render()`, removes the stale `linkIcon` import, and removes the `.copy-link` CSS block. `npx tsc --noEmit` passes clean. All 15 Vitest tests pass across 6 test files.

- The copy-link placement and appearance deviation from the original plan spec is an accepted user design decision. The user directed the implementation to place the button in `ul.actions` as a text link ("Copy link" / "Copied!") rather than as an SVG icon button in `<header>`. The requirement intent of LINK-01 is fully met: the element is rendered unconditionally for all visitors regardless of authentication state.

The only remaining items are 5 human-verification tests that require a running browser and live Supabase connection to confirm behavior that cannot be statically analyzed.

---

_Verified: 2026-03-04T23:30:00Z_
_Verifier: Claude (gsd-verifier)_
