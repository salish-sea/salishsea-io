# Roadmap: SalishSea.io

## Milestones

- ✅ **v1.0 Link Shareability** — Phases 1-2 (shipped 2026-04-17)
- ✅ **v1.1 Partner Org Links** — Phase 3 (shipped 2026-04-18)
- 🚧 **v1.2 Export to DarwinCore Archive** — Phases 4-8 (in progress)

## Phases

<details>
<summary>✅ v1.0 Link Shareability (Phases 1-2) — SHIPPED 2026-04-17</summary>

- [x] Phase 1: Occurrence Links (2/2 plans) — completed 2026-03-04
- [x] Phase 2: Rich Previews (5/5 plans) — completed 2026-04-17

</details>

<details>
<summary>✅ v1.1 Partner Org Links (Phase 3) — SHIPPED 2026-04-18</summary>

- [x] Phase 3: Partner Org Hyperlinking (2/2 plans) — completed 2026-04-18

</details>

### 🚧 v1.2 Export to DarwinCore Archive (In Progress)

**Milestone Goal:** Publish a nightly-regenerated DarwinCore Archive (DwC-A) of SalishSea.io occurrence records — native observations + Maplify/Whale Alert only — downloadable from the site, with a GeoParquet sidecar alongside it. Additive and read-only; the existing app runtime and source tables are untouched. Download-only this milestone; GBIF/OBIS registration deferred but kept reachable by emitting valid `meta.xml` + EML.

**Dependency order (honored from research):** rights/gap policy → DB projection → archive generation → nightly workflow → frontend link. Phases 5–6 are fully offline-validatable (local Supabase + local zip) before any prod-touching workflow exists.

- [x] **Phase 4: Rights & Data-Model Policy (gate)** - Document/encode rights + resolve the data-model gaps as explicit findings before any code (completed 2026-06-10)
- [x] **Phase 5: DB Projection (`dwc` schema)** - Read-only `dwc` schema projecting in-scope occurrences into DarwinCore-aligned columns over source tables (completed 2026-06-17)
- [ ] **Phase 6: Archive Generation** - Produce a valid DwC-A zip (`meta.xml` + EML + Occurrence core + Multimedia extension) that passes the GBIF validator, plus a GeoParquet sidecar from the same projection
- [ ] **Phase 7: Nightly Workflow & Hosting** - Scheduled GitHub Actions workflow publishes the archive atomically to existing S3/CloudFront with a checksum
- [ ] **Phase 8: Frontend Download Link** - A site visitor can discover and download the archive from the site

## Phase Details

### Phase 4: Rights & Data-Model Policy (gate)

**Goal**: Resolve and document all rights/licensing and data-model gap decisions as explicit findings, so the downstream `dwc` views and generator have a single authoritative policy to encode and nothing left to silently fudge.
**Depends on**: Phase 3 (milestone boundary — no in-milestone dependency)
**Requirements**: GAP-01, GAP-02, GAP-03, GAP-04
**Success Criteria** (what must be TRUE):

  1. A written gaps-and-policy document records a resolution for every audited data/datatype gap (eventDate precision, omit-unknown coordinate uncertainty, per-source `basisOfRecord`, count/`occurrenceStatus`, license-less photo exclusion, unvalidated identifier exclusion) — no gap is silently defaulted.
  2. The occurrence-record license is recorded as CC-BY-NC 4.0 expressed as a resolvable CC URI, with the native-record / contributor-consent stance documented (the license itself is already decided — this phase documents and operationalizes it, not re-decides it).
  3. The attribution/provenance model is specified: which fields carry `recordedBy`, `rightsHolder`, and dataset/record provenance for Whale Alert and its nested Orca Network / Cascadia sources.
  4. A decision is recorded on Whale Alert / Maplify redistribution terms — either confirmed permission to redistribute, or an explicit fallback (native-only first cut) — so generation cannot proceed on an unresolved rights question.

**Plans**: 1 plan
Plans:

- [x] 04-01-PLAN.md — Author the single authoritative `04-POLICY.md` (license & rights, attribution/provenance, data-model gaps, third-party redistribution status + conferral questions)

**Research flag**: Likely needs light phase-level research — Whale Alert / Maplify redistribution terms are an external legal/ToS question not answerable from the codebase, and the outcome can rescope the milestone (native-only fallback). Sequence this gate first.

### Phase 5: DB Projection (`dwc` schema)

**Goal**: A dedicated read-only `dwc` Postgres schema projects in-scope occurrences into DarwinCore-aligned columns, built directly from source tables, encoding the Phase 4 gap decisions as auditable SQL. This is the leaf dependency that blocks everything below.
**Depends on**: Phase 4 (encodes its policy decisions)
**Requirements**: ALIGN-01, ALIGN-02, ALIGN-03, ALIGN-04, ALIGN-05, ALIGN-06
**Success Criteria** (what must be TRUE):

  1. Querying `dwc.occurrences` against local Supabase returns DarwinCore-aligned rows built from source tables (`public.observations`, `maplify.sightings`, photo tables) — never from the UI-shaped `public.occurrences` view — filtered to native + Maplify/Whale Alert only.
  2. Every projected occurrence carries the four GBIF-required terms (`occurrenceID`, `basisOfRecord`, `scientificName`, `eventDate`), with `occurrenceID` stable and deterministic across runs (source-prefixed surrogate keys).
  3. A recursive `dwc.classification()` over the `taxa` parent hierarchy fills `taxonRank` + `kingdom`…`genus` (genus/family rows carry the right `taxonRank` and no fabricated binomial).
  4. Spatial terms emit `decimalLatitude`/`decimalLongitude` with correct axis and sign (a known Salish Sea point lands at ~48°N / ~-123°W), a constant WGS84 `geodeticDatum`, and `coordinateUncertaintyInMeters` omitted when unknown (never 0).
  5. Temporal terms emit ISO-8601 `eventDate` at honest per-source precision — Maplify report-time is emitted at date precision (or flagged), never as a false second-level sighting time.

**Plans**: 4 plansPlans:
**Wave 1**

- [x] 05-01-PLAN.md — Schema scaffolding + recursive helper view `dwc.taxa_classification` (Wave 1) — completed 2026-06-17

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Native branch view `dwc._native_occurrences` (Wave 2) — completed 2026-06-17

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-03-PLAN.md — Maplify branch view `dwc._maplify_occurrences` + DISTINCT source audit (Wave 2)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 05-04-PLAN.md — Union `dwc.occurrences` + `dwc.datasets` + `dwc.multimedia` + db reset + assertion suite (Wave 4)

**UI hint**: no

### Phase 6: Archive Generation

**Goal**: A thin serializer reads the `dwc` views and produces a valid DwC-A zip — `meta.xml` + `eml.xml` + Occurrence core + Simple Multimedia extension — that passes the GBIF validator, with descriptor and serializer driven from one ordered field list so indices cannot drift.
**Depends on**: Phase 5 (consumes the view column contract)
**Requirements**: DWCA-01, DWCA-02, DWCA-03, DWCA-04, DWCA-05, DWCA-06
**Success Criteria** (what must be TRUE):

  1. Running the export locally produces a `.zip` containing `meta.xml`, `eml.xml`, an Occurrence core file, and a Simple Multimedia extension file for photos.
  2. `meta.xml` and the data files are generated from a single ordered field list, and a round-trip parse of a known record confirms each value maps to the expected DwC term (no index drift).
  3. Every Multimedia row joins to an Occurrence core row via a byte-stable `coreId` — the anti-join is empty, with no orphaned media and the same source filter applied to both files.
  4. Data files are serialized as UTF-8 without BOM, with freeform body text correctly quoted/escaped, HTML stripped, and accents/emoji round-tripping intact.
  5. The produced archive passes the GBIF DwC-A validator with no blocking (structural) errors.
  6. A GeoParquet sidecar is produced from the same `dwc.occurrences` projection — GeoParquet 1.0.0, WKB Point geometry (WGS84/CRS84), with `decimalLatitude`/`decimalLongitude` retained — and round-trips in DuckDB (valid `geo` metadata, all rows geocoded).

**Plans**: TBD
**Planning note**: A 2026-06-09 spike confirmed DuckDB can `ATTACH` Postgres, unpack the composite types, and emit CSV/Parquet/GeoParquet from one `COPY` — GeoParquet 1.0.0 came out spec-valid and ~4.3× smaller than CSV. This raises a tooling choice for planning: **DuckDB-driven export** (one engine for all three formats; GeoParquet in JS is painful) vs the Node serializer (`archiver`/`postgres`/`csv-stringify`) the research assumed. Decide during `/gsd-plan-phase 6`.
**UI hint**: no

### Phase 7: Nightly Workflow & Hosting

**Goal**: A scheduled GitHub Actions workflow regenerates and publishes the archive nightly to the existing S3/CloudFront site, reusing the existing AWS OIDC role and bucket, with an atomic write-then-swap, an empty-result guard, a CloudFront invalidation, and a published checksum. This is the only prod-touching, secret-requiring surface.
**Depends on**: Phase 6 (wraps the working export script)
**Requirements**: EXPORT-01, EXPORT-02, EXPORT-03, EXPORT-04, EXPORT-05
**Success Criteria** (what must be TRUE):

  1. A scheduled workflow (with `workflow_dispatch` for manual runs) regenerates the archive automatically every night at a defined time and timezone.
  2. After a run, the archive is reachable at a stable public URL under `https://salishsea.io/dwca/…`, served by the existing CloudFront distribution from the existing bucket with no new AWS infrastructure.
  3. Publication is atomic (write-then-swap), refuses to overwrite a good archive with an empty/under-threshold result, and invalidates the CloudFront cache so the new archive is served promptly.
  4. A sha256 checksum is published alongside the archive and verifies against the downloaded file.
  5. The GeoParquet sidecar is regenerated and published by the same nightly run, under `/dwca/…`, with the same atomic-publish, empty-result guard, cache invalidation, and checksum treatment as the archive.

**Plans**: TBD
**Research flag**: Likely needs light phase-level research — confirm the CloudFront behavior passes `/dwca/*` straight through to S3 rather than rewriting to the SPA `index.html` (verify against the Lambda@Edge / behavior config).
**Secret flag**: Introduces a possible NEW `production` GitHub environment secret (Supabase service-role / DB connection string). Per deployment memory, surface this to the user and await confirmation before the first workflow run.
**UI hint**: no

### Phase 8: Frontend Download Link

**Goal**: A site visitor can discover and download the DarwinCore Archive from the site via one static, low-risk download link/page pointing at the stable published URL.
**Depends on**: Phase 7 (needs a stable published object at `/dwca/…`)
**Requirements**: DOWNLOAD-01
**Success Criteria** (what must be TRUE):

  1. A site visitor can find a clearly labeled "Data download / DwC-A" link on the site.
  2. Following the link downloads the current archive from the stable `https://salishsea.io/dwca/…` URL.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 4 → 5 → 6 → 7 → 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Occurrence Links | v1.0 | 2/2 | Complete | 2026-03-04 |
| 2. Rich Previews | v1.0 | 5/5 | Complete | 2026-04-17 |
| 3. Partner Org Hyperlinking | v1.1 | 2/2 | Complete | 2026-04-18 |
| 4. Rights & Data-Model Policy | v1.2 | 1/1 | Complete   | 2026-06-10 |
| 5. DB Projection (`dwc` schema) | v1.2 | 4/4 | Complete    | 2026-06-17 |
| 6. Archive Generation | v1.2 | 0/TBD | Not started | - |
| 7. Nightly Workflow & Hosting | v1.2 | 0/TBD | Not started | - |
| 8. Frontend Download Link | v1.2 | 0/TBD | Not started | - |
