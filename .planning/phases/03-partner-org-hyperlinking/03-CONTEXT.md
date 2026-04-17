# Phase 3: Partner Org Hyperlinking - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

CSV-driven pre-processing of occurrence body text to inject markdown links for known partner org names before `marked.parse` runs. No new UI, no admin interface — purely a rendering enhancement for the existing `obs-summary` component.

</domain>

<decisions>
## Implementation Decisions

### CSV data source
- **D-01:** Partner org data lives in a CSV file (`name,url` columns) inside `src/` so Vite can bundle it
- **D-02:** File must be editable by non-technical contributors without touching TypeScript

### Rendering pipeline
- **D-03:** Pre-process body text before `marked.parse` — inject markdown links for matched org names, then pass the result to the existing `marked.parse → DOMPurify.sanitize → unsafeHTML` chain
- **D-04:** Org name matching is case-insensitive

### Link behavior
- **D-05:** Partner links open in a new tab (`target="_blank" rel="noopener noreferrer"`)
- **D-06:** The `[Org Name]` bracket pattern (common in body text) must convert to `[Org Name](url)` — not `[[Org Name](url)]`
- **D-07:** Body text already containing a valid markdown hyperlink for an org must not be double-linked

### Claude's Discretion
- CSV filename and location within `src/`
- How the CSV is imported (Vite `?raw` + runtime parse, or a Vite plugin, or a build-time JSON transform)
- Matching precision: word-boundary anchoring, possessive forms (`NOAA's`), hyphenated variants
- Whether all occurrences of an org name per body are linked, or just the first
- Longest-match-first vs. list-order priority when org names overlap
- DOMPurify configuration to allowlist `target` and `rel` attributes on `<a>` tags (currently stripped by default)
- Location of the link-injection utility (new module vs. inline in `obs-summary.ts`)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — PARTNER-01 through PARTNER-06 define all acceptance criteria for this phase

### Rendering code
- `src/obs-summary.ts` — current body rendering pipeline (line 176): `marked.parse → DOMPurify.sanitize → unsafeHTML`

No external specs — requirements fully captured in decisions above and REQUIREMENTS.md.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `marked` already imported in `obs-summary.ts` — no new markdown dependency needed
- `dompurify` already imported — needs `ALLOWED_ATTR` config update to pass `target` and `rel` through
- `guard([body], ...)` pattern in `obs-summary.ts:175` — pre-processing can be applied inside this guard

### Established Patterns
- Body pre-processing already exists: `body?.replace(/(<br\s*\/?\s*>\s*)+/gi, '\n\n')` — partner link injection follows the same pattern, applied before or alongside this replace
- No CSV import precedent in the codebase — new pattern needed

### Integration Points
- `obs-summary.ts:176` — sole location where body text is rendered; this is where the pre-processing hook goes
- No backend changes needed — purely a frontend rendering concern

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-partner-org-hyperlinking*
*Context gathered: 2026-04-17*
