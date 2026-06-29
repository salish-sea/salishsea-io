---
type: quick
slug: 260629-ggu
title: Break the About popover out into its own page (route/URL of its own)
autonomous: false
files_modified:
  - src/about-page.ts          # new component
  - src/about-page.test.ts     # new tests (migrated from salish-sea.test.ts)
  - src/salish-sea.ts          # ?about routing, remove the <dialog> modal
  - src/salish-sea.test.ts     # trim moved tests, add routing assertions

must_haves:
  truths:
    - "Visiting /?about by direct load or refresh shows the About page, not the map+panel."
    - "The About page preserves ALL prior modal content: intro, the four data-source bullets, the DwC-A download block (4 links + sizes + freshness + CC BY-NC), and the feedback/funding paragraph."
    - "The DwC-A archive HEAD request fires once per session when the About page is first shown, populating sizes and freshness; it does NOT refire on subsequent visits."
    - "The About page has a single page-level h1 and a 'Back to map' link/control that returns to the map; the map keeps its position."
    - "Browser Back/Forward toggles the About page (it is a real history entry)."
  artifacts:
    - path: "src/about-page.ts"
      provides: "<about-page> full-viewport About view + DwC-A download section + per-session HEAD fetch"
      exports: ["AboutPage", "_clearDownloadCache"]
    - path: "src/about-page.test.ts"
      provides: "Download-section DOM + per-session HEAD-fetch tests targeting <about-page>"
    - path: "src/salish-sea.ts"
      provides: "?about query-param route: parse, state, popstate sync, conditional render, inert"
  key_links:
    - from: "src/salish-sea.ts header ⓘ link"
      to: "?about query param"
      via: "onAboutClicked -> setQueryParams({about}) + showAbout=true"
    - from: "src/about-page.ts"
      to: "fetchArchiveMetadata (download-info.ts)"
      via: "mount-time fetch guarded by module-level per-session cache"
    - from: "src/about-page.ts 'Back to map'"
      to: "src/salish-sea.ts"
      via: "close-about CustomEvent -> removeQueryParam('about') + showAbout=false"
---

<objective>
Replace the in-app About `<dialog>` modal with a real, shareable About page that lives at its own URL, while preserving every piece of existing content and the DwC-A "HEAD-on-open, once-per-session" availability check.

**Chosen approach (matches the existing idiom — no router, no infra change):**
- The About "page" is represented by a **query param: `/?about`**, exactly like the existing `o` (focused occurrence) view-toggle param. Reading uses `searchParams.has('about')`; writing uses the existing `setQueryParams`/`removeQueryParam` helpers (pushState, so Back/Forward and sharing work).
- **Direct load / refresh / share works with ZERO infra change** because the path stays `/`. CloudFront's `defaultRootObject: 'index.html'` serves the SPA for `/`, and the Lambda@Edge handler passes the request through; the app then reads `?about` on boot. (A path route like `/about` would 404 on direct load — there is no 404→index.html fallback in the distribution — which is exactly why the query-param idiom is used. Bots requesting `/?about` carry no `o` param, so the edge handler returns the existing generic site preview; no edge-handler change needed.)
- The About content moves into a dedicated `<about-page>` Lit component (matching the project's small-component convention), rendered full-viewport over the map. The map stays mounted (no OpenLayers re-init); `<header>`/`<main>` get `inert` while About is shown so the page is a clean single-h1 accessible view with a clear "Back to map" affordance.

Purpose: a bookmarkable/shareable About page instead of a transient modal, with no new dependency, no routing framework, and no CloudFront work.
Output: `<about-page>` component + `?about` routing in `<salish-sea>`; the `<dialog>` is removed.
</objective>

<context>
@.planning/STATE.md
@src/salish-sea.ts
@src/salish-sea.test.ts
@src/download-info.ts
@src/partner-links.ts
@index.html
@infra/lib/edge-handler/index.ts
</context>

<constraints>
- Do NOT add a routing library/framework. Use the existing query-param + `pushState`/`popstate` idiom already present in `salish-sea.ts`.
- Preserve ALL existing About content verbatim (intro paragraph, the four `<li>` data-source bullets, the entire `renderDownloadSection` block incl. the four `/dwca/salishsea-occurrences-v1.*` links + `.sha256` links + size `<small>`s + freshness line + DwC + CC BY-NC outbound links with `rel="noopener noreferrer"`, and the feedback/funding paragraph).
- Preserve the DwC-A behavior from v1.2 Phase 8: a single HEAD pair (`.zip` + `.parquet`) fired when the About page is shown, cached **once per session**, with the `{ ok:false }` fallback rendering "Updated nightly at 09:00 UTC." and no size text. Keep using the existing `fetchArchiveMetadata`, `formatBytes`, `formatRelativeTime` from `download-info.ts` unchanged.
- No CSP / `index.html` change: the About page introduces no new origins or inline scripts (the `/dwca` HEAD is same-origin `'self'`; all outbound links already existed in the modal).
- Accessibility: exactly one page-level `h1` in the accessible tree at a time; a visible, keyboard-focusable "Back to map" control; move focus into the About page when it opens.
</constraints>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create the &lt;about-page&gt; component and migrate the download/HEAD tests</name>
  <files>src/about-page.ts, src/about-page.test.ts</files>
  <behavior>
    - Mounting &lt;about-page&gt; renders: a single top-level `<h1>About SalishSea.io</h1>`; the intro paragraph; the four data-source `<li>`s; an `<h2>Data download</h2>` section containing the four `/dwca/salishsea-occurrences-v1.*` anchors (.zip, .zip.sha256, .parquet, .parquet.sha256) plus the DwC (`https://dwc.tdwg.org/`) and CC BY-NC (`https://creativecommons.org/licenses/by-nc/4.0/`) outbound links, both carrying `rel="noopener noreferrer"`; the feedback/funding paragraph; and a "Back to map" link as the first focusable element.
    - On first render the component fires exactly TWO HEAD requests (one ending `.zip`, one `.parquet`) via `fetchArchiveMetadata`, then renders sizes + freshness from the result.
    - The HEAD pair is cached at MODULE scope (per-session): mounting a second &lt;about-page&gt; instance (after unmount) does NOT refire — total HEAD calls stay at 2.
    - On HEAD failure (`{ ok:false }`) the `.freshness` line reads exactly "Updated nightly at 09:00 UTC." and there are zero `.downloads li small` size elements.
    - Activating "Back to map" dispatches a `close-about` CustomEvent (bubbles, composed); it does NOT itself mutate the URL (the parent owns routing).
  </behavior>
  <action>
    Create `src/about-page.ts` as a Lit element `@customElement('about-page')` exporting class `AboutPage`. Lift the About body markup out of `salish-sea.ts`'s `<dialog>` (the intro `<p>`, the `<ul>` of four sources, the full `renderDownloadSection()` output, and the feedback/funding `<p>`) into this component's `render()`. Promote the section heading to a page-level `<h1>About SalishSea.io</h1>` (sub-heading "Data download" becomes `<h2>`). Add a "Back to map" anchor as the first child: real `href="/"`, class `back`, whose `@click` calls `e.preventDefault()` then `this.dispatchEvent(new CustomEvent('close-about', { bubbles: true, composed: true }))`.

    Move the download styles (`.downloads`, `.downloads li`, `.sha-link`, `.freshness`) into this component's `static styles`; add `:host { position: fixed; inset: 0; overflow: auto; background: white; z-index: 10; padding: 1rem; }` and a `.back` style so it reads as a page, not a modal. Do NOT carry over the `dialog`/`::backdrop`/`.close-dialog` styles.

    Own `@state() private downloadInfo: DownloadInfo | null = null` and import `fetchArchiveMetadata, formatBytes, formatRelativeTime, type DownloadInfo` from `./download-info.ts` (unchanged). Add a module-level `let sessionDownloadInfo: DownloadInfo | null = null` and an exported `_clearDownloadCache()` that resets it (mirror the `_clearCredentialCache` precedent in `infra/lib/edge-handler/index.ts`) for test isolation. In `firstUpdated`: if `sessionDownloadInfo` is non-null, adopt it into `this.downloadInfo`; otherwise call `fetchArchiveMetadata()` once, store the result into BOTH `sessionDownloadInfo` and `this.downloadInfo`. This preserves the v1.2 Phase 8 "HEAD-on-open, once-per-session" behavior across the open→close→reopen lifecycle (the component unmounts on close). Reuse the existing `renderDownloadSection` logic for size/freshness formatting (null → '', ok+lastModified → `formatRelativeTime`, else → 'Updated nightly at 09:00 UTC.').

    For accessibility, in `firstUpdated` move focus to the "Back to map" link (query it from `this.renderRoot` and call `.focus()`), so keyboard/screen-reader users land on the new page.

    Register the element in `HTMLElementTagNameMap` via the standard `declare global` block.

    Create `src/about-page.test.ts` (`// @vitest-environment jsdom`) by migrating the four download/HEAD tests from `salish-sea.test.ts`, retargeted to `<about-page>`: (1) "download section renders four hrefs + dwc + cc links" — mount, mock fetch ok, await `updateComplete`, assert against `el.shadowRoot`; (2) "HEAD fires on mount: two requests, .zip and .parquet"; (3) "HEAD does not refire across remount (per-session cache)" — mount, await, remove, mount a second instance, await, assert total HEAD calls === 2; (4) "fallback on HEAD failure" — assert `.freshness` text and zero `.downloads li small`. Call `_clearDownloadCache()` in `beforeEach` AND `afterEach` so module-level cache never leaks between tests; keep the existing fetch-spy and fixture pattern (`okZip`/`okParquet`/`bad503`). No `ResizeObserver`/`showModal` stubs are needed here (no map, no dialog).
  </action>
  <verify>
    <automated>cd /Users/rainhead/dev/salishsea-io && npx vitest run src/about-page.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>about-page.test.ts passes (4 tests green), tsc clean, and `<about-page>` renders all migrated content with a single h1 and a working "Back to map" control that emits `close-about`.</done>
</task>

<task type="auto">
  <name>Task 2: Route ?about in &lt;salish-sea&gt;, remove the dialog, and trim its tests</name>
  <files>src/salish-sea.ts, src/salish-sea.test.ts</files>
  <action>
    In `src/salish-sea.ts`: add a side-effect import `import './about-page.ts';`. Remove the now-unused imports `fetchArchiveMetadata, formatBytes, formatRelativeTime, type DownloadInfo` (they moved into about-page).

    Routing (mirror the existing `o`-param idiom exactly):
    - In `parseUrlParams`, add `showAbout: searchParams.has('about')` to the returned object.
    - Add `@state() private showAbout = initialParams.showAbout;`.
    - In `#handlePopState`, add `this.showAbout = params.showAbout;` so Back/Forward toggle the page.
    - Replace the body of `onAboutClicked(e)` with: `e.preventDefault(); setQueryParams({about: '1'}); this.showAbout = true;` (pushState → a real history entry; the HEAD fetch now happens inside about-page on mount, so drop the `downloadInfo`/`fetchArchiveMetadata` call here).
    - Add `private onCloseAbout = () => { removeQueryParam('about'); this.showAbout = false; };`.

    Remove the modal: delete the entire `<dialog ${ref(this.dialogRef)}>…</dialog>` block, the `dialogRef` field, `onCloseModal`, `renderDownloadSection`, the `downloadInfo` `@state`, and the `dialog`/`dialog::backdrop`/`.close-dialog`/`.downloads`/`.sha-link`/`.freshness` style rules. Keep the `.about-link` style and the header ⓘ anchor, but set its `href="?about"` (a real, shareable target) while keeping `@click=${this.onAboutClicked}`.

    Render: add `?inert=${this.showAbout}` to both `<header>` and `<main>`. After `</main>` (still inside the host template), conditionally render `${this.showAbout ? html\`<about-page @close-about=${this.onCloseAbout}></about-page>\` : ''}`. The map (`obs-map`) stays mounted under the inert main, so position/state are preserved when returning.

    In `src/salish-sea.test.ts`: delete the four migrated download/HEAD tests and the `makeEl` `showModal` stub plumbing (no dialog anymore). Keep the three `dateFromObservedAt` tests and the `ResizeObserver` stub (still needed because instantiating `<salish-sea>` mounts `obs-map`). Add one focused routing test: create `<salish-sea>`, call `onAboutClicked(new Event('click'))`, await `updateComplete`, assert `new URLSearchParams(location.search).has('about')` is true, `(el as any).showAbout` is true, and an `<about-page>` exists in `el.shadowRoot`; then call the close handler (or dispatch `close-about`) and assert the param and element are gone. Reset `history`/`location` search in `afterEach` to avoid leaking `?about` between tests.
  </action>
  <verify>
    <automated>cd /Users/rainhead/dev/salishsea-io && npx vitest run src/salish-sea.test.ts && grep -q "about-page" src/salish-sea.ts && ! grep -q "<dialog" src/salish-sea.ts && npx tsc --noEmit</automated>
  </verify>
  <done>salish-sea.test.ts passes, the `<dialog>` is gone, `<about-page>` is wired behind `?about`, tsc is clean, and `npm run build` succeeds.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>The About modal is now a full-page view at `/?about`, driven by the existing query-param/history idiom, with the map preserved underneath and the DwC-A HEAD check firing once per session on open.</what-built>
  <how-to-verify>
    1. Run `npm run dev` and open `http://localhost:5173/`. Click the header ⓘ — the About page covers the viewport, shows the intro, the four data sources, the Data download block, and the feedback/funding paragraph; the DwC-A sizes + freshness line populate after a moment (Network tab shows exactly two HEAD requests to `/dwca/salishsea-occurrences-v1.zip` and `.parquet`).
    2. Click "Back to map" — you return to the map at its prior position. Open About again — NO new HEAD requests fire (per-session cache).
    3. **Direct-load test (the key requirement):** open a fresh tab at `http://localhost:5173/?about` and also hit Refresh while on it — the About page loads directly both times (path is `/`, so the SPA boots and reads `?about`). Copy/share that URL and confirm it opens to About.
    4. Press the browser Back button from the About page — it returns to the map; Forward reopens About.
    5. Accessibility: Tab order starts at "Back to map"; the page heading is an `<h1>`; with the About page open the map/header are not reachable by Tab (inert).
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues.</resume-signal>
</task>

</tasks>

<verification>
- `npx vitest run` — all unit tests pass (about-page.test.ts + salish-sea.test.ts + unchanged suites).
- `npx tsc --noEmit` — no type errors.
- `npm run build` — tsc + vite build + html-validate + CSP inline-hash check all pass (CSP unchanged; no new origins).
- `grep -q "about-page" src/salish-sea.ts && ! grep -q "<dialog" src/salish-sea.ts` — modal removed, page wired.
</verification>

<success_criteria>
- The About content is reachable at its own shareable URL `/?about`, works on direct load and refresh (no CloudFront/edge change), and Back/Forward toggle it.
- 100% of the prior modal content is preserved, including all four `/dwca/` links, sizes, freshness, and outbound DwC/CC links with `rel="noopener noreferrer"`.
- The DwC-A HEAD pair fires once per session on first open and never refires.
- The page has a single `h1`, a focusable "Back to map" control, and renders the underlying app inert while shown.
- The `<dialog>` modal and its dead code/styles are removed from `salish-sea.ts`.
</success_criteria>

<output>
Quick task — no SUMMARY required. Commit on approval:
`feat(about): break the About popover out into its own /?about page`
</output>
