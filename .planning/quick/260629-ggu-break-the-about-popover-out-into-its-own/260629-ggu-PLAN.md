---
type: quick
slug: 260629-ggu
title: Break the About popover out into its own /about.html page (Vite multi-page build)
autonomous: false
files_modified:
  - about.html                 # new — second HTML entry, served at /about.html
  - vite.config.js             # add `about` entry to build.rollupOptions.input
  - src/about-page.ts          # new <about-page> component (lifted from the dialog body)
  - src/about-page.test.ts     # new tests (migrated from salish-sea.test.ts, retargeted)
  - src/salish-sea.ts          # the i control becomes <a href="/about.html">, remove the <dialog> + dead code
  - src/salish-sea.test.ts     # drop the four download/HEAD tests, add a link/no-dialog assertion

must_haves:
  truths:
    - "Visiting /about.html by direct load, refresh, or share renders a real static About page (its own HTML object), not the SPA."
    - "about.html preserves ALL prior modal content verbatim: intro paragraph, the four data-source bullets, the DwC-A download block (4 /dwca links + sizes + freshness + DwC + CC BY-NC), and the feedback/funding paragraph."
    - "The DwC-A archive HEAD pair (.zip + .parquet) fires once on page load to populate sizes + freshness; on failure the freshness line reads 'Updated nightly at 09:00 UTC.' with no size text."
    - "about.html has a single page-level h1, an h2 'Data download' subsection (correct heading order), and a visible, keyboard-focusable 'Back to the map' link to /."
    - "The app header info control is a plain anchor href='/about.html'; the <dialog> modal and its open/close/keyboard logic are gone from salish-sea.ts."
    - "`npm run build` succeeds and emits dist/about.html (tsc + vite build + html-validate + CSP inline-hash gate all pass)."
  artifacts:
    - path: "about.html"
      provides: "Static About page shell: own title + description + Open Graph, equivalent CSP meta, inlined baseline style, mounts <about-page>"
      contains: "about-page"
    - path: "vite.config.js"
      provides: "Second build entry about: resolve(__dirname, 'about.html') in build.rollupOptions.input"
      contains: "about.html"
    - path: "src/about-page.ts"
      provides: "<about-page> full-page About view + DwC-A download section + on-load HEAD fetch + 'Back to the map' link"
      exports: ["AboutPage"]
    - path: "src/about-page.test.ts"
      provides: "Download-section DOM + on-load HEAD-fetch + fallback tests targeting <about-page>"
    - path: "src/salish-sea.ts"
      provides: "Header info control as <a href='/about.html'>; <dialog>, dialogRef, onAboutClicked, onCloseModal, renderDownloadSection, downloadInfo @state, and dialog styles all removed"
  key_links:
    - from: "about.html"
      to: "src/about-page.ts"
      via: "<script type=module src=src/about-page.ts> + <about-page> in body"
      pattern: "about-page"
    - from: "about.html"
      to: "build.rollupOptions.input.about"
      via: "Vite multi-page input emits dist/about.html as a real S3/CloudFront object"
    - from: "src/about-page.ts"
      to: "fetchArchiveMetadata (download-info.ts)"
      via: "firstUpdated calls fetchArchiveMetadata() once per page load"
      pattern: "fetchArchiveMetadata"
    - from: "src/salish-sea.ts header info link"
      to: "/about.html"
      via: "plain anchor href (real navigation, no JS handler)"
      pattern: "about.html"
---

<objective>
Replace the in-app About `<dialog>` modal with a **real, physically separate page served at `/about.html`**, built as a **Vite multi-page entry** — with ZERO infrastructure change (no CloudFront, CDK, or Lambda@Edge edits). Every piece of the existing About content moves to the new page, including the DwC-A download block and its HEAD-driven sizes/freshness.

**Chosen approach (locked decision — do not revisit):**
- Add a new `about.html` HTML entry at the project root, registered via `build.rollupOptions.input.about` in `vite.config.js` alongside the existing `index.html`. `vite build` emits it to `dist/about.html` — a real static object served directly by S3/CloudFront. Direct load / refresh / share all work because `/about.html` is a genuine object key (not a 404-to-index fallback). `npm run dev` serves it at `http://localhost:3131/about.html` automatically (Vite serves any root-level HTML entry).
- The About body becomes a small `<about-page>` Lit component (matching the project's small-component convention), lifted verbatim out of the `<dialog>` in `salish-sea.ts`. The section heading is promoted to a single page-level `<h1>`, the "Data download" sub-heading to `<h2>` (correct heading order), and a "Back to the map" link (anchor to `/`) is added.
- The DwC-A availability check simplifies: a standalone page loads fresh and mounts exactly one `<about-page>`, so the v1.2 Phase 8 "once-per-session" module cache is **unnecessary and intentionally dropped** — the component fires one HEAD pair in `firstUpdated` per page load. User-facing behavior is preserved: the four download links always render; sizes + a relative-time freshness line appear when the HEAD pair succeeds; on failure the freshness line reads "Updated nightly at 09:00 UTC." with no size text.
- The app's header info control becomes a plain semantic `<a href="/about.html">` (a real, shareable navigation), and the `<dialog>` plus all its open/close/keyboard logic and styles are deleted.

**Lambda@Edge interceptor — confirmed, no edge change required (one non-blocking caveat flagged):**
`infra/lib/edge-handler/index.ts` runs for every request. For a `/about.html` request it (a) does NOT match the `/dwca/` bypass, then (b) for any **non-bot** user-agent returns `request` untouched, so CloudFront serves the real `dist/about.html`. Humans (direct load, refresh, share-and-open) and non-listed crawlers (Googlebot is not in `BOT_AGENTS`) get the real page with its own `<title>`/OG tags. **CAVEAT (non-blocking):** a request from a *listed social-card bot* (facebookexternalhit, slackbot, twitterbot, etc.) to `/about.html` carries no `?o=`, so the handler returns the existing **generic** site-preview HTML instead of about.html's own OG tags. This is cosmetic (social cards for the About page show the generic site card), requires zero infra to ship, and does NOT affect page function. It is FLAGGED, not silently fixed — an optional future edge early-return for `/about.html` is explicitly out of scope per the zero-infra decision.

Purpose: a bookmarkable, shareable, real About page with its own static metadata — a win the SPA modal couldn't have — and no new dependency, router, or infra work.
Output: `about.html` + `<about-page>` component + a second Vite entry; the `<dialog>` is removed from `salish-sea.ts`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@src/salish-sea.ts
@src/salish-sea.test.ts
@src/download-info.ts
@index.html
@vite.config.js
@infra/lib/edge-handler/index.ts
</context>

<constraints>
- **Zero infrastructure change.** Do NOT edit CloudFront, CDK, or `infra/lib/edge-handler/index.ts`. If anything seems to require an edge change, STOP and surface it — do not plan it silently. (The interceptor has already been verified to leave `/about.html` untouched for real users; see the flagged social-bot caveat in the objective.)
- **No new routing library or framework.** This is a static multi-page build (`build.rollupOptions.input`), not client-side routing.
- **Preserve ALL existing About content verbatim.** Lift the dialog body (salish-sea.ts lines 364-377) and the entire `renderDownloadSection` (lines 456-497): the intro paragraph, the four data-source list items, the DwC/CC paragraph, the `ul.downloads` with the four `/dwca/salishsea-occurrences-v1.*` anchors (.zip, .zip.sha256, .parquet, .parquet.sha256) plus size `small`s and sha-links, the `.freshness` line, and the feedback/funding paragraph (mailto, GitHub, Beam Reach links). Keep `rel="noopener noreferrer"` on the DwC (`https://dwc.tdwg.org/`) and CC BY-NC (`https://creativecommons.org/licenses/by-nc/4.0/`) outbound links.
- **Reuse existing helpers unchanged:** import `fetchArchiveMetadata`, `formatBytes`, `formatRelativeTime`, `type DownloadInfo` from `./download-info.ts` (do not modify that file).
- **CSP / styling parity:** about.html carries its own CSP meta. Because the page only loads same-origin JS, an inline baseline style, and fires a same-origin HEAD to `/dwca/`, its CSP is a tightened subset of index.html's (no Google/Sentry/Supabase origins, no inline-script hash needed). Use these directives: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; upgrade-insecure-requests. CONFIRMED: Vite applies `%VITE_*%` HTML env substitution to every HTML entry, so the index.html `%VITE_*%` pattern would also work here — but about.html needs no external origins, so it uses no substitutions and gains no env-var coupling. (The dev-only `strip-csp-upgrade-insecure-requests-in-dev` plugin and `%VITE_*%` substitution both run for all entries, so about.html behaves consistently in dev and build.)
- **Styling approach:** match the project's recently-adopted "no render-blocking stylesheet request" intent by inlining a tiny baseline `<style>` in about.html's head (font-family + color + body reset, mirroring `src/index.css`) rather than linking `src/index.css`. This deliberately keeps about.html out of the `inline-critical-css` build plugin path (that plugin inlines then DELETES a linked CSS asset from the bundle; sharing that asset across two entries would leave the second entry's link dangling). All About-specific styling lives in `<about-page>`'s `static styles`. Net: deterministic build, no shared-asset fragility.
- **Accessibility:** exactly one page-level `<h1>`; `<h2>` for "Data download"; a visible, keyboard-focusable "Back to the map" link to `/`. Keep the project's recent a11y-labeling standard (accessible names on interactive controls).
- **Do not break the build/test gate:** `npm run build` (tsc + vite build + html-validate on `dist/**/*.html` + verify-csp-inline-hash on dist/index.html) must pass. about.html must be valid HTML under html-validate's default config (mirror index.html's head structure).
</constraints>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create the about-page Lit component and migrate its tests</name>
  <files>src/about-page.ts, src/about-page.test.ts</files>
  <behavior>
    - Mounting about-page renders, in order: a "Back to the map" link (anchor to `/`) as the first focusable element; a single `<h1>About SalishSea.io</h1>`; the intro paragraph; the "We currently show:" paragraph; the four data-source list items (iNaturalist, Whale Alert, Orca Network, HappyWhale); an `<h2>Data download</h2>` section containing the DwC/CC paragraph (both outbound links carry rel="noopener noreferrer"), the ul.downloads with the four `/dwca/salishsea-occurrences-v1.*` anchors (.zip, .zip.sha256, .parquet, .parquet.sha256), and the .freshness line; and the feedback/funding paragraph (mailto + GitHub + Beam Reach links).
    - On first render the component fires exactly TWO HEAD requests (one URL ending .zip, one ending .parquet) via fetchArchiveMetadata, then renders small sizes (when ok) plus the freshness line from the result.
    - On HEAD failure (ok:false) the .freshness line reads exactly "Updated nightly at 09:00 UTC." and there are zero `.downloads li small` size elements.
    - Heading structure is exactly one h1 and one h2 (no skipped levels), and the "Back to the map" anchor resolves to `/`.
  </behavior>
  <action>
    Create `src/about-page.ts` as a Lit element decorated `@customElement('about-page')` exporting `class AboutPage extends LitElement`. Lift the About body verbatim from salish-sea.ts's dialog (the intro paragraph, the "We currently show:" paragraph, and the ul of four list-item sources at lines 366-371) and the entire renderDownloadSection output (lines 456-497) into this component's render(). Promote the dialog's `<h3>About SalishSea.io ...</h3>` to a page-level `<h1>About SalishSea.io</h1>` (drop the modal close-link), and promote the download section's `<h4>Data download</h4>` to `<h2>Data download</h2>`. Add a "Back to the map" anchor as the first child of the template: a real anchor with class back, href="/", and visible text (for example a left-arrow plus "Back to the map") — a plain navigation link, no click handler.

    Own `@state() private downloadInfo: DownloadInfo | null = null` and import fetchArchiveMetadata, formatBytes, formatRelativeTime, and the DownloadInfo type from ./download-info.ts (unchanged). In firstUpdated, call fetchArchiveMetadata() once and assign the resolved value to this.downloadInfo. Do NOT add a module-level or per-session cache — a standalone page mounts exactly one instance per load, so the v1.2 "once-per-session" guard is unnecessary; one HEAD pair per page load is the correct, simpler behavior. Keep the size/freshness formatting logic identical to the current renderDownloadSection: downloadInfo === null gives freshness empty-string; ok with a non-null lastModified gives formatRelativeTime(lastModified); otherwise "Updated nightly at 09:00 UTC."; render a size small element only when ok and the relevant Bytes value is non-null, via formatBytes.

    Move the download styles (.downloads, .downloads li, .sha-link, .freshness) from salish-sea.ts into this component's static styles. Add page-level layout instead of modal styling: a :host rule with display block, max-width about 40rem, margin 0 auto, padding 1rem; an a rule with color #1976d2 (so links match the site palette inside shadow DOM); and a .back rule. Do NOT carry over any dialog, ::backdrop, or .close-dialog styles.

    Register the element via the standard declare-global block adding "about-page": AboutPage to HTMLElementTagNameMap.

    Create `src/about-page.test.ts` with a jsdom environment directive at the top of the file, migrating the download/HEAD tests from salish-sea.test.ts retargeted to about-page, reusing the shared fixtures (okZip, okParquet, bad503, lastModifiedHeader, a fetchSpy via vi.spyOn on globalThis.fetch, and an afterEach that restores mocks and removes any about-page from the DOM): (1) "renders four /dwca hrefs + dwc + cc links with rel" — mock fetch ok, create the element via document.createElement('about-page'), append, await el.updateComplete, settle the fetch with a zero-delay timeout promise then await el.updateComplete again, and assert four anchors matching `/dwca/salishsea-occurrences-v1(.zip|.parquet)(.sha256)?` plus the dwc and cc anchors each carrying rel="noopener noreferrer", queried from el.shadowRoot; (2) "HEAD fires on mount: two requests, .zip and .parquet" — assert exactly two HEAD calls, one URL ending .zip and one ending .parquet; (3) "fallback on HEAD failure" — mock one rejection plus one 503, assert the .freshness text equals "Updated nightly at 09:00 UTC." and there are zero `.downloads li small` elements. No per-session or remount test is needed (no module cache). No ResizeObserver or showModal stubs are needed (no map, no dialog).
  </action>
  <verify>
    <automated>cd /Users/rainhead/dev/salishsea-io && npx vitest run src/about-page.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>about-page.test.ts passes (3 tests green), tsc clean, and about-page renders all migrated content with a single h1, an h2 "Data download", and a "Back to the map" link to /.</done>
</task>

<task type="auto">
  <name>Task 2: Wire the Vite about entry + about.html shell, convert the trigger to a link, remove the dialog</name>
  <files>vite.config.js, about.html, src/salish-sea.ts, src/salish-sea.test.ts</files>
  <action>
    vite.config.js: in build.rollupOptions.input, add a second entry alongside main: about set to resolve(__dirname, 'about.html'). Leave everything else (plugins, dev server, sourcemap) untouched.

    about.html (new, project root): create a valid HTML5 document mirroring index.html's head structure so it passes html-validate's default config. The head includes: a UTF-8 charset meta; the same viewport meta as index.html; a Content-Security-Policy http-equiv meta whose content is exactly the tightened directive set named in the constraints (default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; upgrade-insecure-requests); a static title "About SalishSea.io"; a description meta for the About page; Open Graph tags (og:site_name SalishSea.io, og:type website, og:url https://salishsea.io/about.html, og:title, og:description, og:image https://salishsea.io/preview.jpg, twitter:card summary_large_image); the favicon link to src/assets/favicon.ico; and an inline style block mirroring src/index.css's :root, html/body, and a rules (font-family Mukta/Helvetica/Arial/sans-serif, color #213547, background #fff, body margin 0). The body contains an about-page element followed by a module script with src src/about-page.ts. Do NOT add a stylesheet link element (keeps about.html out of the inline-critical-css plugin path) and do NOT add the GSI script or the g_id_onload div (no login on this page).

    src/salish-sea.ts: convert the header info control to a plain link and delete the modal. Replace the header anchor so it reads class about-link, href "/about.html", title "About SalishSea.io", text the info glyph — and REMOVE the @click handler binding (it is now real navigation). Delete: the entire dialog block (lines 362-378); the dialogRef field; onAboutClicked; onCloseModal; renderDownloadSection; the downloadInfo @state field; and the now-dead style rules dialog, dialog::backdrop, .close-dialog, .downloads, .downloads li, .sha-link, .freshness. Keep the .about-link style and the `a { text-decoration: none }` rule. Remove the now-unused import of fetchArchiveMetadata, formatBytes, formatRelativeTime, and the DownloadInfo type from ./download-info.ts. Keep the createRef/ref import (still used by mapRef and panelRef). tsc will catch any surviving reference to dialogRef, downloadInfo, or renderDownloadSection.

    src/salish-sea.test.ts: delete the four download/HEAD tests, the makeEl helper and its showModal stub, the okZip/okParquet/bad503 fixtures, the fetchSpy and its beforeEach plus the fetch-related afterEach plumbing, and the DownloadInfo type import. KEEP the three dateFromObservedAt tests and the ResizeObserver global stub (instantiating salish-sea still mounts obs-map). ADD one focused test: create a salish-sea element, append it, await el.updateComplete, then assert el.shadowRoot.querySelector('a.about-link') has getAttribute('href') equal to "/about.html", and assert el.shadowRoot.querySelector('dialog') is null (modal removed). Keep an afterEach that removes any salish-sea element from the DOM.
  </action>
  <verify>
    <automated>cd /Users/rainhead/dev/salishsea-io && npx vitest run src/salish-sea.test.ts && grep -q 'about.html' src/salish-sea.ts && ! grep -q '<dialog' src/salish-sea.ts && grep -q 'about.html' vite.config.js && npm run build && test -f dist/about.html</automated>
  </verify>
  <done>salish-sea.test.ts passes, the dialog is gone, the header info control is a plain anchor to /about.html, the about entry is in vite.config.js, npm run build succeeds, and dist/about.html exists.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>The About modal is now a real, standalone page at /about.html, produced by a Vite multi-page build (second rollupOptions.input entry) with ZERO infrastructure change. The app's header info control is a plain link to it. The DwC-A HEAD check runs once on page load.</what-built>
  <how-to-verify>
    1. Run `npm run dev` and open http://localhost:3131/. Click the header info control — the browser NAVIGATES to http://localhost:3131/about.html (a real page load, URL bar changes; not an in-app overlay). The page shows the intro, the four data sources, the Data download block, and the feedback/funding paragraph. The DwC-A sizes + freshness line populate after a moment (Network tab shows exactly two HEAD requests to /dwca/salishsea-occurrences-v1.zip and .parquet; in dev these may 404 and the page should then show "Updated nightly at 09:00 UTC." with no sizes — that is the correct fallback).
    2. Direct-load + refresh + share (the key requirement): open a fresh tab directly at http://localhost:3131/about.html and press Refresh — the About page loads both times (it is a real entry, not SPA routing). Copy/share that URL and confirm it opens to About.
    3. Click "Back to the map" — the browser navigates to http://localhost:3131/ and the map loads.
    4. Accessibility: Tab order reaches the "Back to the map" link; the page has exactly one h1 ("About SalishSea.io") and the download subsection is an h2; outbound DwC and CC links open with rel="noopener noreferrer".
    5. Build parity: `npm run build` completes and `dist/about.html` exists; open `npx vite preview` and load /about.html to confirm the built page renders with its inline baseline styles and CSP meta intact.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues.</resume-signal>
</task>

</tasks>

<verification>
- `npx vitest run` — all unit tests pass (about-page.test.ts + the trimmed salish-sea.test.ts + unchanged suites).
- `npx tsc --noEmit` — no type errors (catches any dangling reference to the removed dialogRef/downloadInfo/renderDownloadSection).
- `npm run build` — tsc + vite build (two HTML entries) + html-validate on dist/index.html AND dist/about.html + verify-csp-inline-hash on dist/index.html all pass.
- `test -f dist/about.html` — the second entry is emitted as a real static object.
- `grep -q 'about.html' src/salish-sea.ts && ! grep -q '<dialog' src/salish-sea.ts` — trigger is a link, modal removed.
</verification>

<success_criteria>
- The About content is reachable at its own real, shareable URL `/about.html`, working on direct load, refresh, and share with ZERO CloudFront/CDK/edge change.
- 100% of the prior modal content is preserved verbatim, including all four /dwca links, sizes, freshness, and the outbound DwC/CC links with rel="noopener noreferrer".
- The DwC-A HEAD pair fires once on page load; on failure the page shows "Updated nightly at 09:00 UTC." with no sizes.
- The page has a single h1, an h2 download subsection, and a focusable "Back to the map" link to /.
- The header info control is a plain `<a href="/about.html">`; the `<dialog>` modal and its dead code/styles are removed from salish-sea.ts.
- The Lambda@Edge interceptor is unchanged and leaves /about.html untouched for all real users; the social-bot generic-card caveat is documented and accepted as out of scope.
</success_criteria>

<output>
Quick task — no SUMMARY required. Commit on approval:
`feat(about): break the About popover out into its own /about.html page`
</output>
