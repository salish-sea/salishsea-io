# Phase 8: Frontend Download Link - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers a **discoverable, clearly-labeled link** in the existing About modal that downloads the DarwinCore Archive (and its GeoParquet sidecar) from the stable Phase 7 URLs under `https://salishsea.io/dwca/…`.

**Scope:**
- Extend the existing About `<dialog>` in `src/salish-sea.ts` with a new "Data download" section appended after the data-sources `<ul>` and before the feedback/funding paragraph.
- Link `.zip`, `.parquet`, and both `.sha256` sidecars (4 anchors).
- One `HEAD` per archive on modal open to populate file sizes and a relative "updated X ago" timestamp; static schedule-statement fallback on failure.
- Short paragraph + inclusion/exclusion bullets + outbound link to `https://dwc.tdwg.org/`. Inline CC-BY-NC 4.0 license link.

**Out of scope:**
- No new header chrome, no second dialog, no `/data` route, no footer.
- No citation snippet, no CC license badge image, no file-size hardcoding.
- No manifest.json (no scope bleed back into Phase 7).
- No changes to Phase 7's nightly workflow or Phase 6's archive generation.
- No GBIF/OBIS registration UI; deferred milestone work.

Requirements covered: **DOWNLOAD-01**.

</domain>

<decisions>
## Implementation Decisions

### Placement & surface

- **D-01:** Download section lives **inside the existing About `<dialog>`** in `src/salish-sea.ts` (around line 326–341). No new modal, no new header item, no router. The About modal already carries the dataset narrative ("We currently show: …"); the archive is the natural follow-on ("here's what we show → here's how to get it").
- **D-02:** Insertion point: a new section between the existing data-sources `<ul>` and the closing feedback/funding `<p>`. Reads as the modal's middle act. Do NOT inline a download bullet into the data-sources `<ul>` — the archive is not "another source", it's the export of all in-scope sources combined.

### What's exposed

- **D-03:** Link **all four** Phase 7 artifacts: `salishsea-occurrences-v1.zip`, `salishsea-occurrences-v1.parquet`, `salishsea-occurrences-v1.zip.sha256`, `salishsea-occurrences-v1.parquet.sha256`. The `.parquet` is a first-class milestone deliverable (see ROADMAP §"v1.2 Target features"); hiding it would undersell the work. `.sha256` sidecars rendered as small "verify" affordances beside each primary artifact.
- **D-04:** Render **file sizes** beside each link. Source via one `HEAD` request per archive fired when the About `<dialog>` opens (NOT on initial page load — opens are user-initiated and rare, so this is cheap). Same-origin (site at `salishsea.io`, files at `salishsea.io/dwca/…`) → no CORS configuration needed.
- **D-05:** No citation snippet inside the modal. The zip's `eml.xml` already carries the canonical citation; duplicating it in the UI risks drift.

### Explanatory copy & license

- **D-06:** Copy depth: **short paragraph + inclusion/exclusion bullets + outbound link explaining Darwin Core**. NOT minimal-only, NOT comprehensive EML-mirroring.
- **D-07:** Inclusion/exclusion bullets must explicitly call out:
  - Included: native SalishSea.io observations + Maplify / Whale Alert (incl. its Orca Network / Cascadia nested sources).
  - Excluded: iNaturalist & Happywhale (already published to GBIF by their canonical sources).
- **D-08:** Darwin Core explainer link target: **`https://dwc.tdwg.org/`** (the authoritative TDWG landing page). Not the GBIF explainer, not the terms reference.
- **D-09:** License rendered **inline in the prose** as a linked CC-BY-NC 4.0 reference: `https://creativecommons.org/licenses/by-nc/4.0/`. No separate "License:" line, no CC badge image (would add an asset + CSP/img-src considerations for a tiny visual win).

### Last-updated indicator

- **D-10:** Show a "last regenerated" timestamp beside the download links. Source it from the **`Last-Modified` response header** on the `.zip` HEAD request that's already happening for file-size data (free — same response). No `manifest.json`, no second fetch.
- **D-11:** Format: **relative time** (e.g., "updated 6 hours ago"). The site already uses `@js-temporal/polyfill` (see `salish-sea.ts:387`) so a relative formatter slots in. Acceptable to fall back to absolute ISO once relative passes ~7 days (a visual hint that the nightly run has stalled).
- **D-12:** On HEAD failure (network, transient 5xx — CORS is a non-issue since same-origin), fall back to **static schedule-statement copy**: "Updated nightly at 09:00 UTC." Keeps a freshness signal visible without an error surface. Failures still surface via the existing Sentry integration. Hide file sizes silently on the same failure path (don't render placeholders or skeletons).

### CSP

- **D-13:** No CSP changes required. Same-origin HEAD/GET to `salishsea.io/dwca/…` is allowed by `connect-src 'self'` in `index.html`. The outbound `dwc.tdwg.org` and `creativecommons.org/licenses/by-nc/4.0/` links are pure anchors (navigation), not fetches, so they don't touch `connect-src` either.

### Claude's Discretion

- Exact heading wording for the new section (e.g., "Data download", "Download dataset", "DarwinCore Archive").
- Order of links within the section (.zip first vs .parquet first — recommend .zip first since DwC-A is the headline format).
- Visual treatment of the `.sha256` "verify" affordance (small text link, sup, parens).
- Whether to use a sub-`<ul>` or a definition list for the file rows.
- Exact prose for the inclusion/exclusion bullets — must convey the spirit of D-07.
- Cutoff for "relative → absolute" fallback (suggested 7 days, but use judgment).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 8: Frontend Download Link" — goal, dependency on Phase 7, success criteria (visitor finds + downloads the archive).
- `.planning/REQUIREMENTS.md` §"DOWNLOAD-01" — the one requirement this phase satisfies.
- `.planning/PROJECT.md` §"Current Milestone: v1.2 Export to DarwinCore Archive" — milestone goals, scope decisions (which sources are in/out), CC-BY-NC 4.0 license decision.

### Upstream phase artifacts (what to link to)
- `.planning/phases/07-nightly-workflow-hosting/07-CONTEXT.md` §"Atomic publish (EXPORT-03)" — locks the filenames (`salishsea-occurrences-v1.zip`, `salishsea-occurrences-v1.parquet`, `<name>.sha256`) and the public URL prefix `https://salishsea.io/dwca/…`. This is the canonical source of truth for what the UI links to.
- `.planning/phases/07-nightly-workflow-hosting/07-CONTEXT.md` §"CloudFront invalidation & smoke verification" — confirms the L-01 Lambda@Edge `/dwca/*` carve-out is in place, so direct binary downloads work for ALL user agents (not just non-bot UAs).
- `.planning/phases/04-rights-data-model-policy-gate/` — POLICY.md is the upstream source for the CC-BY-NC 4.0 license and the inclusion/exclusion stance (native + Whale Alert/Maplify; no iNat/Happywhale).

### Codebase integration point
- `src/salish-sea.ts:326-341` — the existing About `<dialog>` and its narrative prose. New section appends here.
- `src/salish-sea.ts:91-94` — `.about-link` class. The trigger anchor that opens the modal stays as-is.

### External references (linked from UI)
- `https://dwc.tdwg.org/` — Darwin Core explainer; outbound from new section copy.
- `https://creativecommons.org/licenses/by-nc/4.0/` — CC-BY-NC 4.0 license URI; outbound from inline license mention.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **About `<dialog>` element** (`src/salish-sea.ts:326-341`) — already wired with `dialogRef`, `onAboutClicked`, `onCloseModal`. New section appends inside the existing dialog body; no new lifecycle code needed.
- **`@js-temporal/polyfill`** — already imported in `salish-sea.ts` (see `Temporal.Instant.from(...)` at line 387). Relative-time formatting for "updated X ago" reuses this dependency; no new deps.
- **Sentry integration** (`src/sentry.ts`) — already wired. HEAD failures can flow through it with no new setup.

### Established Patterns
- **Lit inline `html`-template prose** — the About modal renders prose with inline anchors via the `html\`...\`` template literal. New section follows the same pattern (no separate component file needed for v1; this is a small additive section, not a reusable widget).
- **Component styles via static `css`** — any new selectors for the download section live in the existing `static styles` block in `salish-sea.ts` (joins the existing `.about-link`, `.close-dialog`, `dialog`, `header` rules).
- **No router** — the SPA has no client-side routing. Confirmed by absence of router imports anywhere in `src/`. Phase 8 does not introduce one.
- **Same-origin Supabase + assets pattern** — CSP `connect-src` is `'self' %VITE_SUPABASE_URL% %VITE_SUPABASE_WS_URL% …`; same-origin HEAD/GET to `/dwca/*` is permitted with no CSP edit.

### Integration Points
- **`render()` in `salish-sea.ts:315`** — single render of the About `<dialog>`. The new download section is a child of that dialog, between the existing `<ul>` and closing `<p>`.
- **`firstUpdated()` or a `@state()` + `onAboutClicked` augmentation** — fire the HEAD request when the dialog opens (NOT on `firstUpdated`), so the request happens only if the user opens the modal. Store result in a `@state` field (or a small reactive controller) that the dialog template reads. Dialog stays usable while HEAD is in flight (links work immediately; size/timestamp populate when the response arrives).

</code_context>

<specifics>
## Specific Ideas

- The "what's included / excluded" bullets are the single most important piece of new prose — they prevent the predictable "where's the iNat data?" support question. Be specific about iNat + Happywhale being out and the rationale (already published to GBIF).
- The four file links should feel like one coherent download offering, not four unrelated items. Group visually (a small unordered list or a definition list per artifact, with the `.sha256` rendered as a secondary "verify" affordance).
- "Updated X ago" benefits from a soft-staleness cue once the value is suspiciously old (~7 days) — the relative phrasing itself signals freshness; an absolute date is a quiet alarm.

</specifics>

<deferred>
## Deferred Ideas

- **Header-level "Data" entry point** — promoting the download to its own header chip / dialog. Considered and declined for this phase (minimal chrome wins; About modal carries the narrative). Revisit if download usage grows materially.
- **`/data` route + dedicated page** — would introduce client-side routing, a meaningful architectural change. Belongs in a future "Public data portal" phase if the dataset story expands (multiple artifacts, per-dataset metadata, API access).
- **`manifest.json` published by the nightly workflow** — richer than `Last-Modified` (could carry row count, per-file sizes, per-file checksums, regen status). Considered and declined to avoid scope-bleed into completed Phase 7. Worth revisiting when a second consumer (e.g., a GBIF IPT endpoint) wants programmatic discovery.
- **Citation snippet in the modal** — useful for researchers but duplicates `eml.xml`. Defer until users ask, OR until the EML's citation form is locked.
- **CC license badge image** — pure visual; declined for asset/CSP overhead. Trivial to add later if license prominence becomes a concern.
- **File-size HEADs on initial page load** — declined; only fire on dialog open. Reconsider only if HEAD-on-open noticeably delays the size/timestamp populate.
- **GBIF/OBIS registration UI** — explicitly v1.2 out-of-scope per PROJECT.md "Scope decisions" and REQUIREMENTS.md `REG-01` (deferred).

</deferred>

---

*Phase: 8-frontend-download-link*
*Context gathered: 2026-06-18*
