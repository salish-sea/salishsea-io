# Phase 3: Partner Org Hyperlinking - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 3 new/modified files
**Analogs found:** 3 / 3

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/partner-links.ts` | utility | transform | `src/identifiers.ts` | exact |
| `src/partners.csv` | config | — | `src/constants.ts` (static data) | partial |
| `src/partner-links.test.ts` | test | — | `src/obs-summary.test.ts` + `src/identifiers.test.ts` | exact |
| `src/obs-summary.ts` (modify) | component | request-response | self | — |

## Pattern Assignments

### `src/partner-links.ts` (utility, transform)

**Analog:** `src/identifiers.ts`

`identifiers.ts` is the closest analog: a pure utility module with no DOM dependency, operating on occurrence body text via regex, exporting named functions consumed by components. It follows the same role (text transform), same data flow (transform), and same invocation context (called at render time inside Lit components).

**Imports pattern** (`src/identifiers.ts` lines 1-1):
```typescript
import type { Occurrence } from "./types.ts";
```
`partner-links.ts` will add a Vite `?raw` import instead of a type import, but no other import infrastructure is needed.

**New import pattern for `?raw` CSV** (from `src/obs-map.ts` line 26 — the one `?raw` usage in the codebase):
```typescript
import olCSS from 'ol/ol.css?url';
```
The `?raw` suffix works identically. `vite-env.d.ts` line 1 already declares `/// <reference types="vite/client" />` which provides TypeScript types for both `?raw` and `?url` query suffixes — no new declarations required.

**Core transform pattern** (`src/identifiers.ts` lines 3-13):
```typescript
const ecotypeRE = /\b(srkw|southern resident|transient|biggs)\b/gi;
const detectEcotype = (text: Readonly<string>) => {
  for (const [, ecotype] of text.matchAll(ecotypeRE)) {
    switch (ecotype!.toLowerCase()) {
      case 'biggs': return 'Biggs';
      // ...
    }
  }
  return null;
}
```
Key conventions to copy:
- Regex compiled at module scope (not inside the function), not recompiled per call
- Pure functions operating on `string` with no side effects
- `gi` flags for case-insensitive global matching

`partner-links.ts` differs in that its per-org regexes must be built dynamically (names come from the CSV), so they are constructed at module load time from the parsed CSV, not as top-level literals.

**Export pattern** (`src/identifiers.ts` lines 18-27, 35-47):
```typescript
export const detectPod = (text: Readonly<string>) => { ... }
export const detectIndividuals = (text: Readonly<string>) => { ... }
```
Named exports, no default export. `partner-links.ts` exports `injectPartnerLinks` (the public API) and `partners` (the parsed CSV array, needed for test assertions against PARTNER-01).

**Module-level data init pattern** (`src/identifiers.ts` — no direct precedent; closest analog is `src/constants.ts` lines 22-31):
```typescript
export const licenseCodes = Object.freeze({ ... });
```
`partners` constant follows the same idiom: computed once at module load, exported as a named const, never mutated.

---

### `src/partners.csv` (config, static data)

**Analog:** `src/constants.ts` (static lookup data) — partial match by role; no existing CSV in the codebase.

There is no CSV precedent in `src/`. The file's role is analogous to `constants.ts`: a static lookup table edited directly as source. Key conventions:

- Lives in `src/` so Vite bundles it (same directory as all other static data: `constants.ts`, `icons.ts`)
- Header row required (`name,url`) — the parser skips it via `.slice(1)`
- No TypeScript changes needed to add an org — file is plain text

Format:
```csv
name,url
Orca Network,https://orcanetwork.org
OrcaSound,https://orcasound.net
NOAA Fisheries,https://fisheries.noaa.gov
```

---

### `src/partner-links.test.ts` (test)

**Primary analog:** `src/obs-summary.test.ts` — jsdom environment, `describe`/`it` structure, `beforeEach`/`afterEach` lifecycle.

**Secondary analog:** `src/identifiers.test.ts` — table-driven test style for text-transform utilities.

**jsdom environment declaration** (`src/obs-summary.test.ts` line 1):
```typescript
// @vitest-environment jsdom
```
Required for PARTNER-04 (DOMPurify sanitization test), which needs `window`. Place on line 1 of `partner-links.test.ts`. Tests for PARTNER-01 through PARTNER-03, PARTNER-05, and PARTNER-06 do not need jsdom but sharing the environment is harmless.

**Import pattern** (`src/obs-summary.test.ts` lines 2-3):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildShareUrl } from './obs-summary.ts';
```
For `partner-links.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { injectPartnerLinks, partners } from './partner-links.ts';
```

**Table-driven test style** (`src/identifiers.test.ts` lines 4-16):
```typescript
test('finds individual identifiers', () => {
  const table: [string, string[]][] = [
    ['[Orca Network] CRC 56 ...', ['CRC56', 'CRC356', 'CRC2356']],
    ['[Orca Network] Likely T65A5 ...', ['T65A5']],
  ];
  for (const [input, expected] of table){
    const actual = detectIndividuals(input);
    for (const id of expected) {
      expect(actual).toContain(id);
    }
  }
});
```
Each of PARTNER-01 through PARTNER-06 maps to one `it()` block. PARTNER-02, PARTNER-03, PARTNER-05, PARTNER-06 are well-suited to inline fixture tables.

**`describe` wrapper pattern** (`src/obs-summary.test.ts` line 4):
```typescript
describe('buildShareUrl', () => { ... });
```
Use `describe('injectPartnerLinks', () => { ... })` and `describe('partners CSV', () => { ... })` as the two top-level blocks.

---

### `src/obs-summary.ts` (modify — integration point)

**Analog:** self

**Current body rendering pipeline** (`src/obs-summary.ts` lines 12, 18, 175-177):
```typescript
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
// ...
const domPurify = createDOMPurify(window as any);
// ...
${guard([body], () => html`${
  unsafeHTML(domPurify.sanitize(marked.parse(body?.replace(/(<br\s*\/?\s*>\s*)+/gi, '\n\n') || '', {async: false})))
}`)}
```

**After this phase** — wrap `body?.replace(...)` with `injectPartnerLinks(...)` and add `ADD_ATTR` config to `sanitize`:
```typescript
import { injectPartnerLinks } from './partner-links.ts';
// ...
${guard([body], () => html`${
  unsafeHTML(domPurify.sanitize(
    marked.parse(
      injectPartnerLinks(body?.replace(/(<br\s*\/?\s*>\s*)+/gi, '\n\n') || ''),
      {async: false}
    ),
    { ADD_ATTR: ['target', 'rel'] }
  ))
}`)}
```

Two changes only:
1. Add `import { injectPartnerLinks } from './partner-links.ts';` at the top of the import block (lines 1-16)
2. Wrap the body string in `injectPartnerLinks(...)` and add `{ ADD_ATTR: ['target', 'rel'] }` as second arg to `sanitize`

The `guard([body], ...)` wrapper (line 175) does not change — it remains the memoization boundary, and `injectPartnerLinks` runs inside it, so it is only re-executed when `body` changes.

---

## Shared Patterns

### Module-scope constant initialization
**Source:** `src/constants.ts` lines 22-31; `src/identifiers.ts` lines 3-4
**Apply to:** `src/partner-links.ts`

Data computed once at module load is assigned to a `const` at module scope — never inside a function. No lazy initialization, no caching wrapper needed for this use case.

```typescript
// src/constants.ts pattern:
export const licenseCodes = Object.freeze({ ... });

// src/identifiers.ts pattern:
const ecotypeRE = /\b(srkw|southern resident|transient|biggs)\b/gi;
```

### Pure text-transform function signature
**Source:** `src/identifiers.ts` lines 18, 35
**Apply to:** `src/partner-links.ts` exported functions

```typescript
export const detectPod = (text: Readonly<string>) => { ... }
export const detectIndividuals = (text: Readonly<string>) => { ... }
```

Functions take a plain string, return a plain string (or derived value), have no side effects, and do not close over mutable state.

### Test file structure (jsdom + table-driven)
**Source:** `src/obs-summary.test.ts` (jsdom env + describe/it), `src/identifiers.test.ts` (table-driven fixtures)
**Apply to:** `src/partner-links.test.ts`

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
```

No `beforeAll` DOM setup is needed for `partner-links.test.ts` because `injectPartnerLinks` is pure (no DOM); only the DOMPurify test in PARTNER-04 uses jsdom. All six requirement tests can share one file with one environment declaration.

---

## No Analog Found

All three new/modified files have close analogs in the codebase. No file in this phase requires falling back to RESEARCH.md patterns alone — though RESEARCH.md's Pattern 3 (single-pass regex) and Pattern 5 (DOMPurify `ADD_ATTR`) have no codebase precedent and must be implemented fresh per those specs.

| File | Aspect with No Codebase Precedent | Source for That Aspect |
|------|------------------------------------|------------------------|
| `src/partner-links.ts` | `?raw` CSV import + runtime parse | RESEARCH.md Pattern 1 & 2 |
| `src/partner-links.ts` | Single-pass combined regex | RESEARCH.md Pattern 3 |
| `src/obs-summary.ts` | DOMPurify `ADD_ATTR` config | RESEARCH.md Pattern 5 |

---

## Metadata

**Analog search scope:** `/Users/rainhead/dev/salishsea-io/src/`
**Files scanned:** 32 (all `.ts` in `src/`)
**Pattern extraction date:** 2026-04-17
