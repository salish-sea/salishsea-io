# CONTEXT.md — Domain Language

Shared vocabulary for SalishSea.io. Use these terms as defined here, in code and in conversation. Update this file whenever a term is coined, sharpened, or deprecated.

## Region & Mission

- **Salish Sea** — the marine region the platform covers. Spatial scope matches **Acartia**'s boundaries: the full range of Southern Resident Killer Whales.
- **Taxonomic scope** — for the time being, the taxonomic scope of **PSEMP's Marine Mammal Working Group** (Puget Sound Ecosystem Monitoring Program) — Salish Sea marine mammals broadly, not just cetaceans. All three groups are ingested via iNaturalist today: Cetacea, Phocoidea (pinnipeds), Lutrinae (otters). Which animals are in scope is a property of the *site's coverage*, not of the definition of an occurrence. (This supersedes the older "cetaceans only, with a Lutrinae exception" framing — otters and seals are marine mammals, not an exception.)
- **Shore regular** — the primary uptake persona: a mission-driven sighter who lives on the water and is already in the Orca Network Facebook orbit.
- **Curator** — a privileged human who exercises **curational trust judgment** on behalf of the dataset: judging how much to trust evidence and a person, and asserting a claim's **status** and a party's **reputation** over others and their claims (decision [014](docs/decisions/014-trust-and-curation-model.md)). Forcing ingest actions (manually re-fetch/preview a source/window via the ingest endpoint) is one *operator* facet of the same role, held by the same people in practice. Distinct from a **Contributor** (who *observed* a record), a **Shore regular** (an uptake persona), and a **moderator action** (flagging spam/abuse — content hygiene, not a trust judgment). Governance layer only; no curator role/write-path is built yet.

## Observations

- **Occurrence** — any record of an organism at a place and time (the DarwinCore-aligned term). The general concept; a *sighting* and an *acoustic detection* are two kinds of occurrence. Records live across four source schemas internally — three **Upstream mirror** schemas (`maplify`, `inaturalist`, `happywhale`) plus the native `public` schema — resolved into our domain by the `public.occurrences` view.
- **Sighting** — an occurrence recorded by a *person*: their report of what they saw, plus any photographic evidence. The kind of occurrence the site handles today.
- **Acoustic detection** — an occurrence derived from sensor data rather than a human report. Concretely (decision [013](docs/decisions/013-orcasound-acoustic-occurrences.md)): one OrcaSound **biophony bout** — a moderator-curated acoustic activity period at a hydrophone — located at the feed's coordinates and spanning a *time range*, not an instant. Species/pod/ecotype come from structured upstream **tags**, not the bout's free-text name. Not yet built; blocked on upstream tag adoption ([orcasound/orcasite#1001](https://github.com/orcasound/orcasite/issues/1001)).
- **Segment** — chronologically related observations of the same species grouped into a travel chain; imputed client-side from time/distance heuristics and per-species travel speeds.
- **occurrenceID prefixing** — exported IDs are `{source}:{id}` (e.g. `salishsea:…`, `maplify:…`); the prefix encodes the source.

## Individuals

- **Individual** *(planned)* — a specific animal in **our own authoritative catalog** (designation e.g. `T065A`, aliases, species, matriline/pod). Distinct from the `happywhale.individuals` **Upstream mirror** and from **candidate identifiers** — both are *inputs*, never the source of truth (decision 008).
- **Identification** — a *claim* linking an occurrence to an Individual (or group), each with decomposed provenance: subject, presence/absence, **evidence** (text mention / photo / CV match / field obs), **method** (how we captured it), **status** (candidate / validated / rejected), and asserting authority. Lives in `public.identifications`; regex hits enter as `candidate`/`text_mention` and are one input among curated/CV claims. Trust is governed by decision [014](docs/decisions/014-trust-and-curation-model.md).
- **Status** (of a claim) — its trust level: `candidate` (unvalidated, e.g. a regex mention), `validated`, or `rejected`. Set by a curator; a stored claim overrides the raw candidate for the same occurrence+subject. Vocabulary may grow (decision 014).
- **Reputation** *(planned)* — a party's standing that weights how much their claims are trusted. Not yet modeled (decision 014).
- **Candidate identifier** — a whale-ID code (`T065S`, J/K/L pods, `CRC…`) regex-extracted from free text by `public.extract_identifiers`; surfaced as the occurrence `identifiers` column and exported as `unvalidatedIdentifiers`. **Unvalidated** — never emitted as `organismID` (see [docs/rights-policy.md](docs/rights-policy.md)).
- **`organismID`** — the DarwinCore term for a *validated* individual identity. Out of scope until the validation model exists; unvalidated codes never qualify.

## Provenance (four independent concepts — do not conflate)

- **Provider** — *how a record reached us* (ingest API/pipeline). One per sighting; internal only, never exported. Instances: iNaturalist, Maplify/conserve.io, HappyWhale, SalishSea.io Direct.
- **Collection** — *what channel the observation came through* (the venue). One per sighting; stable even if re-sourced through a different provider. Drives `datasetName`. Examples: Orca Network, Cascadia Research Collective, Whale Alert (Global), Orcasound, iNaturalist, SalishSea.io Direct.
- **Organization** — *what institution backs the channel* (nullable, reached via collection). Credited in EML `associatedParty`, never `institutionCode`. Standalone Facebook groups have no organization.
- **Contributor** — *who observed it* (nullable, per sighting). Drives `recordedBy`.
- **`collection_kind`** — enum: `facebook_group`, `research_dataset`, `acoustic_feed`, `detector`, `direct_app`. (`aggregator_ingest` deliberately excluded — being an aggregator is a provider fact, not a collection kind.)
- **Trusted Observer** — an *upstream Maplify* trust-tier attribution line ("Submitted by a … Trusted Observer") that we *parse* for attribution. Names an organization/tier, **never a person** — using it for contributor identity is a category error. Distinct from the Maplify `trusted` column (an **Upstream mirror** field, not our domain) and from any future native "trusted" concept we may coin.

## Export & Standards

- **Aggregator pattern** — the publishing convention where SalishSea.io is the GBIF institution (`institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`) and upstream sources are credited via per-collection `datasetName` and EML `associatedParty`. Standard among aggregators (Happywhale→OBIS-SEAMAP, iNaturalist, eBird).
- **DwC-A / DarwinCore Archive** — the standardized biodiversity export (Occurrence core + Multimedia extension + `meta.xml` + `eml.xml`), regenerated nightly at `https://salishsea.io/dwca/` with a GeoParquet sidecar and sha256 checksums.
- **EML** — Ecological Metadata Language; the dataset-level `eml.xml`. Upstream orgs appear as `<associatedParty>` with role `contentProvider`.
- **SRC-01** — the export-exclusion rule: iNaturalist and HappyWhale records are modeled internally but excluded from the DwC-A because they self-publish to GBIF; re-exporting would create duplicates. Enforced by construction (UNION of exactly two branches), never by WHERE filter.
- **GBIF / OBIS** — the global biodiversity databases the export targets. GBIF dedup matches coords+date, not occurrenceID — hence SRC-01.
- **dwc schema** — the read-only Postgres schema that is the export contract (view-as-contract: column/type parity enforced at CREATE VIEW time).
- **License (per-record)** — native SalishSea.io records export as **CC-BY-NC 4.0**; Maplify / Whale Alert records as **CC-BY 4.0** (asserted via the Acartia cooperative). The per-record `license` column is authoritative; the dataset-level `eml.xml` license is CC-BY-NC 4.0. Full policy: [docs/rights-policy.md](docs/rights-policy.md).

## Upstream Ecosystem

- **Upstream mirror** — the per-source schemas (`maplify`, `inaturalist`, `happywhale`) that hold external-API data more-or-less verbatim: the ingest pipeline's landing zone and an anti-corruption layer, **not** authoritative domain. Their columns carry *upstream* semantics and must **not** leak into our vocabulary, interfaces, or public docs; our authoritative domain is `public.*` and the `dwc` export contract. Upstream signals may be *parsed* into our concepts (e.g. attribution from `comments`), never *adopted* as-is. See [decision 008](docs/decisions/008-source-schemas-are-upstream-mirrors.md).
- **Ingest run** — one execution of network ingest for a single source over a single time window: fetch → transform → guarded persist. Recorded durably in `ingest_runs` with its outcome and row counts. A run is **complete** (safe to reconcile) only if its fetch was provably whole — every page and, for iNaturalist, the full taxon ancestor closure; any partial or failed fetch writes nothing. See [decision 011](docs/decisions/011-ingest-imperative-shell.md).
- **Imperative shell / functional core** — the ingest architecture ([011](docs/decisions/011-ingest-imperative-shell.md)): the *shell* holds all effects (fetch, retry, log, persist, schedule); the *core* is pure, unit-tested transforms (upstream JSON → normalized records, taxon mapping, coordinate parsing, dedup, reconcile diff). Postgres is a store, not an HTTP client.
- **Maplify / Conserve.io / WASEAK** — Maplify (operated by Conserve.io, the marine-mammal app people — *not* whale-alert.io, an unrelated crypto service) aggregates sightings; we fetch from the WASEAK API. Collection signals ride in `comments`: leading `[Tag]` bracket, trailing "Submitted by …" line, structured `source` code.
- **Acartia Data Cooperative** — the *organization* (a Beam Reach initiative, ~6 years running; repo github.com/salish-sea/acartia) that coordinates Salish Sea sighting data-sharing. Distinct from **acartia.io**, its concrete-but-anemic reference project (receives data, maps it; long without sustained technical leadership). Contributors assert CC-BY 4.0 at registration. Community sightings flow in (e.g. Orca Network → Acartia) and on to Ocean Wise's WRAS → Conserve.io/Maplify. This chain is invisible to sighters today — making it visible is a strategic opportunity.
- **Beam Reach** — the LLC behind the Acartia initiative and the funder of SalishSea.io. **SalishSea.io** substantially re-founds the acartia.io function (map-first sightings) as a fresh codebase under new technical leadership, still within the Cooperative — it began as a request to fold iNaturalist data into Acartia and became a new project instead.
- **Orca Network** — PNW nonprofit (Howard Garrett & Susan Berta); ~140k-follower Facebook group with a real-time sighting-coordination feed and ~15k-subscriber email list. A named Maplify sub-source and the key partnership target.
- **OrcaSound / orcasite** — the community hydrophone network (live.orcasound.net) and its Elixir/Ash backend, [orcasound/orcasite](https://github.com/orcasound/orcasite) — a sister project in the Acartia cooperative, and the source of **acoustic detections**. Its acoustic activity comes at three grains: **Detections** (single button-presses, human or OrcaHello-machine; noisy), **Candidates** (auto-clustered detections; GraphQL-only), and **Bouts** (moderator-curated activity periods on the `/api/json/bouts` JSON:API; audio-category `biophony`/`anthrophony`/`geophony`). We consume **biophony bouts** only; see decision [013](docs/decisions/013-orcasound-acoustic-occurrences.md). Already a **Collection** with `collection_kind = acoustic_feed`; hydrophone *locations* are a separate static map layer (`fetch-hydrophones.ts`).
- **`rwsas` / `wras`** — two Maplify source codes excluded from ingest, for different reasons. `rwsas` is filtered at ingest (`WHERE source != 'rwsas'`). `wras` is both filtered (`source IS DISTINCT FROM 'wras'`) and one-time-deleted — an operator decision (2026-06-19): those ~50 rows "should not exist" per the Maplify census. The underlying rationale for `wras` is not recorded; it was a handed-down requirement.
- **HappyWhale individuals** — HappyWhale tracks individual *whales* (`organismID` territory), distinct from contributors. Mirrored in `happywhale.individuals` (an **Upstream mirror**, not our catalog).
- **Flukebook** *(planned integration)* — the Wildbook-based computer-vision photo-ID platform for cetaceans. A source of automated **candidate identifications**: submit occurrence photos, receive ranked individual matches with confidence scores. Flukebook individual IDs map to our catalog as an external-catalog link, alongside HappyWhale.

## Conventions

- **Coordinates** — decimal lon/lat WGS84; map projection EPSG:3857 (Pseudo-Mercator). EPSG:32610 was rejected: it would require custom raster maps.
- **Time** — UNIX epoch seconds (widely supported, cheap SQL interval math).
- **URL state** — `d` (date), `x/y/z` (map position), `o` (focused occurrence ID).
