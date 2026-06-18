# Phase 8: Frontend Download Link - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 8-frontend-download-link
**Areas discussed:** Placement & surface, What's exposed, Explanatory copy & license, Last-updated indicator

---

## Placement & surface

### Q1: Where should the DwC-A download link live?

| Option | Description | Selected |
|--------|-------------|----------|
| Add to existing About modal | Append a 'Data download' section to the existing About `<dialog>` in `salish-sea.ts`. The modal already lists data sources and provenance, so the archive belongs in that same narrative. Smallest change, no new entry point, no new component. | ✓ |
| New dedicated 'Data' dialog | Add a second modal reachable from header. More discoverable, but adds a header item to a deliberately minimal chrome. | |
| Both — header link AND About-modal mention | Promote discoverability with two surfaces. | |
| New `/data` route | Introduce client-side routing for a dedicated `/data` page. Significantly larger change. | |

**User's choice:** Add to existing About modal.

### Q2: How should the download section sit within the About modal?

| Option | Description | Selected |
|--------|-------------|----------|
| Append as a new section after the data-sources list | Inserted between the existing `<ul>` and the feedback/funding paragraph. Reads as the natural follow-on. | ✓ |
| Inline link inside the existing data-sources list | Add one bullet to the existing `<ul>`. Smallest possible UI change but undersells the artifact. | |
| New section at the bottom | After the feedback/funding paragraph. Breaks the modal's current narrative flow. | |

**User's choice:** Append as a new section after the data-sources list.

---

## What's exposed

### Q1: Which artifacts should the section link to?

| Option | Description | Selected |
|--------|-------------|----------|
| Both `.zip` and `.parquet`, with `.sha256` sidecars linked beside each | The `.parquet` is a peer artifact; exposing checksums is cheap. | ✓ |
| Both `.zip` and `.parquet`, no checksum links | Mention checksums in copy but don't render them as links. | |
| Only `.zip` (DwC-A is the headline format) | Treat `.parquet` as undocumented bonus. | |

**User's choice:** Both `.zip` and `.parquet`, with `.sha256` sidecars linked beside each.

### Q2: Show file sizes next to each link?

| Option | Description | Selected |
|--------|-------------|----------|
| No — omit sizes | Sizes change nightly; HEAD costs round-trips. | |
| Yes — fetch via HEAD on modal open | Fire HEAD requests when the About modal opens. | ✓ |
| Yes — ship approximate text | Hardcode rough numbers; they go stale. | |

**User's choice:** Yes — fetch via HEAD on modal open.
**Notes:** Same-origin (site at `salishsea.io`, files at `salishsea.io/dwca/…`), so no CORS configuration is needed. `Last-Modified` from the same response is reused for the timestamp (see Last-updated indicator area).

---

## Explanatory copy & license

### Q1: How much explanatory copy ships alongside the download links?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal — one short paragraph + the links | Paragraph: contents, license, regen cadence. EML carries the formal metadata. | |
| Medium — short paragraph + inclusion/exclusion bullets + citation snippet | Adds 'What's included / excluded' and copy-pasteable citation. | |
| Comprehensive — inline EML-style summary | Duplicates `eml.xml`; drift risk. | |

**User's choice (free text):** Short paragraph, inclusion/exclusion, a link to learn more about Darwin Core.
**Notes:** Sits between Minimal and Medium — keeps the inclusion/exclusion bullets but skips the citation snippet (already in `eml.xml`); adds an outbound Darwin Core explainer link not present in any preset option.

### Q2: Which 'learn about Darwin Core' link target?

| Option | Description | Selected |
|--------|-------------|----------|
| `https://dwc.tdwg.org/` | Authoritative TDWG Darwin Core landing page. | ✓ |
| `https://dwc.tdwg.org/terms/` | Direct link to terms reference. More technical. | |
| `https://www.gbif.org/darwin-core` | GBIF's explainer; framed around 'why publish biodiversity data'. | |

**User's choice:** `https://dwc.tdwg.org/`.

### Q3: How should the license be presented?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in the paragraph, linked to the CC-BY-NC 4.0 URI | One sentence within the short paragraph. | ✓ |
| Separate 'License:' line beneath the links | Visually distinct line; more formal. | |
| Both — mention in copy and add a CC license badge image | Most visible, but adds an asset / CSP considerations. | |

**User's choice:** Inline in the paragraph, linked to the CC-BY-NC 4.0 URI.

---

## Last-updated indicator

### Q1: Show a 'last regenerated' timestamp next to the download links?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — derive from HEAD `Last-Modified` on the `.zip` | Free piggyback on the size-fetching HEAD. | ✓ |
| Yes — add a `manifest.json` the nightly workflow writes | Richer data, mild scope bleed into completed Phase 7. | |
| No — static 'updated nightly at 09:00 UTC' copy | Cheapest, but a stalled archive reads as fresh. | |

**User's choice:** Yes — derive from HEAD `Last-Modified` on the `.zip`.

### Q2: How should the timestamp render?

| Option | Description | Selected |
|--------|-------------|----------|
| Relative time, e.g., 'updated 6 hours ago' | Scannable; uses existing Temporal polyfill. | ✓ |
| Absolute UTC ISO, e.g., 'updated 2026-06-18 09:02 UTC' | Precise; less scannable. | |
| Both — relative with absolute tooltip | Best of both at slight template cost. | |

**User's choice:** Relative time.

### Q3: If the HEAD request fails, what should the UI show?

| Option | Description | Selected |
|--------|-------------|----------|
| Hide the timestamp and size, render links only | Degrades silently; Sentry catches the failure. | |
| Show 'updated nightly at 09:00 UTC' fallback copy | Keeps a freshness signal visible; could mislead if nightly is broken. | ✓ |
| Show an explicit error message | Most transparent; adds an error surface. | |

**User's choice:** Show 'updated nightly at 09:00 UTC' fallback copy.
**Notes:** CORS is a non-issue (same-origin), so failures are network or transient 5xx only. Failures still flow through the existing Sentry integration.

---

## Closing check

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Decisions look complete. | ✓ |
| Explore more gray areas | Candidates floated: 404 handling, mobile/aspect-ratio layout, modal-rename, NonCommercial-prominence. | |

**User's choice:** I'm ready for context.

---

## Claude's Discretion

- Exact heading wording for the new section.
- Order of links within the section.
- Visual treatment of the `.sha256` "verify" affordance.
- Whether to use a sub-`<ul>` or a definition list for file rows.
- Exact prose for inclusion/exclusion bullets (must convey the in-scope vs out-of-scope sources accurately).
- Cutoff for "relative → absolute" fallback when last-updated is suspiciously old (~7 days suggested).

## Deferred Ideas

- Header-level "Data" entry point (own dialog or chip).
- `/data` route + dedicated public-data page.
- `manifest.json` published by the nightly workflow (richer than `Last-Modified`).
- Citation snippet in the modal (duplicates `eml.xml`).
- CC license badge image.
- File-size HEADs on initial page load.
- GBIF/OBIS registration UI (already v1.2 out-of-scope per `REG-01`).
