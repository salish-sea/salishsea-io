# CONTEXT.md — Domain Language

Shared vocabulary for SalishSea.io. Use these terms as defined here, in code and in conversation. Update this file whenever a term is coined, sharpened, or deprecated.

## Region & Mission

- **Salish Sea** — the marine region the platform covers. Data scope matches **Acartia**'s spatial boundaries: the full range of Southern Resident Killer Whales.
- **Shore regular** — the primary uptake persona: a mission-driven sighter who lives on the water and is already in the Orca Network Facebook orbit.

## Observations

- **Sighting / Occurrence** — a single cetacean observation (species, location, time, photos). "Occurrence" is the DarwinCore-aligned term. Records live across four source schemas internally.
- **Segment** — chronologically related observations of the same species grouped into a travel chain; imputed client-side from time/distance heuristics and per-species travel speeds.
- **occurrenceID prefixing** — exported IDs are `{source}:{id}` (e.g. `salishsea:…`, `maplify:…`); the prefix encodes the source.

## Provenance (four independent concepts — do not conflate)

- **Provider** — *how a record reached us* (ingest API/pipeline). One per sighting; internal only, never exported. Instances: iNaturalist, Maplify/conserve.io, HappyWhale, SalishSea.io Direct.
- **Collection** — *what channel the observation came through* (the venue). One per sighting; stable even if re-sourced through a different provider. Drives `datasetName`. Examples: Orca Network, Cascadia Research Collective, Whale Alert (Global), Orcasound, iNaturalist, SalishSea.io Direct.
- **Organization** — *what institution backs the channel* (nullable, reached via collection). Credited in EML `associatedParty`, never `institutionCode`. Standalone Facebook groups have no organization.
- **Contributor** — *who observed it* (nullable, per sighting). Drives `recordedBy`.
- **`collection_kind`** — enum: `facebook_group`, `research_dataset`, `acoustic_feed`, `detector`, `direct_app`. (`aggregator_ingest` deliberately excluded — being an aggregator is a provider fact, not a collection kind.)
- **Trusted Observer** — a Maplify trust-tier attribution line ("Submitted by a … Trusted Observer"). Names an organization/tier, **never a person** — using it for contributor identity is a category error.

## Export & Standards

- **Aggregator pattern** — the publishing convention where SalishSea.io is the GBIF institution (`institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`) and upstream sources are credited via per-collection `datasetName` and EML `associatedParty`. Standard among aggregators (Happywhale→OBIS-SEAMAP, iNaturalist, eBird).
- **DwC-A / DarwinCore Archive** — the standardized biodiversity export (Occurrence core + Multimedia extension + `meta.xml` + `eml.xml`), regenerated nightly at `https://salishsea.io/dwca/` with a GeoParquet sidecar and sha256 checksums.
- **EML** — Ecological Metadata Language; the dataset-level `eml.xml`. Upstream orgs appear as `<associatedParty>` with role `contentProvider`.
- **SRC-01** — the export-exclusion rule: iNaturalist and HappyWhale records are modeled internally but excluded from the DwC-A because they self-publish to GBIF; re-exporting would create duplicates. Enforced by construction (UNION of exactly two branches), never by WHERE filter.
- **GBIF / OBIS** — the global biodiversity databases the export targets. GBIF dedup matches coords+date, not occurrenceID — hence SRC-01.
- **dwc schema** — the read-only Postgres schema that is the export contract (view-as-contract: column/type parity enforced at CREATE VIEW time).

## Upstream Ecosystem

- **Maplify / Conserve.io / WASEAK** — Maplify (operated by Conserve.io, the marine-mammal app people — *not* whale-alert.io, an unrelated crypto service) aggregates sightings; we fetch from the WASEAK API. Collection signals ride in `comments`: leading `[Tag]` bracket, trailing "Submitted by …" line, structured `source` code.
- **Acartia** — the data cooperative (github.com/salish-sea/acartia) Maplify records flow through; contributors assert CC-BY 4.0 at registration. Feeds Ocean Wise's WRAS → Conserve.io. This chain is invisible to sighters today — making it visible is a strategic opportunity.
- **Orca Network** — PNW nonprofit (Howard Garrett & Susan Berta); ~140k-follower Facebook group with a real-time sighting-coordination feed and ~15k-subscriber email list. A named Maplify sub-source and the key partnership target.
- **`rwsas`** — a Maplify source code excluded at ingest (`WHERE source != 'rwsas'`).
- **HappyWhale individuals** — HappyWhale tracks individual *whales* (`organismID` territory), distinct from contributors. Out of scope for now (INDIV-01).

## Conventions

- **Coordinates** — decimal lon/lat WGS84; map projection EPSG:3857 (Pseudo-Mercator). EPSG:32610 was rejected: it would require custom raster maps.
- **Time** — UNIX epoch seconds (widely supported, cheap SQL interval math).
- **URL state** — `d` (date), `x/y/z` (map position), `o` (focused occurrence ID).
