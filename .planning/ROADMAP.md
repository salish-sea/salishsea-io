# Roadmap: SalishSea.io — Link Shareability Milestone

## Overview

This milestone makes whale sighting observations shareable. Phase 1 delivers pure client-side occurrence link copying and deep-link hydration — a focused frontend change that produces a working shareable URL. Phase 2 delivers rich link previews for those URLs, which requires server-side meta tag injection and depends on resolving the infrastructure approach for the existing static S3/CloudFront deployment.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Occurrence Links** - Copy link button + deep-link hydration from occurrence ID
- [ ] **Phase 2: Rich Previews** - Server-side meta tag injection for rich link previews in messaging apps

## Phase Details

### Phase 1: Occurrence Links
**Goal**: Users can share a direct link to any occurrence and recipients land on the right observation
**Depends on**: Nothing (first phase)
**Requirements**: LINK-01, LINK-02, LINK-03, LINK-04
**Success Criteria** (what must be TRUE):
  1. User sees a copy link affordance on an occurrence's summary card and clicking it copies the URL to the clipboard
  2. The copied URL contains only the occurrence ID parameter (e.g. `?o=abc123`) without date or map position parameters
  3. Opening a copied occurrence link in a fresh browser tab loads the correct date for that occurrence, not the default date
  4. Opening a copied occurrence link in a fresh browser tab centers the map on that occurrence's location at an appropriate zoom level
**Plans**: 2 plans
Plans:
- [x] 01-01-PLAN.md — Add copy-link button to obs-summary with linkIcon, buildShareUrl helper, and transient copied state
- [x] 01-02-PLAN.md — Add deep-link hydration (hydrateFromOccurrenceId) to salish-sea.ts for date and map centering

### Phase 2: Rich Previews
**Goal**: Links shared in messaging apps show rich preview cards with species, date, and location context
**Depends on**: Phase 1
**Requirements**: PREV-01, PREV-02, PREV-03
**Success Criteria** (what must be TRUE):
  1. Pasting any app URL into RCS, Facebook, or Bluesky renders a preview card with title, description, and image
  2. Pasting an occurrence-specific URL renders a preview that includes the species name, sighting date, and location
  3. The preview infrastructure runs within the existing S3/CloudFront deployment (e.g. via CloudFront Function or Lambda@Edge) without requiring a separate server
**Plans**: 5 plans
Plans:
- [ ] 02-01-PLAN.md — Create test scaffolds (RED): edge handler unit tests + CDK assertion stubs
- [ ] 02-02-PLAN.md — Implement Lambda@Edge handler: bot detection, OG tag generation, Supabase fetch
- [ ] 02-03-PLAN.md — Create static branded fallback preview image (1200x630px) and upload to S3
- [ ] 02-04-PLAN.md — Wire CDK stack: CloudFront Distribution + EdgeFunction + SSM params + IAM
- [ ] 02-05-PLAN.md — Deploy: bootstrap us-east-1, add GitHub Actions secret, update deploy workflow, verify

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Occurrence Links | 2/2 | Complete | 2026-03-04 |
| 2. Rich Previews | 0/5 | Not started | - |
