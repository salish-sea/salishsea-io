# SalishSea.io

## What This Is

SalishSea.io is a whale sighting platform for the Salish Sea area serving two distinct audiences: sighters who want to share observations in the moment, and researchers (or the same people in a different mode) who want access to a reliable, comprehensive historical record of cetacean observations. The app presents an interactive map of dated sightings, allows authenticated users to log new observations with photos and location data, and links observations into travel segments by species.

## Core Value

The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.

## Current Milestone: v1.1 Partner Org Links

**Goal:** Partner organization names appearing in occurrence body text are automatically hyperlinked to their websites.

**Target features:**
- CSV file (name, url columns) listing partner orgs, editable by non-technical contributors
- At render time, body text is scanned for org name matches (case-insensitive) and wrapped in markdown links before the existing marked.parse step
- Links open in a new tab (rel="noopener noreferrer")
- Already-linked text is not double-linked

## Requirements

### Validated

- ✓ User can log a whale sighting with species, location, time, and photos — existing
- ✓ User can view an interactive map of sightings for a selected date — existing
- ✓ User can sign in with Google to submit and edit sightings — existing
- ✓ App preserves map position, selected date, and focused occurrence in URL — existing
- ✓ User can edit their own sightings — existing
- ✓ User can copy a shareable link to a specific occurrence from its summary card — v1.0
- ✓ Following an occurrence link sets the date and map view from that occurrence (not defaults) — v1.0
- ✓ Shared links generate rich previews when pasted into RCS, Facebook, or Bluesky — v1.0

### Active

- [x] Partner organization names in occurrence body text are automatically hyperlinked to their websites — v1.1 (Validated in Phase 03: partner-org-hyperlinking)

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
| Static SPA on S3/CloudFront | Low ops overhead, fast global CDN | Lambda@Edge handles bot detection for rich previews |
| Google Sign-In only | Simple auth, target audience uses Google | — Pending evaluation |
| Occurrence link encodes only occurrence ID | Cleaner URLs; date/position derived from occurrence on load | Validated — Phase 01 |
| Lambda@Edge for rich previews | CloudFront Functions lacks fetch(); Lambda@Edge enables Supabase lookup per request | Validated — Phase 02 |
| SSM credentials managed outside CDK | CDK can't create SecureString; Lambda reads from SSM with module-scope cache | Validated — Phase 02 |

---
## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-17 — Phase 03 complete (partner-org-hyperlinking)*
