# SalishSea.io

## What This Is

SalishSea.io is a whale sighting platform for the Salish Sea area serving two distinct audiences: sighters who want to share observations in the moment, and researchers (or the same people in a different mode) who want access to a reliable, comprehensive historical record of cetacean observations. The app presents an interactive map of dated sightings, allows authenticated users to log new observations with photos and location data, and links observations into travel segments by species.

## Core Value

The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.

## Requirements

### Validated

- ✓ User can log a whale sighting with species, location, time, and photos — existing
- ✓ User can view an interactive map of sightings for a selected date — existing
- ✓ User can sign in with Google to submit and edit sightings — existing
- ✓ App preserves map position, selected date, and focused occurrence in URL — existing
- ✓ User can edit their own sightings — existing

### Active

<!-- Current scope: Link shareability milestone -->

- [ ] User can copy a shareable link to a specific occurrence from its summary card
- [ ] Following an occurrence link sets the date and map view from that occurrence (not defaults)
- [ ] Shared links generate rich previews when pasted into RCS, Facebook, or Bluesky

<!-- Future milestones -->

- [ ] Sighter sees contextual data enriching their sighting (nearby historical sightings, salmon run data, tides, individual whale biographical info)
- [ ] Sightings from Facebook community groups are surfaced on the platform (cold start / lock-in mitigation)
- [ ] Platform hosts a comprehensive catalog of individual Salish Sea cetaceans (all species)
- [ ] Data consumers can download occurrence records in standard formats
- [ ] Platform links to existing external cetacean resources and databases

### Out of Scope

- Native mobile app — web-first; mobile web is sufficient for in-the-moment sighting
- Real-time push notifications — not needed for current use cases
- Non-cetacean marine species — focus stays on whales and dolphins

## Context

- Deployed as a static SPA on AWS S3 + CloudFront with a Supabase backend
- Infrastructure defined in AWS CDK (TypeScript); deployed via GitHub Actions on push to `main`
- Built with Lit web components, Vite, TypeScript, OpenLayers for maps, TanStack Form
- URL state already tracks: `d` (date), `x/y/z` (map position), `o` (focused occurrence ID)
- Two main audiences have meaningfully different needs: sighters want speed and convenience in the field; researchers want completeness, reliability, and downloadability
- Facebook community groups are a significant existing community that creates a cold-start challenge and platform lock-in; scraping is being explored as a migration path
- The rich link preview requirement is complicated by the static SPA architecture — crawler bots won't execute JavaScript, so some server-side infrastructure (e.g., Lambda@Edge or CloudFront Functions) may be needed

## Constraints

- **Stack**: Lit + Vite + TypeScript — no framework changes planned
- **Backend**: Supabase (PostgreSQL + auth + storage) — existing schema
- **Deployment**: Static S3/CloudFront — server-side rendering requires additional AWS infra
- **Auth**: Google Sign-In only (no email/password, no other OAuth providers)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Static SPA on S3/CloudFront | Low ops overhead, fast global CDN | ⚠️ Revisit — complicates rich link previews |
| Google Sign-In only | Simple auth, target audience uses Google | — Pending evaluation |
| Occurrence link encodes only occurrence ID | Cleaner URLs; date/position derived from occurrence on load | — Pending |
| Rich preview infrastructure approach | Static SPA can't serve dynamic meta tags without help | — Pending research |

---
*Last updated: 2026-03-04 after initialization*
