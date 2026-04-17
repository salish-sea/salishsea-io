# Phase 1: Occurrence Links - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a copy-link affordance to occurrence summary cards, and hydrate date + map position from occurrence ID when a shared link is opened. No new data, no new pages — purely URL-based shareability for existing occurrences.

</domain>

<decisions>
## Implementation Decisions

### Copy link placement
- Visible to all users — no login required to copy a link
- Small icon button in the `obs-summary` header row, alongside the existing time element
- Not gated behind the `ul.actions` block (which requires login), so anonymous visitors can share too
- Use a chain/link SVG icon consistent with the existing monospace `.focus-occurrence` button style

### Copy feedback
- Transient state: button switches to a "✓" or "Copied!" indicator for ~2 seconds, then reverts
- No toast or notification infrastructure needed — keep it self-contained in `obs-summary`

### Deep link hydration
- When `?o=<id>` is present on load, fetch the occurrence by ID first, derive the `observed_at` date from it, then load the full day's occurrences for that date
- Center the map on the occurrence's location at a zoom level appropriate for a single sighting (~zoom 12)
- The copied URL must contain ONLY `?o=<id>` — strip date (`?d=`) and map position (`?x=`, `?y=`, `?z=`) parameters when building the shareable link

### Claude's Discretion
- Exact SVG icon for the copy button
- Precise zoom level when centering on occurrence (within reason: close enough to identify the location)
- Error handling if occurrence ID is not found (silently fall back to default date/position)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseUrlParams` in `salish-sea.ts`: already reads `?o=<id>` into `focusedOccurrenceId` — the param name is established
- `focusOccurrence()` in `salish-sea.ts`: already writes `?o=<id>` via `setQueryParams` when an occurrence is focused — copy link can produce the same URL shape
- `ul.actions` in `obs-summary.ts`: existing action button style (small bordered links) — copy link button can match this aesthetic even if placed outside the block

### Established Patterns
- URL management: `setQueryParams` / `removeQueryParam` / `window.history.pushState` used throughout `salish-sea.ts`
- Custom events bubble up from child components to `salish-sea` root — deep link hydration logic belongs in `salish-sea`
- Supabase queries: `supabase().from('occurrences').select()...` — a fetch-by-ID variant follows the same pattern

### Integration Points
- `salish-sea.ts` constructor / `connectedCallback`: where initial deep link hydration logic should run (after `initialParams` is parsed)
- `obs-summary.ts` header template: where the copy link button is added
- `setQueryParams` / URL construction: copy link builds `?o=<id>`-only URL by starting from `window.location.origin + window.location.pathname`

</code_context>

<specifics>
## Specific Ideas

- The shareable URL is `?o=<id>` only — no date, no map position. The recipient's view is derived from the occurrence data, not from the sender's viewport.
- Copying uses `navigator.clipboard.writeText()` — modern, no Flash fallback needed for this audience.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-occurrence-links*
*Context gathered: 2026-03-04*
