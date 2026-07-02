# 002 — Static SPA on S3/CloudFront, with Lambda@Edge for crawler-facing behavior

**Status:** accepted · **Decided:** project inception; Lambda@Edge validated v1.0 Phase 02

## Decision

The app is a static SPA (Lit + Vite) on S3 + CloudFront with a Supabase backend. Server-side behavior is added only at the edge: a Lambda@Edge function intercepts crawler requests to serve OG meta tags for rich link previews.

## Rationale

- Static hosting: low ops overhead, fast global CDN — right-sized for a solo-maintained project.
- Crawler bots don't execute JavaScript, so rich previews require server-side rendering of meta tags. **Lambda@Edge, not CloudFront Functions:** CloudFront Functions lack `fetch()`; Lambda@Edge can look up the occurrence in Supabase per request.
- **Fail-open:** the edge function passes requests through on any error — never serve a 500 for a preview optimization.
- **`/dwca/*` carve-out at handler line 1:** binary archive downloads bypass the OG-meta interceptor.
- **SSM credentials managed outside CDK:** CDK can't create SecureStrings; the Lambda reads SSM with a module-scope cache (one call per cold start).
- **Occurrence links encode only the occurrence ID** (`?o=<id>`); date and map position derive from the occurrence on load — cleaner URLs, one source of truth.

## Rejected

- CloudFront Functions (no fetch); SSR/framework change (against the static constraint); encoding date+position in share links (duplicates what the occurrence already knows).
