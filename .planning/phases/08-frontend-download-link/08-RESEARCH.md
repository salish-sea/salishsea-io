# Phase 8: Frontend Download Link - Research

**Researched:** 2026-06-18
**Domain:** Lit web component UI — append a "Data download" section to the existing About `<dialog>` in `src/salish-sea.ts`, fire one HEAD per archive on dialog open, render file sizes + "updated X ago" timestamp, fall back gracefully on HEAD failure.
**Confidence:** HIGH

## Summary

This phase is a single-file UI change to `src/salish-sea.ts`. CONTEXT.md has locked every meaningful design decision (placement, copy outline, links, license URL, last-updated treatment, failure fallback). The research task is to confirm the implementation mechanics: where to hang the open-detection hook, how to format a relative timestamp from a `Last-Modified` header using the existing Temporal polyfill, and what S3+CloudFront actually returns on a `HEAD /dwca/*` request.

All key facts check out: same-origin HEAD against the production CloudFront returns `Content-Length` + `Last-Modified` for `.zip`/`.parquet` (binary content-types are not in CloudFront's compression list, so the HTTP/1.1 chunked-transfer caveat does not apply); the Phase 7 L-01 carve-out already passes `/dwca/*` through unmodified for **all** request methods including HEAD; `Intl.RelativeTimeFormat` is Baseline Widely Available; the existing `onAboutClicked` handler at line 398 is the single, clean entry point for the open trigger; and the test infrastructure (Vitest + jsdom, `@vitest-environment jsdom` header) already supports DOM assertions and `vi.fn()`/`vi.spyOn` for mocking `fetch`.

**Primary recommendation:** Add a single `@state() private downloadInfo: DownloadInfo | null = null` field, augment `onAboutClicked` to fire one HEAD per archive (parallel) and populate `downloadInfo`, render the new section in the existing dialog template reading from that field, and cache the result for the session (don't re-fire on subsequent opens). One new test file `src/salish-sea.test.ts` *additions* (or a new `src/download-info.test.ts` for the pure formatter helper) covers DOM rendering + the mocked-fetch open flow + the failure-fallback branch.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Render download section in About dialog | Browser / Client (Lit component) | — | Pure UI; same component owns the dialog |
| HEAD requests for size + `Last-Modified` | Browser / Client | CDN / Static (CloudFront → S3) | Browser issues HEAD; CloudFront serves it from S3 metadata. Phase 7 L-01 carve-out is the only edge code that touches the path, and it returns immediately for `/dwca/*` |
| Relative-time formatting ("6 hours ago") | Browser / Client | — | Pure compute; uses `Intl.RelativeTimeFormat` + `temporal-polyfill` `Temporal.Now.instant()` |
| Failure observability | Browser / Client (Sentry SDK) | — | Existing `sentryClient.init()` in `src/salish-sea.ts:30`. HEAD failures auto-surface via the global Sentry integration; no new wiring needed |
| Static asset delivery (the archives themselves) | CDN / Static | Database / Storage (S3) | Out of scope for Phase 8 — Phase 7 delivers this |

## Standard Stack

### Core (already present — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `lit` | ^3.3.3 | Component framework | Already the project's component framework; new section is inline `html\`...\`` in existing `render()` |
| `lit/decorators.js` `@state` | bundled | Reactive private state for `downloadInfo` | Pattern already used at `salish-sea.ts:172` (`lastOwnOccurrence`), `:177` (`user`), `:181` (`contributor`) |
| `temporal-polyfill` | ^0.3 | Compute the `now - lastModified` duration | Already imported at `salish-sea.ts:8`; verified via `Temporal.Instant.from(occurrence.observed_at)` at `:387` and `:449` |
| `Intl.RelativeTimeFormat` | platform built-in | "updated 6 hours ago" formatting | Baseline Widely Available; no polyfill needed for ES2023 target |
| `Intl.NumberFormat` | platform built-in | "1.4 MB" file-size formatting | Same — built-in |
| `@sentry/browser` | ^10.53.1 | Failure observability | Already initialized at `salish-sea.ts:30` — uncaught/awaited rejection in the HEAD path surfaces automatically |
| `vitest` | ^4.1.7 (devDep) | Unit tests | Existing test runner |
| `jsdom` | ^29.0.2 (devDep) | DOM environment for Lit render tests | Already used in `salish-sea.test.ts`, `obs-summary.test.ts`, `partner-links.test.ts` via the `// @vitest-environment jsdom` file-level pragma |

### Supporting (none needed)

The phase introduces **zero new dependencies**.

**Important correction to CONTEXT.md:** CONTEXT.md and the research-phase prompt both refer to `@js-temporal/polyfill`. The package actually installed (per `package.json:38` and the import at `src/salish-sea.ts:8`) is `temporal-polyfill@^0.3`. `[VERIFIED: package.json + src/salish-sea.ts:8]` These are different community polyfills of the same proposal; the API surface used here (`Temporal.Now.instant()`, `Temporal.Instant.from()`, `.since()`, `.total()`) is identical between them. Plans must `import { Temporal } from "temporal-polyfill"`, not `@js-temporal/polyfill`.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline `<a>` + `@state` in `salish-sea.ts` | A new `<download-section>` Lit component | Premature; the section is ~30 lines of template, used once. CONTEXT.md "Established Patterns" explicitly: "no separate component file needed for v1; this is a small additive section, not a reusable widget." |
| `Intl.RelativeTimeFormat` + Temporal duration | A library (date-fns `formatDistanceToNow`, dayjs `relativeTime`) | New dependency for ~20 lines of code we can write with platform built-ins. Rejected. |
| `fetch(url, {method: 'HEAD'})` per archive (4 reqs) | Just two HEADs — `.zip` + `.parquet` — and infer `.sha256` size as ~64 B literal | The `.sha256` sidecars are tiny and predictable (64-char hex + newline = 65 B). Two HEADs covers the meaningful sizes; the `.sha256` rows can omit the size or use a static "(65 B)". **Recommend: only HEAD the two primary artifacts. Don't HEAD the `.sha256` sidecars.** |
| `@lit/task` for the async HEAD | Plain `@state` + `async` method | `@lit/task` is in `package.json` but it's heavier than this needs. A single `@state` flag + an `async` populator on dialog open is the established pattern (see `lastOwnOccurrence` handling in this same file). |

**No `npm install` step.** This must be reflected in the plan — no install-deps task.

## Package Legitimacy Audit

> Not applicable — phase installs zero new packages. All required APIs are either already in `package.json` or platform built-ins.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| *(none)* | — | — | — | — | — | — |

## Architecture Patterns

### System Architecture Diagram

```
User clicks (i) in header
        │
        ▼
onAboutClicked(e)  ──────────►  dialogRef.value.showModal()
        │                              │
        │                              │  (dialog visible immediately,
        │                              │   links work right away with no
        │                              │   size/timestamp text)
        ▼
[ if downloadInfo === null ]
   fetchDownloadInfo()  (async, fire-and-forget)
        │
        ├──► fetch('/dwca/salishsea-occurrences-v1.zip',     {method:'HEAD'})
        └──► fetch('/dwca/salishsea-occurrences-v1.parquet', {method:'HEAD'})
                │
                ▼
        Promise.allSettled([...])
                │
        ┌───────┴───────┐
        ▼               ▼
    all ok          any rejected / status !2xx
        │               │
        ▼               ▼
   set downloadInfo = {     set downloadInfo =
     zipBytes,                { ok: false }
     parquetBytes,            (Sentry catches the
     lastModifiedISO          rejection automatically)
   }                          │
        │                     │
        └─────────┬───────────┘
                  ▼
            Lit re-render
                  │
                  ▼
   Section template reads downloadInfo:
     • ok    → "1.4 MB · updated 6 hours ago"
     • !ok   → "Updated nightly at 09:00 UTC" (no sizes)
     • null  → render nothing for size/timestamp (links still work)
```

### Recommended Project Structure

No new files for the core change. **One** file edited:

```
src/
├── salish-sea.ts          # ONLY file modified for the UI change
└── salish-sea.test.ts     # extended with new tests (or split a download-info.test.ts)
```

**Optional split** (Claude's discretion per CONTEXT.md): if the formatter helpers grow past ~15 lines, factor them out:

```
src/
├── salish-sea.ts
├── download-info.ts        # NEW (optional) — pure helpers: formatRelativeTime, formatBytes
└── download-info.test.ts   # NEW (optional) — pure-function tests
```

Recommend the split. Co-locating the pure formatters in their own module matches the project's "Functional Transformation Pattern" (per `.planning/codebase/STRUCTURE.md`) and the testing pattern of preferring pure-function tests over DOM tests where possible.

### Pattern 1: HEAD-on-dialog-open with cached single-fetch

**What:** Fire HEAD requests the first time the dialog opens; cache the result on the component instance for the session so re-opens don't re-fetch.

**When to use:** Any sparsely-needed metadata fetch behind a user action.

**Example:**

```typescript
// Pattern from salish-sea.ts: @state field + async populator method,
// established by lastOwnOccurrence handling (line 173-238).

@state()
private downloadInfo: DownloadInfo | null = null;

onAboutClicked(e: Event) {
  e.preventDefault();
  this.dialogRef.value!.showModal();
  // Fire-and-forget; updates @state when it resolves.
  if (this.downloadInfo === null) {
    this.fetchDownloadInfo();
  }
}

private async fetchDownloadInfo(): Promise<void> {
  const base = '/dwca/salishsea-occurrences-v1';
  const results = await Promise.allSettled([
    fetch(`${base}.zip`,     { method: 'HEAD' }),
    fetch(`${base}.parquet`, { method: 'HEAD' }),
  ]);
  // Treat any rejection OR non-2xx status as failure → render fallback copy.
  const allOk = results.every(r => r.status === 'fulfilled' && r.value.ok);
  if (!allOk) {
    this.downloadInfo = { ok: false };
    return;
  }
  const [zipRes, parquetRes] = results.map(r =>
    (r as PromiseFulfilledResult<Response>).value
  );
  this.downloadInfo = {
    ok: true,
    zipBytes:     Number(zipRes!.headers.get('content-length')) || null,
    parquetBytes: Number(parquetRes!.headers.get('content-length')) || null,
    // Last-Modified parses cleanly with new Date() — RFC 7231 IMF-fixdate
    // (e.g., "Wed, 18 Jun 2026 09:02:00 GMT") is one of the two formats
    // new Date(string) reliably handles cross-engine.
    lastModified: zipRes!.headers.get('last-modified'),
  };
}
```

`[VERIFIED: pattern matches existing code at src/salish-sea.ts:173, :220-238 — @state field populated by async work in a handler]`

### Pattern 2: Relative-time formatting with Temporal + Intl.RelativeTimeFormat

**What:** Compute the duration from a `Last-Modified` header to "now", then pick the largest meaningful unit and feed it to `Intl.RelativeTimeFormat`.

**When to use:** Anywhere "updated X ago" is rendered.

**Example:**

```typescript
// src/download-info.ts (or inline in salish-sea.ts)
import { Temporal } from "temporal-polyfill";

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * Format a Last-Modified HTTP header value as a relative time string,
 * or as an absolute ISO date once the gap exceeds the threshold.
 */
export function formatRelativeTime(
  lastModifiedHeader: string,
  now: Temporal.Instant = Temporal.Now.instant(),
  absoluteAfterDays: number = 7,
): string {
  // RFC 7231 IMF-fixdate parses cleanly with new Date().
  const lmMs = Date.parse(lastModifiedHeader);
  if (Number.isNaN(lmMs)) return ''; // tolerate odd header

  const lm = Temporal.Instant.fromEpochMilliseconds(lmMs);
  const diff = lm.since(now); // negative duration; .total() handles sign
  const hoursAgo = -diff.total('hours');

  if (hoursAgo > 24 * absoluteAfterDays) {
    // Fall back to absolute date once stale enough that "N days ago" feels soft-alarming.
    return `updated ${lm.toZonedDateTimeISO('UTC').toPlainDate().toString()}`;
  }
  if (hoursAgo >= 24) {
    return `updated ${RTF.format(-Math.round(hoursAgo / 24), 'day')}`;
  }
  if (hoursAgo >= 1) {
    return `updated ${RTF.format(-Math.round(hoursAgo), 'hour')}`;
  }
  const minutesAgo = -diff.total('minutes');
  return `updated ${RTF.format(-Math.round(Math.max(minutesAgo, 1)), 'minute')}`;
}
```

`[VERIFIED: MDN — Intl.RelativeTimeFormat https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat]`
`[VERIFIED: Temporal API — Temporal.Instant.since() returns Temporal.Duration; .total(unit) returns Number]`

Notes:
- `numeric: 'auto'` produces "yesterday" / "1 hour ago" / "2 days ago" naturally; without it you get "1 day ago" everywhere.
- The component re-renders the dialog body each time it opens; we don't try to keep "6 hours ago" ticking. CONTEXT.md explicitly accepts this for v1.

### Pattern 3: File-size formatting

```typescript
const SIZE_FMT = new Intl.NumberFormat('en', {
  notation: 'standard',
  maximumFractionDigits: 1,
});

/** "1.4 MB", "65 B", "812 KB". Binary IEC-ish, decimal-presented (1 KB = 1024 B). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024)                  return `${bytes} B`;
  if (bytes < 1024 * 1024)           return `${SIZE_FMT.format(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024)    return `${SIZE_FMT.format(bytes / (1024 * 1024))} MB`;
  return `${SIZE_FMT.format(bytes / (1024 * 1024 * 1024))} GB`;
}
```

Recommend KB/MB thresholds at 1024^n (binary boundary, decimal display). `dwc.occurrences` row count is in the low hundreds of thousands (per CONTEXT 07 §"G-02"), so the `.zip` is comfortably in the MB range and the `.parquet` ~4.3× smaller (per REQUIREMENTS spike note).

### Anti-Patterns to Avoid

- **Firing HEAD on `firstUpdated()` or in `constructor`** — CONTEXT.md D-04 explicitly forbids this. Opens are rare and user-initiated; we want zero cost on initial page load.
- **Rendering size/timestamp skeletons before HEAD resolves** — CONTEXT.md D-12 says "hide file sizes silently on the same failure path (don't render placeholders or skeletons)". Extend this principle to the in-flight state: render nothing for sizes until they exist; the links always work.
- **Building a `<download-section>` component for one-time use** — Inline in `salish-sea.ts` per CONTEXT.md.
- **Re-fetching on every open** — Cache `downloadInfo` for the session. Browser HTTP cache may also catch it, but explicit caching avoids re-running the populator after a failure (where we'd otherwise spam Sentry on every open).
- **Using `Date.now()` and manual arithmetic** for the relative-time math — the codebase has standardized on Temporal (`salish-sea.ts:8` import, two existing usages).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Relative-time strings ("6 hours ago") | A switch statement against custom thresholds | `Intl.RelativeTimeFormat` | Built-in, i18n-correct, Baseline Widely Available |
| File-size strings ("1.4 MB") | A manual `toFixed(1)` chain | `Intl.NumberFormat` for the number part | Locale-correct decimal separator; trivial code reduction |
| RFC 7231 date parsing | A regex | `new Date(headerValue)` then `Temporal.Instant.fromEpochMilliseconds()` | `new Date()` handles RFC 7231 IMF-fixdate by spec |
| HEAD-request retry/dedupe | Custom request cache | Single fire-and-forget + in-component `@state` cache | One request per session; nothing to dedupe |
| HEAD error surfacing | `try/catch` + manual `Sentry.captureException` | Existing `sentryClient.init()` global handler (already wired) | The Sentry SDK already catches unhandled rejections and console errors; don't add bespoke wiring |

**Key insight:** Every API needed for this phase is already in the runtime or already in `package.json`. Plans should treat any "let's add a library" instinct as a smell.

## Common Pitfalls

### Pitfall 1: CloudFront stripping `Content-Length` on HTTP/1.1 + chunked transfer

**What goes wrong:** CloudFront switches to `Transfer-Encoding: chunked` and omits `Content-Length` when it compresses on the fly (HTTP/1.1) or when serving HTTP/2-compressed content. If we read a missing `Content-Length`, our `Number(null) → 0` would render "0 B".
**Why it happens:** CloudFront's compression behavior, documented at `docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorS3Origin.html`. `[VERIFIED: AWS docs + repost.aws community confirmation]`
**Why we're safe:** CloudFront only compresses a fixed allow-list of `Content-Type` values (mostly text-based — HTML, CSS, JS, JSON, SVG, plain text). `.zip` (`application/zip` or `application/octet-stream`) and `.parquet` (`application/octet-stream` by default from `aws s3 cp` without `--content-type`) are **not** on the list. `[VERIFIED: docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html — "CloudFront compresses files only if the Content-Type is on the list"]`
**How to avoid (defensive):** In the HEAD handler, treat a missing/falsy `Content-Length` as "size unavailable" — render the link without a size rather than rendering "0 B". The code sketch above (`Number(...) || null`) already does this.
**Warning signs:** A "0 B" size in the rendered UI. The plan's manual-verify task should include "confirm sizes render with sensible MB values on production".

### Pitfall 2: `Last-Modified` header may be the original S3 upload time, not the "regeneration" time

**What goes wrong:** If Phase 7's atomic publish ever switches to a copy-then-rename pattern that preserves the source object's mtime (e.g., `aws s3 cp --metadata-directive COPY`), the displayed timestamp could drift from the actual regen time.
**Why it doesn't apply here:** Phase 7's publish does `aws s3 cp` of a freshly-built local file, so the S3 object's `Last-Modified` IS the upload time (which is ~seconds after regen). `[CITED: 07-CONTEXT.md §P-01/P-02 — direct upload, no staging copy]`
**How to avoid:** Document the assumption in a code comment. If Phase 7's publish strategy changes, this UI surfaces it as a stale relative-time — visible but not broken.

### Pitfall 3: CSP `connect-src` blocking the HEAD

**What goes wrong:** Strict CSP could refuse the HEAD as a cross-origin connect.
**Why we're safe:** `index.html:12` declares `connect-src 'self' %VITE_SUPABASE_URL% %VITE_SUPABASE_WS_URL% https://accounts.google.com https://o4509634382331904.ingest.us.sentry.io`. The site is served from `salishsea.io`; `/dwca/*` is served from the same origin (`salishsea.io/dwca/…` per Phase 7 §C-04). HEAD to a same-origin URL is allowed by `'self'`. No CSP edit required. `[VERIFIED: index.html:12 + 07-CONTEXT.md §C-04]`
**Note on outbound anchor links:** `https://dwc.tdwg.org/` and `https://creativecommons.org/licenses/by-nc/4.0/` are pure `<a>` navigations (user click → top-level nav). They do **not** consume `connect-src` or `frame-src`. They don't need to be on any CSP list. `[VERIFIED: CSP spec — navigation requests use navigation directives (form-action, navigate-to) and plain anchor click is unrestricted by default]`

### Pitfall 4: Lambda@Edge intercepting the HEAD on a bot-classified UA

**What goes wrong:** If the OG-meta Lambda's bot-UA branch ran on `/dwca/*` HEAD requests, it would synthesize HTML and break the size/timestamp display for any user agent on the bot list.
**Why we're safe:** Phase 7 Plan 07-02 shipped the L-01 carve-out at `infra/lib/edge-handler/index.ts:101-103`:
```ts
if (request.uri.startsWith('/dwca/')) {
  return request;
}
```
This early-return runs **before** the bot-UA check (the carve-out is the first conditional in `handler`) AND it is method-agnostic — `request.uri` is the same for HEAD or GET, and we don't inspect `request.method`. HEAD passes through to S3 unmodified. `[VERIFIED: infra/lib/edge-handler/index.ts:94-103 read in this session]`
**Note:** Browser UAs (Chrome, Firefox, Safari) are not on the bot list anyway, but the carve-out makes this robust against future UA-list expansions and against any future server-side rendering path that might use a non-browser UA.

### Pitfall 5: Re-firing HEAD on every dialog open

**What goes wrong:** User opens → closes → reopens repeatedly; each open fires 2 new HEADs, spamming the network and (on failure) Sentry.
**How to avoid:** The recommended pattern in Pattern 1 above checks `this.downloadInfo === null` before firing. **Session-cache the result** (both success and failure). Per CONTEXT.md, this is one of three acceptable strategies; this one is the simplest and matches the established `@state`-flipped-once pattern. The trade-off: if the user opens the dialog at 09:01 UTC and a regen lands at 09:02 UTC, they'd need to refresh the page to see the new timestamp. Acceptable — the regen cadence is nightly, not minutely.

### Pitfall 6: HEAD response browser cache returning stale `Last-Modified`

**What goes wrong:** Browser caches the HEAD response; user gets yesterday's `Last-Modified` from cache.
**Why this is fine:** The cached HEAD's `Last-Modified` IS the correct value for the cached representation. If the browser cache is fresh enough that it doesn't revalidate, the GET would also serve the same cached representation. The user sees consistent state. CONTEXT.md acknowledges this explicitly under "Pitfalls to call out for the planner".
**Mitigation if needed:** Append a cache-buster query param to the HEAD (e.g., `?_=${Date.now()}`). **Don't do this for v1** — it bypasses CloudFront's edge cache and costs origin traffic; the staleness window is minutes at most and the UI is informational.

### Pitfall 7: jsdom not implementing `<dialog>.showModal()`

**What goes wrong:** jsdom historically did not implement the `<dialog>` element's `showModal()`/`close()` methods, throwing on call.
**Status:** jsdom added support for `<dialog>` in v22 (2023). The project's `jsdom@^29.0.2` includes it. The plan's tests should either (a) test the formatters as pure functions (no DOM), or (b) test rendered DOM by invoking the handler and reading the dialog's content via `dialogRef`. If (b), assert against `salishSea.dialogRef.value.innerHTML` or query the rendered template; don't rely on `.open` visibility. `[ASSUMED: based on jsdom v22 release notes — needs verification at test-write time, but jsdom 29 is well past that release]`

## Runtime State Inventory

> This is not a rename/refactor phase. Section omitted.

## Code Examples

### Existing reference: `@state` field populated by async work in a handler

```typescript
// src/salish-sea.ts:173 + :231-234 — the established pattern this phase mirrors
@state()
private lastOwnOccurrence: Occurrence | null = null;

// ...inside an onAuthStateChange handler:
getContributor(this.user.id, supabaseClient)
  .then(contributor => this.contributor = contributor)
  .then(contributor => fetchLastOwnOccurrence(contributor, supabaseClient))
  .then(occurrence => this.lastOwnOccurrence = occurrence);
```

`[VERIFIED: src/salish-sea.ts:173, :231-234]`

### Existing reference: dialog open handler

```typescript
// src/salish-sea.ts:398-401 — the handler the new HEAD trigger augments
onAboutClicked(e: Event) {
  e.preventDefault();
  this.dialogRef.value!.showModal();
}
```

`[VERIFIED: src/salish-sea.ts:398-401]`

### Existing reference: Temporal usage in this file

```typescript
// src/salish-sea.ts:8
import { Temporal } from "temporal-polyfill";

// src/salish-sea.ts:387 (within focusOccurrence)
this.date = Temporal.Instant.from(occurrence.observed_at)
  .toZonedDateTimeISO('PST8PDT').toPlainDate().toString();

// src/salish-sea.ts:449 (within dateFromObservedAt — pure helper, exported, tested)
export function dateFromObservedAt(observedAt: string): string {
  return Temporal.Instant.from(observedAt)
    .toZonedDateTimeISO('PST8PDT')
    .toPlainDate()
    .toString();
}
```

`[VERIFIED: src/salish-sea.ts:8, :387, :449]`

### Existing reference: test pattern for a pure exported helper from `salish-sea.ts`

```typescript
// src/salish-sea.test.ts
// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { dateFromObservedAt } from './salish-sea.ts';

test('dateFromObservedAt: UTC midnight in PST8PDT is still the same calendar day', () => {
  expect(dateFromObservedAt('2024-07-15T18:23:00Z')).toBe('2024-07-15');
});
```

The new formatters (`formatRelativeTime`, `formatBytes`) follow the same export-and-test pattern. `[VERIFIED: src/salish-sea.test.ts in this session]`

### New: complete sketch of the rendered section

```typescript
// Inside render(), between the existing data-sources <ul> and the closing <p>:
${this.renderDownloadSection()}

// New method on the class:
private renderDownloadSection(): unknown {
  const info = this.downloadInfo;
  const base = '/dwca/salishsea-occurrences-v1';
  return html`
    <h4>Data download</h4>
    <p>
      The full observation dataset is published nightly as a
      <a href="https://dwc.tdwg.org/" target="_blank" rel="noopener noreferrer">Darwin Core Archive</a>,
      with a GeoParquet sidecar for spatial tools. Native SalishSea.io observations
      and Maplify / Whale Alert sightings (including Orca Network and Cascadia)
      are included; iNaturalist and Happywhale are excluded — those are already
      published to GBIF by their canonical sources. Licensed
      <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC 4.0</a>.
    </p>
    <ul class="downloads">
      <li>
        <a href="${base}.zip" download>salishsea-occurrences-v1.zip</a>
        ${info?.ok && info.zipBytes != null ? html` <small>${formatBytes(info.zipBytes)}</small>` : ''}
        <a href="${base}.zip.sha256" download class="sha-link">sha256</a>
      </li>
      <li>
        <a href="${base}.parquet" download>salishsea-occurrences-v1.parquet</a>
        ${info?.ok && info.parquetBytes != null ? html` <small>${formatBytes(info.parquetBytes)}</small>` : ''}
        <a href="${base}.parquet.sha256" download class="sha-link">sha256</a>
      </li>
    </ul>
    <p class="freshness">
      ${info === null ? '' :
        info.ok && info.lastModified ? formatRelativeTime(info.lastModified)
        : 'Updated nightly at 09:00 UTC.'}
    </p>
  `;
}
```

Note the `<a ... download>` attribute on the primary anchors. CONTEXT.md (research-phase prompt §9) asked us to recommend this — yes, use it. It causes the browser to download with the canonical filename rather than rendering inline or saving with whatever the user has navigated. `[CITED: HTML spec — the `download` attribute hints download intent and preserves the filename]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Moment.js `fromNow()` | `Intl.RelativeTimeFormat` + Temporal `.since().total()` | RTF baseline (2020); Temporal Stage 3 proposal mature | Drop a 60-100 KB dep for a built-in |
| Hand-rolled `formatBytes(n)` | `Intl.NumberFormat` for the number, manual unit suffix | Always available; just less common to remember | Locale-correct decimal separator with no dep |
| `<button onclick>showModal()</button>` | Native `<dialog>` element + `dialogRef.value.showModal()` | Baseline ~2023; already in use in this file | n/a — already adopted here |

**Deprecated/outdated:**
- `XMLHttpRequest` HEAD — use `fetch(url, {method:'HEAD'})`. Project already uses `fetch` throughout (e.g., `loadGSI()` at `salish-sea.ts:66`).

## Assumptions Log

> Claims tagged `[ASSUMED]` in this research that warrant explicit confirmation before being locked.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | jsdom 29's `<dialog>` implementation includes a working `showModal()` for tests that exercise it | Pitfall 7 | If wrong, DOM tests that trigger `onAboutClicked` need a stub. Mitigation: split formatters into pure helpers in `download-info.ts` and test those at unit level; keep the DOM test minimal (assert rendered section innerHTML after manually invoking `renderDownloadSection` or after setting `downloadInfo` directly and awaiting `updateComplete`). |
| A2 | Phase 7's `aws s3 cp` does not set a custom `Content-Type` for `.parquet` and `.zip` — relies on extension-inferred default | Pitfall 1 | If Phase 7 set a content-type that's on CloudFront's compression list (it isn't: `application/zip`, `application/octet-stream`, `application/vnd.apache.parquet` are not on it), `Content-Length` could be missing. Defensive code already handles missing `Content-Length` by hiding the size. |
| A3 | `Promise.allSettled` + `result.status === 'fulfilled'` discrimination is supported under the project's ES2023 target | Pattern 1 | `Promise.allSettled` is ES2020; well within ES2023. Safe — listed for completeness only. |
| A4 | The `download` attribute is honored on same-origin anchors by all evergreen browsers | renderDownloadSection sketch | If a browser refuses (mostly an issue cross-origin), the link still downloads — the user just gets a default filename. Low risk. |

## Open Questions

1. **Should the .sha256 sidecars get their sizes too?** Recommendation: no. They're a predictable 65 bytes. Skip the HEAD; either omit the size or render "(sha256)" as a static label. Saves 2 HEAD requests per dialog open.
   - What we know: `.sha256` files are 64 hex chars + newline = 65 B.
   - What's unclear: whether the planner wants visual parity (sizes for every link).
   - Recommendation: omit `.sha256` size; render as a small "verify" link beside the primary artifact (per CONTEXT.md D-03 "rendered as small 'verify' affordances").

2. **Heading wording** ("Data download" vs "Download dataset" vs "DarwinCore Archive"). CONTEXT.md leaves this to discretion. Recommendation: **"Data download"** — matches the ROADMAP success-criterion phrasing ("Data download / DwC-A link"), feels natural in the modal's prose register, and doesn't over-emphasize the format.

3. **Should we drop a `dwca` element from `.gitignore` for the test fixture?** Not needed — tests mock fetch responses rather than touching real archive files.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | local build + test | ✓ | 24.13 (`.nvmrc`) | — |
| `temporal-polyfill` | relative-time helper | ✓ | 0.3 (`package.json:38`) | — |
| `lit` | component framework | ✓ | 3.3.3 (`package.json:35`) | — |
| `vitest` | tests | ✓ | 4.1.7 (`package.json:68`) | — |
| `jsdom` | DOM test env | ✓ | 29.0.2 (`package.json:61`) | — |
| `Intl.RelativeTimeFormat` | relative-time formatting at runtime | ✓ | Baseline Widely Available | — |
| `Intl.NumberFormat` | bytes formatting at runtime | ✓ | Baseline Widely Available | — |
| Production `/dwca/*` URL | manual verification post-deploy | ✓ | Phase 7 shipped | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 |
| Config file | `vitest.config.ts` (excludes `e2e/**`, `infra/**`, `node_modules/**`) |
| Quick run command | `npm test -- src/salish-sea.test.ts src/download-info.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DOWNLOAD-01 | Section renders four links with correct hrefs (zip + parquet + 2× .sha256) and inline CC-BY-NC + dwc.tdwg.org links | unit (DOM) | `npm test -- src/salish-sea.test.ts -t "download section renders"` | ❌ Wave 0 |
| DOWNLOAD-01 | `formatBytes` returns "1.4 MB", "65 B", etc. at expected thresholds | unit (pure) | `npm test -- src/download-info.test.ts -t formatBytes` | ❌ Wave 0 |
| DOWNLOAD-01 | `formatRelativeTime` returns "updated 6 hours ago" for a header 6h ago; falls back to absolute past 7-day cutoff | unit (pure, time-injected) | `npm test -- src/download-info.test.ts -t formatRelativeTime` | ❌ Wave 0 |
| DOWNLOAD-01 | On `onAboutClicked` first call, two HEADs fire to `/dwca/salishsea-occurrences-v1.{zip,parquet}` | unit (vi.spyOn(globalThis, 'fetch')) | `npm test -- src/salish-sea.test.ts -t "HEAD fires on open"` | ❌ Wave 0 |
| DOWNLOAD-01 | On second open, no additional HEADs fire (session cache) | unit (vi.spyOn) | `npm test -- src/salish-sea.test.ts -t "HEAD does not refire"` | ❌ Wave 0 |
| DOWNLOAD-01 | On HEAD rejection / non-ok response, fallback copy renders and no sizes shown | unit (vi.spyOn with mocked rejection) | `npm test -- src/salish-sea.test.ts -t "fallback on HEAD failure"` | ❌ Wave 0 |
| DOWNLOAD-01 | Manual: production deploy — open About modal, click each link, confirm sizes + "updated X ago" render, confirm `.zip` downloads with stable filename | manual-only | (post-deploy) | n/a |

### Sampling Rate
- **Per task commit:** `npm test -- src/salish-sea.test.ts src/download-info.test.ts` (~few seconds)
- **Per wave merge:** `npm test` (full suite — already runs all `src/*.test.ts`)
- **Phase gate:** Full suite green; manual post-deploy verification on production salishsea.io with the About modal opened and the link clicked.

### Wave 0 Gaps
- [ ] `src/download-info.ts` — pure helpers (`formatBytes`, `formatRelativeTime`)
- [ ] `src/download-info.test.ts` — pure-function tests covering threshold boundaries (KB↔MB, hour↔day↔week, the 7-day absolute fallback) with an injected `now` so tests aren't time-dependent
- [ ] New tests appended to `src/salish-sea.test.ts` covering: DOM render assertion, HEAD-fires-on-open, HEAD-doesn't-refire, fallback-on-failure
- [ ] No new framework/config installs needed

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Public download; no auth surface |
| V3 Session Management | no | Read-only static asset |
| V4 Access Control | no | Public archive by policy (CC-BY-NC 4.0) |
| V5 Input Validation | yes (minimal) | `Number(...)` coercion on `Content-Length`; tolerate missing/malformed `Last-Modified`. Both handled in the code sketch. |
| V6 Cryptography | no (consumer side) | We link to the `.sha256` sidecar; we don't verify in the browser. Verification is a user-side action with `sha256sum`. |
| V14 Configuration | yes | CSP `connect-src 'self'` already permits the HEAD — no widening needed. Outbound anchors to `dwc.tdwg.org` and `creativecommons.org` must use `target="_blank" rel="noopener noreferrer"` per the existing pattern in `index.html` and the partner-links test (`partner-links.test.ts:53`). |

### Known Threat Patterns for Lit-on-CloudFront

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Reverse-tabnabbing via `target="_blank"` outbound link | Tampering | `rel="noopener noreferrer"` on every outbound anchor (already a project convention — see `partner-links.test.ts:53`). The new `<a>`s to `dwc.tdwg.org` and `creativecommons.org` MUST include it. |
| User-controlled HTML in rendered template | Tampering | None of the rendered content is user-supplied. The `Last-Modified` and `Content-Length` values pass through `formatRelativeTime` / `formatBytes` which produce plain strings; Lit auto-escapes template-literal expressions by default. Safe. |
| XSS via Lit template | Tampering | Lit's `html\`\`` template interpolation auto-escapes string values; only `unsafeHTML` / `unsafeStatic` directives bypass escaping. We don't use them. Safe. |

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` does not exist in the project root; only the user-global `~/.claude/CLAUDE.md` applies. The applicable directives from there:

- **Trust:** This codebase under `~/dev` is trusted — no special verification gates beyond what GSD already imposes.
- **Documentation freshness before push:** READMEs must stay concise and link to source rather than duplicating volatile data. The phase doesn't add a README; if it adds anything documentation-adjacent, link to `src/salish-sea.ts` rather than duplicating the markup.
- **Node version:** `.nvmrc` pins Node 24.13; SessionStart hook handles `nvm use`. No plan task should `nvm use` explicitly.
- **Deployment safety (project memory):** **Pushes to `main` auto-deploy to production via `.github/workflows/deploy.yml`**. The phase ships via a normal merge to `main`. **No new GH Actions vars or secrets are required** (the phase consumes no env vars at build or runtime beyond what's already present). The plan does NOT need a "tell user, await confirmation" gate before push.
- **CSP hash discipline:** `index.html` carries an inline-script CSP hash verified by `bin/verify-csp-inline-hash.mjs` as part of `npm run build`. **The phase does not modify the inline GSI init script** in `index.html`, so the hash should not change. If a plan task does end up touching that script (it shouldn't), the build will fail and `npm run verify-csp` regenerates the hash.

## Sources

### Primary (HIGH confidence — read in this session)
- `src/salish-sea.ts` — root Lit component, About dialog, `onAboutClicked` handler, Temporal usage
- `src/salish-sea.test.ts` — existing test pattern for exported helpers from this module
- `src/obs-summary.test.ts` — `Object.defineProperty(window, 'location', ...)` jsdom stubbing pattern
- `src/partner-links.test.ts` — DOM/marked/DOMPurify test pattern + `target="_blank" rel="noopener noreferrer"` convention
- `index.html` — CSP `connect-src 'self' ...` confirmed permits same-origin HEAD
- `package.json` — confirmed `temporal-polyfill@^0.3`, no `@js-temporal/polyfill`; confirmed Vitest 4.1.7 + jsdom 29.0.2; confirmed no need to install anything
- `vitest.config.ts` — confirmed test runner config; no per-file env override beyond `// @vitest-environment jsdom` header
- `infra/lib/edge-handler/index.ts` — confirmed L-01 carve-out is the first conditional in `handler` and is method-agnostic
- `.planning/phases/07-nightly-workflow-hosting/07-CONTEXT.md` — Phase 7 publish strategy, filenames, URL prefix
- `.planning/phases/08-frontend-download-link/08-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md` — DOWNLOAD-01 requirement statement
- `.planning/ROADMAP.md` — Phase 8 goal + success criteria
- `.planning/codebase/{STACK,CONVENTIONS,TESTING,STRUCTURE}.md` — project conventions

### Secondary (MEDIUM confidence)
- [MDN: Intl.RelativeTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat) — API surface + Baseline status
- [AWS docs: Request and response behavior for Amazon S3 origins (CloudFront)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorS3Origin.html) — confirms `Last-Modified` + `ETag` pass-through and HTTP/1.1 chunked-transfer caveat
- [AWS docs: Serve compressed files (CloudFront)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ServingCompressedFiles.html) — confirms compression only applies to a fixed allow-list of Content-Types; `.zip`/`.parquet` excluded
- [AWS docs: HeadObject (Amazon S3)](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html) — confirms HEAD returns the same metadata as GET, no body
- [web.dev: Intl.DurationFormat is now Baseline Newly available](https://web.dev/blog/intl-durationformat-baseline) — confirms Intl.RelativeTimeFormat reached Baseline Widely Available earlier

### Tertiary (LOW confidence — verify at write time)
- jsdom 29's `<dialog>.showModal()` implementation completeness (Pitfall 7 / Assumption A1) — verify when writing the DOM test; mitigation already specified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency is already in package.json or is a platform built-in; no install action needed
- Architecture: HIGH — directly mirrors an existing `@state`-populated-by-handler pattern in the same file
- Pitfalls: HIGH — CSP, CloudFront behavior, and L-01 carve-out all verified against source files read in this session
- Validation: HIGH — Vitest+jsdom infrastructure already in place; the test commands shown will work without setup

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (30 days — stable surface; the only invalidator would be a CloudFront/CSP/Lambda@Edge change, all of which are well outside this phase's scope)
