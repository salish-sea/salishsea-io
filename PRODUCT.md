# SalishSea.io — Product

## What This Is

SalishSea.io is a whale sighting platform for the Salish Sea serving two distinct audiences: **sighters** who want to share observations in the moment, and **researchers** (often the same people in a different mode) who want a reliable, comprehensive historical record of cetacean observations. The app presents an interactive map of dated sightings, lets authenticated users log observations with photos and location, and links observations into travel segments by species.

**Core value:** the most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.

**Mission:** a place for people who live in the region to connect, deepen their understanding of the ecology, and fight to protect it.

## Audiences

- **Sighters** want speed and convenience in the field. The primary uptake persona is the **shore regular**: mission-driven, lives on the water, already in the Orca Network Facebook orbit. We are deliberately not optimizing first for newcomers, tourists, or operators. See [docs/strategy/community-uptake.md](docs/strategy/community-uptake.md).
- **Researchers / data consumers** want completeness, reliability, and downloadability — served by the nightly DarwinCore Archive export with correct attribution.

## Requirements

### Validated

- User can log a whale sighting with species, location, time, and photos
- User can view an interactive map of sightings for a selected date
- User can sign in with Google to submit and edit sightings
- App preserves map position, selected date, and focused occurrence in URL (`d`, `x/y/z`, `o`)
- User can edit their own sightings
- User can copy a shareable link to a specific occurrence; following it sets date and map view from the occurrence — v1.0
- Shared links generate rich previews in RCS, Facebook, Bluesky — v1.0
- Partner organization names in occurrence body text auto-link to their websites — v1.1
- Data consumers can download occurrences as a nightly-regenerated DwC-A + GeoParquet sidecar with sha256 verification — v1.2
- Exported records are correctly attributed under the SalishSea.io aggregator pattern via the provider/collection/organization/contributor provenance graph — v1.3

### Active (near-term)

Tracked as bd issues; the durable statements:

- Emit `coordinateUncertaintyInMeters` on occurrence records (GBIF validator flagged absence, 2026-06-19)
- Enrich `eml.xml` resource contacts (GBIF `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`; re-check after Phase 13 fix)
- Populate contributor ORCIDs for the 28 native contributors (column and `recordedByID` emit shipped in v1.3)

### Future directions (unscheduled)

- **Community uptake** — the biggest open product direction. Partnership-first with Orca Network; blocked on discovery conversations, not engineering. See [docs/strategy/community-uptake.md](docs/strategy/community-uptake.md) and [decision 007](docs/decisions/007-community-uptake-strategy.md).
- Sighter sees contextual data enriching their sighting (nearby historical sightings, salmon runs, tides, individual-whale biography)
- Sightings from Facebook community groups surfaced on the platform (cold-start / lock-in mitigation)
- Comprehensive catalog of individual Salish Sea cetaceans; occurrence records carry `organismID`; registration with GBIF/OBIS
- **Computer-vision individual identification via Flukebook** (Wildbook) — automatically match a photographed sighting to known individuals, turning every photo into a candidate identification. A strategic differentiator; builds on the individuals catalog and identification model.
- Inbound ingest of in-region GBIF records (mirror-image of SRC-01; must not re-import our own contributions)

### Out of Scope

- **Native mobile app** — web-first; mobile web is sufficient for in-the-moment sighting
- **Real-time push notifications** — not needed for current use cases
- **Marine species outside the PSEMP Marine Mammal Working Group scope** — no fish, seabirds, or invertebrates. Taxonomic scope is Salish Sea marine mammals (cetaceans, pinnipeds, mustelids), all of which are already ingested via iNaturalist.

## Constraints

- **Stack:** Lit + Vite + TypeScript — no framework changes planned
- **Backend:** Supabase (PostgreSQL + auth + storage) — existing schema
- **Deployment:** static SPA on S3/CloudFront, AWS CDK infra, GitHub Actions deploy on push to `main`; server-side behavior requires edge functions
- **Auth:** Google Sign-In only
- **Spatial scope:** matches Acartia's boundaries — the full range of Southern Resident Killer Whales
- **Taxonomic scope:** that of PSEMP's Marine Mammal Working Group (Puget Sound Ecosystem Monitoring Program) — Salish Sea marine mammals broadly (cetaceans, pinnipeds, mustelids). All are ingested via iNaturalist today (taxa Cetacea / Phocoidea / Lutrinae). See [decision 009](docs/decisions/009-taxonomic-scope-marine-mammals.md).

## Decisions

Product and technical decisions, with rationale and rejected alternatives, live in [docs/decisions/](docs/decisions/). Rights and licensing policy: [docs/rights-policy.md](docs/rights-policy.md). Data provenance model: [docs/data-provenance.md](docs/data-provenance.md).

## History

- **v1.0 Link Shareability** — shipped 2026-04-17
- **v1.1 Partner Org Links** — shipped 2026-04-18
- **v1.2 Export to DarwinCore Archive** — shipped 2026-06-18
- **v1.3 Providers, Collections & Contributors** — shipped 2026-06-24

Engineering lessons from these milestones: [docs/engineering-lessons.md](docs/engineering-lessons.md).
