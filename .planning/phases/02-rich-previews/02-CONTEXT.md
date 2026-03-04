# Phase 2: Rich Previews - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Add Open Graph / Twitter Card meta tags so that when links are shared in RCS, Facebook, or Bluesky, the platform's crawler bot sees a rich preview card. Because the app is a JS SPA, bots won't execute JavaScript — this requires server-side infrastructure (Lambda@Edge or CloudFront Functions) to inject meta tags dynamically per request.

Occurrence-specific URLs (`?o=<id>`) get a preview reflecting that sighting. All other URLs get a generic app preview.

</domain>

<decisions>
## Implementation Decisions

### Preview title (occurrence-specific)
- Format: `{vernacular_name} · {date}` — e.g. "Orca · June 3, 2025"
- No location in the title
- If a place name becomes available in future (reverse geocode), title can be extended to `{species} · {date} · {place}`

### Preview description (occurrence-specific)
- Format: `{count} {vernacular_name}s · {time}` — e.g. "3 Biggs orcas · 2:32 PM"
- Include time of sighting when available
- No location text anywhere in the preview

### Preview image (occurrence-specific)
- Use first photo from the occurrence **only if `license` is non-null** (cc0 or cc-by)
- Fall back to a static branded image stored in S3 if no licensed photo exists
- Dynamic map rendering (Mapbox Static API) deferred to a later phase

### Generic preview (homepage and non-occurrence URLs)
- Title: `SalishSea.io`
- Description: none
- Image: none (omit og:image)

### Branding
- Use `og:site_name` = `SalishSea.io` — some platforms show this alongside the title

### Claude's Discretion
- Choice of Lambda@Edge vs CloudFront Functions (depends on whether async Supabase fetch is needed for occurrence data; Lambda@Edge is the likely choice)
- Exact CDK construct definitions for the edge function
- How to handle occurrence lookup failures (graceful fallback to generic preview)
- Twitter Card type (`summary` vs `summary_large_image`)
- Exact static image asset design/naming

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `occurrence_photo` composite type has `src`, `thumb`, `license`, `attribution`, `mimetype` — photo URL and license are directly available from the occurrences view
- `database.types.ts` — Supabase type definitions; edge function can import/reference these for the query shape
- URL param `?o=<id>` — established in Phase 1; edge function parses this to identify occurrence-specific requests

### Established Patterns
- Supabase project ref: `grztmjpzamcxlzecmqca` — edge function needs `SUPABASE_URL` and `SUPABASE_KEY` env vars
- CDK stack at `infra/lib/infra-stack.ts` — currently empty skeleton; Phase 2 adds the CloudFront/Lambda@Edge constructs here
- S3 + CloudFront deployment — edge function attaches to the existing CloudFront distribution

### Integration Points
- CloudFront distribution (existing) — add a Lambda@Edge viewer-request or origin-request function
- S3 bucket (existing) — static branded fallback image uploaded alongside app assets
- Supabase `occurrences` view — edge function queries `id`, `taxon` (vernacular_name), `observed_at`, `photos` (for first licensed photo URL)

</code_context>

<specifics>
## Specific Ideas

- "First photo, but only if it's licensed" — license check is a hard requirement, not a nice-to-have
- Time of sighting should appear in the description when available
- Map rendering as fallback image is desired but explicitly deferred

</specifics>

<deferred>
## Deferred Ideas

- Dynamic map image as fallback — render Mapbox Static Maps API tile centered on occurrence location; deferred to a later phase
- Reverse geocode place name for title — would need geocoding API; deferred

</deferred>

---

*Phase: 02-rich-previews*
*Context gathered: 2026-03-04*
