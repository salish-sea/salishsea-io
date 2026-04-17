# Phase 1: Occurrence Links - Research

**Researched:** 2026-03-04
**Domain:** Lit web components, URL parameter management, Clipboard API, Supabase query, OpenLayers map centering
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Copy link affordance visible to all users — no login required
- Small icon button in the `obs-summary` header row, alongside the existing `<time>` element
- NOT inside `ul.actions` (which is login-gated)
- Transient copied feedback: button switches to "✓" or "Copied!" for ~2 seconds, then reverts; no toast infrastructure
- When `?o=<id>` is present on load: fetch occurrence by ID first, derive `observed_at` date, load full day's occurrences, center map on occurrence's location at ~zoom 12
- Copied URL contains ONLY `?o=<id>` — strip `?d=`, `?x=`, `?y=`, `?z=` from the shareable link
- Copying uses `navigator.clipboard.writeText()` — no Flash fallback

### Claude's Discretion
- Exact SVG icon for the copy button
- Precise zoom level when centering on occurrence (within reason: close enough to identify location)
- Error handling if occurrence ID not found (silently fall back to default date/position)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LINK-01 | User can copy a shareable link to a specific occurrence from its summary card in the sidebar | Copy button in `obs-summary` header row; `navigator.clipboard.writeText()` pattern; transient state via `@state()` |
| LINK-02 | Shareable occurrence link encodes only the occurrence ID (e.g. `?o=<id>`) | Build URL from `window.location.origin + pathname`; existing `setQueryParams` pattern; only append `?o=<id>` |
| LINK-03 | Following an occurrence link sets the date from that occurrence's `observed_at` timestamp | Fetch by ID in `connectedCallback`; derive date with `Temporal.Instant`; call `fetchOccurrences(date)` |
| LINK-04 | Following an occurrence link sets the map center and zoom to that occurrence's location | `fromLonLat([lon, lat])` + `mapRef.value!.setView(x, y, zoom, {skipEvent: true})`; coordinate system is EPSG:3857 |
</phase_requirements>

## Summary

This phase is entirely additive and self-contained: no new data models, no new routes, no new infrastructure. All the underlying primitives are already in the codebase — URL parsing reads `?o=<id>`, `focusOccurrence()` writes `?o=<id>`, Supabase queries follow an established pattern, and `obs-map` exposes `setView()`. The work is (1) a copy-link button in `obs-summary`, and (2) deep-link hydration logic in `salish-sea.ts` that fires during `connectedCallback` when `?o=<id>` is present at load time.

The most non-trivial piece is the hydration sequence: fetch occurrence by ID → derive date string → fetch all occurrences for that date → center map. This must handle the async/timing gap between `connectedCallback` (when DOM is ready) and `firstUpdated` (when `mapRef` is populated). The hydration that calls `mapRef.value!.setView()` must wait until after `firstUpdated`.

The copy-link button's transient "copied" state is a simple Lit `@state()` toggle — no external library needed.

**Primary recommendation:** Implement in two focused changes: (1) add copy-link button to `obs-summary.ts`; (2) add `#hydrateFromOccurrenceId()` async method to `SalishSea` called from `firstUpdated` when `initialParams.occurrenceId` is set.

## Standard Stack

### Core (already in use — no new installs)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Lit | ^3.3.2 | Web component framework | Existing project framework |
| temporal-polyfill | ^0.3 | Date/time parsing for `observed_at` | Already used for date math in `salish-sea.ts` |
| @supabase/supabase-js | ^2.92.0 | Fetch occurrence by ID | Existing data access pattern |
| OpenLayers (ol) | ^10.7.0 | Map centering via `setView()` | Existing map library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `navigator.clipboard` | Browser API | Copy URL to clipboard | Modern browsers only — this audience is assumed to support it |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `navigator.clipboard.writeText()` | `document.execCommand('copy')` | Legacy fallback — not needed for this audience |
| Transient `@state()` in component | Toast notification library | Toast would require new infrastructure; self-contained is simpler and was decided |

**No new package installation required.** All dependencies are already present.

## Architecture Patterns

### Recommended Project Structure
No new files required. Changes are confined to:
```
src/
├── salish-sea.ts    # Add hydrateFromOccurrenceId() called in firstUpdated()
├── obs-summary.ts   # Add copy-link button to header template + @state for copied feedback
└── icons.ts         # Add link SVG icon (following cameraAddIcon pattern)
```

### Pattern 1: Copy-Link Button in obs-summary

**What:** A small icon button alongside the `<time>` element in `obs-summary`'s header. On click, builds a `?o=<id>`-only URL and calls `navigator.clipboard.writeText()`. Transiently sets a `@state() private copied = false` flag which flips to true for ~2 seconds via `setTimeout`.

**When to use:** Every occurrence card — no login gate.

**Example (Lit `@state()` transient pattern):**
```typescript
// In obs-summary.ts
@state() private copied = false;

private async onCopyLink(e: Event) {
  e.preventDefault();
  const url = `${window.location.origin}${window.location.pathname}?o=${this.sighting.id}`;
  await navigator.clipboard.writeText(url);
  this.copied = true;
  setTimeout(() => { this.copied = false; }, 2000);
}
```

**Template addition (inside `<header>`, after `<time>`):**
```typescript
<button class="copy-link" @click=${this.onCopyLink} title="Copy link to this sighting">
  ${this.copied ? '✓' : linkIcon}
</button>
```

**Key insight:** The button must NOT be inside `ul.actions` (which is `when(this.user || editable, ...)`). It goes directly in the `<header>` flex row alongside `.species-info` and `time`.

### Pattern 2: Deep-Link Hydration in salish-sea.ts

**What:** When the app loads with `?o=<id>`, fetch the occurrence by ID, derive the date, load that day's occurrences, and center the map. This runs in `firstUpdated()` because `mapRef.value` is only available after the first render.

**When to use:** Only when `initialParams.occurrenceId` is set at page load.

**Why `firstUpdated`, not `connectedCallback`:** The Lit lifecycle runs `connectedCallback` → `render` → `firstUpdated`. The `mapRef` and `panelRef` are only populated after the first render, so `setView()` calls must wait. `connectedCallback` already has a pattern for GSI token processing; hydration belongs in `firstUpdated`.

**Example:**
```typescript
// In salish-sea.ts — add to firstUpdated()
protected async firstUpdated(_changedProperties: PropertyValues): Promise<void> {
  this.olmap = this.mapRef.value!.map;
  this.drawingSource = this.mapRef.value!.drawingSource;
  // NEW: hydrate from occurrence ID if present at load
  if (initialParams.occurrenceId) {
    await this.hydrateFromOccurrenceId(initialParams.occurrenceId);
  }
}

private async hydrateFromOccurrenceId(id: string): Promise<void> {
  const {data: occurrence} = await supabase()
    .from('occurrences')
    .select()
    .eq('id', id)
    .maybeSingle();
  if (!occurrence) return; // silent fallback per decisions

  const date = Temporal.Instant.from(occurrence.observed_at)
    .toZonedDateTimeISO('PST8PDT')
    .toPlainDate()
    .toString();
  // Set date without pushing a new history entry (it's the initial load)
  this.#date = date;
  await this.fetchOccurrences(date);

  // Center map on occurrence location
  const {lon, lat} = occurrence.location as {lon: number; lat: number};
  const [x, y] = fromLonLat([lon, lat]); // ol/proj — already imported in obs-map.ts
  this.mapRef.value!.setView(x, y, 12, {skipEvent: true});
  this.focusedOccurrenceId = id;
}
```

**Coordinate system note:** The map operates in EPSG:3857 (Spherical Mercator). `setView(x, y, zoom)` takes EPSG:3857 coordinates. The `fromLonLat([lon, lat])` function (from `ol/proj.js`) converts WGS-84 `{lon, lat}` to EPSG:3857 `[x, y]`. This import is already used in `occurrence.ts` and `obs-map.ts`.

### Pattern 3: SVG Icon in icons.ts

**What:** Add a link/chain icon following the existing `svg` tagged template pattern.

**Example:**
```typescript
// In icons.ts — Material Symbols "link" path
export const linkIcon = svg`<svg viewBox="0 -960 960 960" height="1em" width="1em" fill="currentColor">
  <path d="M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z"/>
</svg>`;
```

**Note:** The existing icons use a bare `svg\`` tagged template (path only, no `<svg>` wrapper) when embedded inside a parent `<svg>` element. Since the copy button will be a `<button>` not an `<svg>`, the icon should either (a) be a full `<svg>` element or (b) be an `<svg>` wrapper with the path. Check how existing icons are rendered in templates before deciding — the existing pattern wraps path-only icons inside an `<svg>` in the template call site.

### Anti-Patterns to Avoid

- **Setting `this.date` during hydration:** `this.date = date` triggers `setQueryParams({d})` via the setter, which would push a history entry and pollute the "clean" link. Use `this.#date = date` and call `fetchOccurrences(date)` directly.
- **Calling `setView()` in `connectedCallback`:** `mapRef.value` is `undefined` until after `firstUpdated`. Calling it there will throw.
- **Putting copy button inside `ul.actions`:** That block is conditionally rendered only for logged-in users; the button must always be visible.
- **Using `window.location.href` for the shareable URL:** That includes whatever `?d=`, `?x=`, `?y=`, `?z=` params are currently set. Build the URL from `origin + pathname + "?o=" + id` instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Convert lon/lat to EPSG:3857 | Custom projection math | `fromLonLat([lon, lat])` from `ol/proj.js` | Already in codebase; handles all edge cases |
| Parse `observed_at` to date string | Custom date parsing | `Temporal.Instant.from(observed_at).toZonedDateTimeISO('PST8PDT').toPlainDate().toString()` | Exact pattern already used in `focusOccurrence()` |
| Fetch occurrence by ID | New fetch utility | `supabase().from('occurrences').select().eq('id', id).maybeSingle()` | Follows established Supabase query pattern in codebase |
| Transient copied state | Timer library | Native `setTimeout` + `@state()` | Standard Lit reactive property pattern; zero deps |

**Key insight:** Every primitive needed for this phase exists in the codebase. The task is composition, not construction.

## Common Pitfalls

### Pitfall 1: History Pollution During Hydration
**What goes wrong:** Using `this.date = date` during `hydrateFromOccurrenceId()` invokes the setter, which calls `setQueryParams({d})`, pushing `?d=YYYY-MM-DD` onto the history stack. The user then hits Back and gets a confusing `?d=` URL instead of returning to their previous page.
**Why it happens:** The `date` setter unconditionally calls `setQueryParams` unless `#isRestoringFromHistory` is true (only set during popstate).
**How to avoid:** Assign `this.#date` directly (bypassing the setter) and call `fetchOccurrences(date)` manually. Or temporarily set `this.#isRestoringFromHistory = true` around the assignment.
**Warning signs:** Browser history grows unexpectedly on initial page load.

### Pitfall 2: Map Not Ready in connectedCallback
**What goes wrong:** Calling `this.mapRef.value!.setView(...)` in `connectedCallback` — `mapRef.value` is `undefined` because the shadow DOM hasn't rendered yet.
**Why it happens:** Lit populates `ref()`-tracked elements only after the first `render()` completes, which happens after `connectedCallback`.
**How to avoid:** All map interactions must go in `firstUpdated()` or later lifecycle callbacks.
**Warning signs:** `TypeError: Cannot read properties of undefined (reading 'setView')` at startup.

### Pitfall 3: URL Contains Current Viewport Params
**What goes wrong:** Building the shareable URL as `window.location.href` or `new URL(window.location.href)` then setting `o` — this carries over `?d=`, `?x=`, `?y=`, `?z=` from the sender's current session.
**Why it happens:** `window.location.href` reflects the full current URL including all params set by map movement and date selection.
**How to avoid:** Build the URL as `window.location.origin + window.location.pathname + '?o=' + id` — no other params.
**Warning signs:** Recipients land on sender's date/zoom rather than the occurrence's native date/position.

### Pitfall 4: Race Between fetchOccurrences and setView
**What goes wrong:** `fetchOccurrences(date)` is async. If `setView` fires before occurrences are loaded, the map may later re-render/reset focus when occurrences arrive.
**Why it happens:** `setOccurrences()` on the map also calls `selectFeature()` for `focusedOccurrenceId` — if that ID's feature doesn't exist yet, nothing is selected. But because `focusedOccurrenceId` is set, `willUpdate()` in `obs-map` will attempt to select it when occurrences do arrive.
**How to avoid:** Set `focusedOccurrenceId` before calling `setView`, so when occurrences arrive via `receiveOccurrences → setOccurrences`, the map's `willUpdate` can select and center the feature naturally. The explicit `setView` call then just ensures zoom is correct regardless of prior viewport.
**Warning signs:** Feature not highlighted on map after deep link load.

### Pitfall 5: icons.ts SVG Format Mismatch
**What goes wrong:** The existing icons (`cameraAddIcon`, `locateMeIcon`) export only SVG `<path>` content, not full `<svg>` elements. They appear to be used inside an SVG wrapper at the call site. Adding the copy-link icon as a full `<svg>` element when others are bare paths will look inconsistent or fail to render.
**Why it happens:** Not checking how existing icons are consumed before adding a new one.
**How to avoid:** Check how the existing icons are used in templates before deciding the format for the link icon. In `obs-summary.ts` the copy button is in an HTML `<button>`, not inside an SVG — so a full `<svg>` element is needed, unlike the path-only format for icons used inside an SVG container.

## Code Examples

Verified patterns from existing codebase:

### Supabase Fetch by ID (maybeSingle pattern)
```typescript
// Source: occurrence.ts fetchLastOwnOccurrence — established maybeSingle pattern
const {data: occurrence, error} = await supabase()
  .from('occurrences')
  .select('*')
  .eq('id', id)
  .maybeSingle<Occurrence>();
if (error)
  throw new Error(`Couldn't fetch occurrence: ${error.message}`);
if (!occurrence) return; // not found — silent fallback
```

### Date Derivation from observed_at
```typescript
// Source: salish-sea.ts focusOccurrence() — exact pattern
const date = Temporal.Instant.from(occurrence.observed_at)
  .toZonedDateTimeISO('PST8PDT')
  .toPlainDate()
  .toString();
```

### Coordinate Conversion: lon/lat → EPSG:3857
```typescript
// Source: occurrence.ts occurrence2feature() — fromLonLat usage
import { fromLonLat } from 'ol/proj.js';
const {lat, lon} = occurrence.location;
const [x, y] = fromLonLat([lon, lat]); // Returns EPSG:3857 coordinates
```

### Map setView
```typescript
// Source: obs-map.ts setView() public method signature
this.mapRef.value!.setView(x, y, 12, {skipEvent: true});
// skipEvent: true suppresses the 'map-move' event that would write ?x=/?y=/?z= to history
```

### Lit @state() Transient Flag
```typescript
// Standard Lit reactive property for transient UI state
@state() private copied = false;

private async onCopyLink(e: Event) {
  e.preventDefault();
  await navigator.clipboard.writeText(url);
  this.copied = true;
  setTimeout(() => { this.copied = false; }, 2000);
}
```

### Building a Clean Shareable URL
```typescript
// Build ?o=<id>-only URL — no viewport params from current session
const url = `${window.location.origin}${window.location.pathname}?o=${this.sighting.id}`;
await navigator.clipboard.writeText(url);
```

### Existing setQueryParams (for reference — NOT used for copy link)
```typescript
// Source: salish-sea.ts — how URL is normally managed
function setQueryParams(params: {[k: string]: string}, options: {replace?: boolean} = {}) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  if (options.replace) {
    window.history.replaceState({}, '', url.toString());
  } else {
    window.history.pushState({}, '', url.toString());
  }
}
```

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| `document.execCommand('copy')` | `navigator.clipboard.writeText()` | Async, Promise-based; requires HTTPS (already the case for this deployment) |
| Manual date timezone math | `Temporal.Instant` + `toZonedDateTimeISO` | Already used throughout project |

**Deprecated/outdated:**
- `execCommand('copy')`: Deprecated in all major browsers; `navigator.clipboard` is the standard.

## Open Questions

1. **`firstUpdated` signature change to async**
   - What we know: Current `firstUpdated` is sync. Adding `hydrateFromOccurrenceId` requires awaiting.
   - What's unclear: Whether Lit handles async `firstUpdated` cleanly (it does — Lit doesn't await lifecycle hooks, but that's fine since we only need the side effects).
   - Recommendation: Change return type to `Promise<void>`, no other changes needed.

2. **Type of `occurrence.location` from the raw Supabase response**
   - What we know: `Occurrence` type from `types.ts` has `location: {lat: number; lon: number}`. The raw `.select()` in `hydrateFromOccurrenceId` returns `PatchedDatabase` row type where location may be typed differently (as a composite type).
   - What's unclear: Whether `.select()` without casting gives `location` as `{lat, lon}` or a PostGIS-style string/object.
   - Recommendation: Cast as `Occurrence` or access `.location as {lat: number; lon: number}` explicitly. Check `fetchLastOwnOccurrence` — it uses `.maybeSingle<Occurrence>()` which handles this via generic typing.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LINK-01 | Copy button present in obs-summary header (not in ul.actions) | manual-only | — | N/A |
| LINK-02 | Copied URL is `origin + pathname + ?o=<id>` only | unit | `npx vitest run src/obs-summary.test.ts` | ❌ Wave 0 |
| LINK-03 | Deep link sets date from occurrence's observed_at | unit | `npx vitest run src/salish-sea.test.ts` | ❌ Wave 0 |
| LINK-04 | Deep link centers map on occurrence location | manual-only | — | N/A |

**Manual-only justifications:**
- LINK-01: Testing DOM structure of a Lit shadow DOM element requires a browser environment (jsdom does not support Lit lifecycle); reasonable to verify visually.
- LINK-04: Map centering requires OpenLayers map rendering, which is not feasible in a Vitest/jsdom environment. Verify by loading a deep link in the browser.

**Unit-testable logic:**
- LINK-02: URL construction is pure string logic — `origin + pathname + ?o=id` — testable without DOM.
- LINK-03: The date derivation from `observed_at` (Temporal.Instant → ZonedDateTime → PlainDate) is pure logic — already tested in similar forms elsewhere.

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/obs-summary.test.ts` — URL construction test for LINK-02: verifies `buildShareUrl(id)` returns `origin + pathname + ?o=<id>`
- [ ] `src/salish-sea.test.ts` — Date derivation test for LINK-03: verifies `observed_at` → date string via Temporal — may be a unit test of the helper logic extracted from `hydrateFromOccurrenceId`

**Note:** If URL construction and date derivation stay as inline logic inside component methods (not extracted), only integration/manual testing is feasible for those requirements. Consider extracting a pure `buildShareUrl(id: string): string` helper and the date derivation into a testable utility to enable unit tests.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/salish-sea.ts`, `src/obs-summary.ts`, `src/obs-map.ts`, `src/occurrence.ts`, `src/types.ts`, `src/icons.ts`
- Lit documentation (prior knowledge, HIGH confidence for core patterns: `@state()`, `firstUpdated`, `ref()`)
- MDN Web Docs — `navigator.clipboard.writeText()` (standard, well-established API)
- OpenLayers `ol/proj.js` `fromLonLat` — used in `occurrence.ts` (verified by code inspection)

### Secondary (MEDIUM confidence)
- Temporal API date manipulation patterns — `Temporal.Instant.from().toZonedDateTimeISO()` patterns inferred from existing `salish-sea.ts` `focusOccurrence()` implementation

### Tertiary (LOW confidence — flagged)
- None — all claims are grounded in direct codebase inspection or well-established browser APIs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all existing, inspected directly
- Architecture: HIGH — integration points identified from actual code; patterns derived from existing implementations
- Pitfalls: HIGH — derived from direct reading of setter logic, Lit lifecycle, and URL construction code
- Test gaps: MEDIUM — Vitest confirmed present; test scope judgments about manual-only are based on known Lit/jsdom constraints

**Research date:** 2026-03-04
**Valid until:** 2026-06-01 (stable stack; no fast-moving dependencies for this phase)
