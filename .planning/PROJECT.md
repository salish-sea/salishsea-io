# SalishSea.io

## What This Is

SalishSea.io is a whale sighting platform for the Salish Sea area serving two distinct audiences: sighters who want to share observations in the moment, and researchers (or the same people in a different mode) who want access to a reliable, comprehensive historical record of cetacean observations. The app presents an interactive map of dated sightings, allows authenticated users to log new observations with photos and location data, and links observations into travel segments by species.

## Core Value

The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.

## Current State

Three milestones shipped. v1.0 added shareable occurrence links with rich social previews. v1.1 added partner org hyperlinking — occurrence body text now auto-links known partner org names via a CSV-driven lookup editable without code changes. v1.2 shipped a nightly-regenerated DarwinCore Archive (DwC-A) + GeoParquet sidecar at `https://salishsea.io/dwca/…`, downloadable from the About modal.

**Next milestone:** to be defined. Likely directions in `### Active` below.

## Last Milestone: v1.2 Export to DarwinCore Archive — SHIPPED 2026-06-18

**Delivered:** A nightly GitHub Actions workflow regenerates a DarwinCore Archive (zip + GeoParquet sidecar + sha256 sidecars) from a dedicated read-only `dwc` Postgres schema and publishes it atomically to S3/CloudFront. The About modal links the artifacts with live size + freshness, using a Lambda@Edge carve-out so binary downloads bypass the OG-meta interceptor.

**Outcomes:**
- 22/22 v1 requirements satisfied — DWCA-05 (GBIF validator pass) closed 2026-06-19: "can be indexed by GBIF", zero blocking errors (was deferred at ship while the validator service was offline)
- Cross-phase wiring verified end-to-end; no orphaned or missing contracts
- Audit status: tech_debt (one deferral + minor follow-ups)
- See `.planning/milestones/v1.2-MILESTONE-AUDIT.md` for full audit

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
- ✓ Partner organization names in occurrence body text are automatically hyperlinked to their websites — v1.1
- ✓ Data consumers can download occurrence records as a DarwinCore Archive (DwC-A) + GeoParquet sidecar, regenerated nightly, with sha256 verification — v1.2

### Active

<!-- v1.2 follow-ups -->
- ✓ DWCA-05: archive passes the GBIF DwC-A validator ("can be indexed by GBIF") — validated 2026-06-19; warnings logged as v2 follow-ups below
- [ ] Emit `coordinateUncertaintyInMeters` on occurrence records (GBIF validator flagged its absence 2026-06-19)
- [ ] Enrich `eml.xml` resource contacts (GBIF validator: `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`, 2026-06-19)
- [ ] Model embedded dataset attributions (bracket tags + "Submitted by …" lines in `maplify.sightings.comments`) as first-class sources so `dwc.occurrences` `datasetName`/`institutionCode` resolve from real refs

<!-- Future milestones -->

- [ ] Sighter sees contextual data enriching their sighting (nearby historical sightings, salmon run data, tides, individual whale biographical info)
- [ ] Sightings from Facebook community groups are surfaced on the platform (cold start / lock-in mitigation)
- [ ] Platform hosts a comprehensive catalog of individual Salish Sea cetaceans (all species)
- [ ] Occurrence records carry individual-animal identity (organismID) and are registered with GBIF/OBIS
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
| DwC contract in read-only `dwc` Postgres schema (not app-code mapping over `public.occurrences`) | Auditable SQL, view-as-contract enforces column parity at CREATE VIEW time | ✓ Validated — Phase 5 (v1.2) |
| Hybrid TS + DuckDB pipeline (TS owns EML/meta.xml/zip; DuckDB owns CSV + GeoParquet COPYs) | One ordered field list drives both descriptor and projection; DuckDB ATTACH Postgres + `ST_Point` auto-emits GeoParquet 1.0.0 metadata | ✓ Validated — Phase 6 (v1.2) |
| Nightly GHA reuses existing OIDC role + S3 bucket (no new AWS infra) | Path carve-out via Lambda@Edge keeps `/dwca/*` raw past the OG-meta interceptor | ✓ Validated — Phase 7 (v1.2) |
| Checksum-LAST upload order (parquet, zip, parquet.sha256, zip.sha256) | Atomicity: clients cannot fetch a sha256 newer than its artifact | ✓ Validated — Phase 7 (v1.2) |
| Frontend HEAD-on-open with per-session cache (no preflight on initial page load) | Avoids cost on every page view; About-modal opens trigger fetch once per session | ✓ Validated — Phase 8 (v1.2) |
| Occurrence-record license = CC-BY-NC 4.0 (resolvable URI); rights/gaps documented in single POLICY.md gate before any SQL | Policy-first gate prevents silently fudging gaps in encoding | ✓ Validated — Phase 4 (v1.2) |

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
*Last updated: 2026-06-18 — after v1.2 Export to DarwinCore Archive milestone*
