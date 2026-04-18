# Phase 3: Partner Org Hyperlinking - Research

**Researched:** 2026-04-17
**Domain:** Text pre-processing, regex link injection, CSV import, DOMPurify configuration
**Confidence:** HIGH

## Summary

This phase inserts markdown hyperlinks for known partner org names into occurrence body text before `marked.parse` runs. The rendering pipeline is already established (`marked.parse → DOMPurify.sanitize → unsafeHTML`); this phase adds one pre-processing step before the `marked.parse` call.

The implementation consists of three pieces: (1) a CSV file in `src/` listing partner orgs, imported as a raw string via Vite's `?raw` suffix and parsed at module load time; (2) a pure utility function that takes body text and a partner list and injects markdown links using a regex that handles case-insensitivity, the `[Org Name]` bracket pattern, and double-link prevention; (3) a one-line update to `DOMPurify.sanitize` to pass `ADD_ATTR: ['target', 'rel']` so that `target="_blank"` survives sanitization.

Real occurrence body text in `occurrence-bodies.tsv` confirms the bracket pattern (`[Orca Network]`) is common in production data — the bracket handling is not an edge case, it is the primary pattern.

**Primary recommendation:** Static top-level `?raw` CSV import + pure function with a single combined regex per partner org — no Vite plugin, no build-time transform, no runtime fetch needed.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Partner org data lives in a CSV file (`name,url` columns) inside `src/` so Vite can bundle it
- **D-02:** File must be editable by non-technical contributors without touching TypeScript
- **D-03:** Pre-process body text before `marked.parse` — inject markdown links for matched org names, then pass the result to the existing `marked.parse → DOMPurify.sanitize → unsafeHTML` chain
- **D-04:** Org name matching is case-insensitive
- **D-05:** Partner links open in a new tab (`target="_blank" rel="noopener noreferrer"`)
- **D-06:** The `[Org Name]` bracket pattern must convert to `[Org Name](url)` — not `[[Org Name](url)]`
- **D-07:** Body text already containing a valid markdown hyperlink for an org must not be double-linked

### Claude's Discretion
- CSV filename and location within `src/`
- How the CSV is imported (Vite `?raw` + runtime parse, or a Vite plugin, or a build-time JSON transform)
- Matching precision: word-boundary anchoring, possessive forms (`NOAA's`), hyphenated variants
- Whether all occurrences of an org name per body are linked, or just the first
- Longest-match-first vs. list-order priority when org names overlap
- DOMPurify configuration to allowlist `target` and `rel` attributes on `<a>` tags
- Location of the link-injection utility (new module vs. inline in `obs-summary.ts`)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PARTNER-01 | Partner org names and URLs maintained in a CSV (`name,url`) editable without touching code | Vite `?raw` import of `src/partners.csv`; CSV parsed at module load; no TS changes to add a partner |
| PARTNER-02 | Partner org names render as clickable hyperlinks in occurrence body text | Regex injection before `marked.parse`; marked converts `[Name](url)` to `<a href>` |
| PARTNER-03 | Org name matching is case-insensitive | `gi` flag on per-org regex |
| PARTNER-04 | Partner links open in new tab (`target="_blank" rel="noopener noreferrer"`) | DOMPurify `ADD_ATTR: ['target', 'rel']`; verified: without this, `target` is stripped |
| PARTNER-05 | `[Org Name]` bracket pattern converts to link without double-bracket output | Single-pass regex matches `[Name]` (not followed by `(`) and replaces with `[Name](url)` |
| PARTNER-06 | Already-linked text is not double-linked | Guard check for `[Name](` pattern before any substitution; if found, skip that org |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Partner org data storage | Frontend (bundled asset) | — | CSV bundled by Vite; no backend needed |
| Link injection logic | Frontend (module utility) | — | Pure string transform; runs at render time |
| Markdown rendering | Frontend (`obs-summary.ts`) | — | `marked.parse` already there |
| HTML sanitization | Frontend (`obs-summary.ts`) | — | DOMPurify already there |

---

## Standard Stack

### Core (already installed — no new dependencies needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| marked | 17.0.5 | Markdown → HTML | Already used; converts injected `[Name](url)` syntax |
| dompurify | 3.4.0 | HTML sanitization | Already used; needs `ADD_ATTR` config update |
| vite | 8.0.8 | Build tool | Already used; `?raw` import built-in for any file type |

[VERIFIED: npm view in project] — no new packages required for this phase.

### No New Dependencies

This phase requires zero `npm install` calls. All needed libraries are already in `package.json`.

---

## Architecture Patterns

### System Architecture Diagram

```
occurrence body text (raw string)
         |
         v
[injectPartnerLinks(body, partners)]   <-- NEW pre-processing step
  - for each partner org:
      - guard: skip if [Name]( already present
      - single-pass regex: [Name] (bare) or plain Name -> [Name](url)
         |
         v
marked.parse(processedBody, {async: false})
         |
         v
domPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })   <-- config update
         |
         v
unsafeHTML(sanitizedHtml)
         |
         v
Shadow DOM (obs-summary)
  - existing `a` CSS rules apply automatically to injected links
```

### Recommended Project Structure

```
src/
├── partners.csv           # NEW: name,url CSV (editable by non-technical contributors)
├── partner-links.ts       # NEW: CSV parse + injectPartnerLinks() utility
├── obs-summary.ts         # MODIFIED: call injectPartnerLinks, update DOMPurify config
└── ...
```

Placing `partner-links.ts` as a separate module (rather than inline in `obs-summary.ts`) enables unit testing of the injection logic without a DOM environment.

### Pattern 1: Vite `?raw` Static Import for CSV

**What:** Import any text file as a string at module load time. No Vite config changes required.
**When to use:** When a text file needs to be bundled and parsed at runtime, and the data is needed synchronously (not lazy-loaded).

```typescript
// Source: https://vitejs.dev/guide/assets#importing-asset-as-string
import partnersRaw from './partners.csv?raw';
```

TypeScript type for `?raw` imports is declared via `/// <reference types="vite/client" />` already in `src/vite-env.d.ts`. [VERIFIED: vite-env.d.ts line 1 — already present]

**Note:** The geojson imports in `obs-map.ts` use dynamic `await import()` because they are lazy-loaded inside event handlers. The CSV should use a static top-level import because the partner list is needed for every body render.

### Pattern 2: CSV Parsing (No Library)

**What:** Parse a two-column CSV (no quoting, no commas in values) with a simple string split.
**When to use:** When the CSV is simple enough that a CSV library is overkill.

```typescript
// Source: verified by manual testing in this session
function parsePartnersCSV(raw: string): Array<{name: string; url: string}> {
  return raw
    .trim()
    .split('\n')
    .slice(1)                          // skip header row
    .filter(line => line.trim())       // skip blank lines
    .map(line => {
      const comma = line.indexOf(',');
      return {
        name: line.slice(0, comma).trim(),
        url: line.slice(comma + 1).trim(),
      };
    });
}
```

**Important:** Using `indexOf` for the first comma (rather than `split(',')`) is safer for URLs that might contain commas — though unlikely in practice, it matches the two-column contract exactly.

### Pattern 3: Per-Org Single-Pass Regex Injection

**What:** For each partner org, apply one regex that handles both the `[Name]` bracket pattern and plain name occurrences in a single pass, preventing double-substitution.
**When to use:** This is the core injection algorithm.

```typescript
// Source: verified by manual testing in this session
function injectOrgLink(body: string, name: string, url: string): string {
  const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // regex-escape

  // Guard: already linked — [Name]( exists anywhere (case-insensitive)
  if (new RegExp('\\[' + e + '\\]\\(', 'i').test(body)) return body;

  // Single pass: match bare [Name] (not followed by '(') OR word-boundary Name (not inside [])
  const re = new RegExp(
    '(\\[' + e + '\\](?!\\())|(?<!\\[)\\b(' + e + ')\\b(?!\\])',
    'gi'
  );
  return body.replace(re, () => '[' + name + '](' + url + ')');
}
```

**Key insight:** Running bracket replacement and plain-name replacement in the same regex pass prevents the plain-name pattern from re-matching inside already-replaced `[Name](url)` syntax.

**Link text uses the CSV name (not the matched text):** This preserves canonical brand capitalization from the CSV regardless of how the org name appears in body text (D-04 match is case-insensitive; display name is always from CSV).

### Pattern 4: Apply All Partners

```typescript
// Source: [ASSUMED] — straightforward composition of the above patterns
export function injectPartnerLinks(
  body: string,
  partners: Array<{name: string; url: string}>
): string {
  // Process longest names first to avoid short name matching inside a long name
  const sorted = [...partners].sort((a, b) => b.name.length - a.name.length);
  return sorted.reduce((text, {name, url}) => injectOrgLink(text, name, url), body);
}
```

**Longest-name-first ordering** prevents "NOAA" from matching inside "NOAA Fisheries" if both are in the CSV. [ASSUMED — discretion area from CONTEXT.md]

### Pattern 5: DOMPurify `ADD_ATTR` Configuration

**What:** Pass `ADD_ATTR: ['target', 'rel']` to `sanitize()` to preserve `target="_blank"` and `rel="noopener noreferrer"` on anchor tags.
**Why:** DOMPurify strips `target` by default. `rel` is already preserved by default but explicit inclusion is harmless.

```typescript
// Source: verified by running DOMPurify 3.4.0 in jsdom in this session
domPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
```

**Verified behavior (DOMPurify 3.4.0):**
- Without config: `target="_blank"` is stripped; `rel="noopener noreferrer"` is preserved
- With `ADD_ATTR: ['target', 'rel']`: both attributes preserved

This config update applies to the existing call at `obs-summary.ts:176`. It benefits all `<a>` tags in body text (including existing ones), not just partner links.

### Pattern 6: Integration Point in `obs-summary.ts`

Current line 176:
```typescript
unsafeHTML(domPurify.sanitize(marked.parse(body?.replace(/(<br\s*\/?\s*>\s*)+/gi, '\n\n') || '', {async: false})))
```

After this phase:
```typescript
unsafeHTML(domPurify.sanitize(
  marked.parse(
    injectPartnerLinks(
      body?.replace(/(<br\s*\/?\s*>\s*)+/gi, '\n\n') || '',
      partners
    ),
    {async: false}
  ),
  { ADD_ATTR: ['target', 'rel'] }
))
```

`partners` is a module-level constant derived from the `?raw` CSV import — computed once at module load.

### Anti-Patterns to Avoid

- **Post-HTML injection:** Never inject links into the HTML string after `marked.parse` — HTML is far harder to match safely than markdown text. Pre-process markdown only.
- **Dynamic Vite plugin / build-time JSON transform:** Adds build complexity for no benefit. `?raw` + runtime parse is simpler and gives identical results.
- **`split(',')` for CSV parsing:** If a URL ever contains a comma, `split(',')` would break. Use `indexOf(',')` for the first column boundary.
- **Modifying the DOMPurify instance globally:** Call `sanitize(html, config)` per-call rather than `addHook` or mutating the shared instance, to avoid affecting other sanitize calls.
- **Regex without word boundaries on plain name:** Without `\b`, "NOAA" would match inside "NOAAFisheries" or mid-word in some languages.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown link rendering | Custom `<a>` HTML injection | `marked.parse` (already present) | marked handles all edge cases in markdown syntax; hand-rolled HTML is harder to sanitize |
| HTML sanitization | Custom attribute filtering | DOMPurify `ADD_ATTR` config | DOMPurify handles XSS vectors beyond attribute stripping |
| CSV parsing library | Papa Parse, csv-parse | Plain string split | Two-column no-quote CSV is simple enough; a library adds bundle weight with no benefit |

---

## Common Pitfalls

### Pitfall 1: `target` Stripped by DOMPurify
**What goes wrong:** Partner links render in the same tab despite `target="_blank"` in the markdown.
**Why it happens:** DOMPurify removes `target` from `<a>` tags by default (security measure against tab-napping without `noopener`).
**How to avoid:** Pass `{ ADD_ATTR: ['target', 'rel'] }` to every `sanitize()` call.
**Warning signs:** Links open in current tab. Inspect rendered HTML — `target` attribute absent.

### Pitfall 2: Double-Bracket Output `[[Org Name](url)]`
**What goes wrong:** Body text with `[Orca Network]` becomes `[[Orca Network](https://...)]` after injection.
**Why it happens:** Naive plain-name regex matches "Orca Network" inside `[Orca Network]`, producing `[[Orca Network](url)]` which marked renders as text, not a link.
**How to avoid:** The single-pass combined regex (Pattern 3) handles this — it matches the whole `[Name]` token as a unit and replaces it with `[Name](url)`, not just the inner name.
**Warning signs:** Body text shows `[[` in rendered output; links do not render as hyperlinks.

### Pitfall 3: Double-Linking After Second Render Pass
**What goes wrong:** `injectPartnerLinks` is called twice on the same body (e.g., if `guard([body])` is somehow bypassed), injecting links into already-linked text and producing `[[Org Name](url)](url)`.
**Why it happens:** The guard checks for `[Name](` but if the whole `[Name](url)` text is passed again, re-matching occurs.
**How to avoid:** The `[Name](` guard at the top of `injectOrgLink` catches this — if already linked, skip immediately. Existing `guard([body], ...)` in Lit also prevents re-renders unless body changes.

### Pitfall 4: TypeScript Error on `?raw` Import Without Vite Client Types
**What goes wrong:** `import partnersRaw from './partners.csv?raw'` produces a TS error.
**Why it happens:** TypeScript doesn't know about Vite's `?raw` query suffix.
**How to avoid:** `/// <reference types="vite/client" />` in `src/vite-env.d.ts` already handles this — it's line 1 of that file. No additional declarations needed. [VERIFIED]

### Pitfall 5: CSV in `src/` Excluded from TypeScript `include`
**What goes wrong:** Vite bundles the CSV fine, but TypeScript complains about the import path.
**Why it happens:** `tsconfig.json` `include` is `["src", "database.types.ts"]` — this covers `src/` directory imports.
**How to avoid:** Since `partners.csv` lives in `src/` and the importing file is in `src/`, TypeScript resolves the path. No tsconfig change needed. [VERIFIED: tsconfig.json line 27]

---

## Code Examples

### Complete `partner-links.ts` Module

```typescript
// Source: patterns verified by manual testing in this session
import partnersRaw from './partners.csv?raw';

interface Partner {
  name: string;
  url: string;
}

function parsePartnersCSV(raw: string): Partner[] {
  return raw
    .trim()
    .split('\n')
    .slice(1)
    .filter(line => line.trim())
    .map(line => {
      const comma = line.indexOf(',');
      return {
        name: line.slice(0, comma).trim(),
        url: line.slice(comma + 1).trim(),
      };
    });
}

// Parsed once at module load — not re-parsed on each render
export const partners: Partner[] = parsePartnersCSV(partnersRaw);

function injectOrgLink(body: string, name: string, url: string): string {
  const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Guard: skip if already linked
  if (new RegExp('\\[' + e + '\\]\\(', 'i').test(body)) return body;

  // Single pass: bare [Name] OR word-boundary plain name
  const re = new RegExp(
    '(\\[' + e + '\\](?!\\())|(?<!\\[)\\b(' + e + ')\\b(?!\\])',
    'gi'
  );
  return body.replace(re, () => '[' + name + '](' + url + ')');
}

export function injectPartnerLinks(body: string): string {
  // Longest names first: prevents short names matching inside long names
  const sorted = [...partners].sort((a, b) => b.name.length - a.name.length);
  return sorted.reduce((text, {name, url}) => injectOrgLink(text, name, url), body);
}
```

### `partners.csv` Format

```csv
name,url
Orca Network,https://orcanetwork.org
OrcaSound,https://orcasound.net
NOAA Fisheries,https://fisheries.noaa.gov
```

Header row required. One org per line. No quoting needed unless names/URLs contain commas (avoid that).

### Updated `obs-summary.ts` Integration (line 175-177 area)

```typescript
import { injectPartnerLinks } from './partner-links.ts';

// ...inside guard([body], ...):
unsafeHTML(domPurify.sanitize(
  marked.parse(
    injectPartnerLinks(body?.replace(/(<br\s*\/?\s*>\s*)+/gi, '\n\n') || ''),
    {async: false}
  ),
  { ADD_ATTR: ['target', 'rel'] }
))
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `domPurify.sanitize(html)` | `domPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })` | This phase | `target="_blank"` preserved on partner links |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Longest-name-first ordering prevents short-name-inside-long-name matches | Pattern 4 | Low: edge case only occurs if both "NOAA" and "NOAA Fisheries" are in CSV simultaneously |
| A2 | Word-boundary `\b` is sufficient for matching (possessive forms like "OrcaSound's" not required) | Pattern 3 | Low: possessives would not match, leaving unlinked text — acceptable if not in requirements |
| A3 | All occurrences of an org name in a body (not just the first) should be linked | Pattern 3 | Low: `g` flag used; if first-only is preferred, remove `g` flag |

---

## Open Questions

1. **Possessive forms (`NOAA's`, `OrcaSound's`)**
   - What we know: `\b` word boundary does not match before `'s` — possessives would not be linked
   - What's unclear: whether contributors write possessive org names in body text
   - Recommendation: Start without possessive support (simpler regex); add if needed

2. **Link text: CSV name vs. matched text**
   - The UI-SPEC says link text uses the CSV name (preserving brand capitalization)
   - Research confirms this is the right default — the `replace` callback always uses `name` from CSV
   - No action needed; captured here for planner awareness

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — this phase is frontend code and bundled CSV only, no new CLI tools, services, or runtimes required beyond the existing Node/Vite setup).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/partner-links.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PARTNER-01 | CSV parses to `{name, url}` array | unit | `npx vitest run src/partner-links.test.ts` | Wave 0 |
| PARTNER-02 | Plain org name in body is replaced with markdown link | unit | `npx vitest run src/partner-links.test.ts` | Wave 0 |
| PARTNER-03 | Case-insensitive match (`orcaSound` matches `OrcaSound`) | unit | `npx vitest run src/partner-links.test.ts` | Wave 0 |
| PARTNER-04 | `target`/`rel` survive DOMPurify (requires jsdom env) | unit | `npx vitest run src/partner-links.test.ts` | Wave 0 |
| PARTNER-05 | `[Org Name]` bracket converts to `[Org Name](url)` not `[[Org Name](url)]` | unit | `npx vitest run src/partner-links.test.ts` | Wave 0 |
| PARTNER-06 | Already-linked text not double-linked | unit | `npx vitest run src/partner-links.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/partner-links.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/partner-links.test.ts` — unit tests covering PARTNER-01 through PARTNER-06
- [ ] `src/partners.csv` — initial CSV with at least one entry (needed for import to resolve)

*(Existing `obs-summary.test.ts` covers `buildShareUrl` only — no body rendering tests exist yet. PARTNER-04 test requires `jsdom` environment via `// @vitest-environment jsdom` comment, same pattern as existing `obs-summary.test.ts`.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | DOMPurify sanitization (already present; config update in this phase) |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via injected `<a>` href | Tampering | DOMPurify sanitizes href; only `https://` URLs from CSV (controlled input) |
| Tab-napping via `target="_blank"` | Tampering | `rel="noopener noreferrer"` in markdown template; DOMPurify `ADD_ATTR: ['rel']` preserves it |
| CSV injection (formula injection) | Tampering | CSV is a static bundled file edited by trusted contributors, not user-generated input |

**Note on CSV trust model:** The CSV is a committed source file, not a runtime upload. Contributors who can edit it can already edit TypeScript. No input validation for the CSV itself is needed.

---

## Sources

### Primary (HIGH confidence)
- `/Users/rainhead/dev/salishsea-io/src/obs-summary.ts` — verified rendering pipeline, DOMPurify usage, `guard([body])` pattern
- `/Users/rainhead/dev/salishsea-io/src/vite-env.d.ts` — confirmed `/// <reference types="vite/client" />` provides `?raw` TS types
- `/Users/rainhead/dev/salishsea-io/tsconfig.json` — confirmed `include: ["src"]` covers CSV import
- Manual DOMPurify 3.4.0 test (jsdom) — verified `target` stripped without `ADD_ATTR`, preserved with it
- Manual regex test (Node.js) — verified single-pass regex handles all three cases correctly
- `/Users/rainhead/dev/salishsea-io/occurrence-bodies.tsv` — confirmed `[Orca Network]` bracket pattern in real data
- Context7 `/vitejs/vite` — confirmed `?raw` works for arbitrary file types, no `assetsInclude` needed

### Secondary (MEDIUM confidence)
- `src/obs-map.ts` — confirmed `?raw` import pattern precedent (geojson); lazy dynamic import chosen there for lazy-loading, not required for CSV

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and verified in project
- Architecture: HIGH — rendering pipeline verified in source; regex verified by execution
- Pitfalls: HIGH — DOMPurify `target` stripping verified empirically; bracket pattern confirmed in real data

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable ecosystem — marked, DOMPurify, Vite are not fast-moving for these features)
