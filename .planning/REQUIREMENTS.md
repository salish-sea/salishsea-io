# Requirements: SalishSea.io — v1.2 Export to DarwinCore Archive

**Defined:** 2026-06-09
**Core Value:** The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.

## Milestone Scope

Publish a nightly-regenerated DarwinCore Archive (DwC-A) of SalishSea.io occurrence records, downloadable from the site. Covers **native SalishSea.io observations + Maplify/Whale Alert records only** (iNaturalist & Happywhale excluded — already published to GBIF by their canonical sources). Download-only this milestone; GBIF/OBIS registration deferred but kept reachable by emitting valid `meta.xml` + EML. Additive and read-only — the existing app runtime and source tables are untouched.

**Policy decisions (from research gaps):**
- Occurrence-record license: **CC-BY-NC 4.0** (emitted as a resolvable CC URI).
- Rights handling: assert the chosen license on all exported records and carry structured attribution/provenance (incl. Whale Alert and nested Orca Network / Cascadia sources). Keeps full native + Whale Alert scope.
- `basisOfRecord` = `HumanObservation` for all in-scope sources.
- `coordinateUncertaintyInMeters`: emit real meters when known, **omit when unknown — never 0**.
- `geodeticDatum` = WGS84 (EPSG:4326) constant.
- `travelDirection` → `dynamicProperties` (no core term). Regex-extracted whale identifiers (e.g. `T065S`) are **not** emitted as identity terms.
- Output formats: the text DwC-A is the canonical/interoperable artifact; a **GeoParquet** sidecar is published alongside it from the same `dwc.occurrences` projection. Spike-validated 2026-06-09 — GeoParquet 1.0.0 (WKB Point, default CRS84/WGS84), ~4.3× smaller than CSV, opens directly in DuckDB/QGIS/geopandas. Retain `decimalLatitude`/`decimalLongitude` columns alongside the geometry so non-spatial consumers still get coordinates. Mirrors GBIF's own dual CSV/Parquet offering.

## v1 Requirements (this milestone)

### Data-Model Alignment (ALIGN)

- [ ] **ALIGN-01**: A dedicated read-only `dwc` Postgres schema projects in-scope occurrences into DarwinCore-aligned columns, built directly from source tables (not the UI-shaped `public.occurrences` view), filtered to native + Maplify/Whale Alert only
- [ ] **ALIGN-02**: Each occurrence record carries the four GBIF-required terms — `occurrenceID`, `basisOfRecord`, `scientificName`, `eventDate`
- [ ] **ALIGN-03**: Taxonomy is expanded to `taxonRank` + `kingdom`…`genus` by walking the `taxa` parent hierarchy, with higher-rank-only identifications (genus/family) handled correctly (no false binomials, correct `taxonRank`)
- [ ] **ALIGN-04**: Spatial terms emit `decimalLatitude`/`decimalLongitude` with correct axis and sign, a constant `geodeticDatum`, and `coordinateUncertaintyInMeters` (omitted when unknown, never 0)
- [ ] **ALIGN-05**: Temporal terms emit ISO-8601 `eventDate` at honest per-source precision — Maplify report-time is emitted at date precision (or flagged), never as a false second-level sighting time
- [ ] **ALIGN-06**: `occurrenceID` is stable and deterministic across nightly runs (source-prefixed surrogate keys)

### Data Gaps & Licensing (GAP)

- [ ] **GAP-01**: Data and datatype gaps between the existing model and DarwinCore are audited and documented as explicit findings (not silently fudged)
- [ ] **GAP-02**: Occurrence records carry a `license` (CC-BY-NC 4.0) and `rightsHolder` as resolvable URIs; per-photo license codes are mapped to canonical CC URIs via one shared converter
- [ ] **GAP-03**: Source attribution and provenance are carried into the archive (`recordedBy`, and dataset/record provenance for Whale Alert and nested sources)
- [ ] **GAP-04**: Records and fields lacking a usable value are handled per documented policy — omit-when-unknown, exclude license-less photos, exclude unvalidated whale identifiers from identity terms

### Archive Generation (DWCA)

- [ ] **DWCA-01**: A valid DwC-A zip is produced containing `meta.xml`, `eml.xml`, an Occurrence core file, and a Simple Multimedia extension file for photos
- [ ] **DWCA-02**: `meta.xml` and the data files are generated from a single ordered field list so descriptor indices and column order cannot drift
- [ ] **DWCA-03**: Multimedia rows join to Occurrence core rows via a byte-stable `coreId` with no orphaned media (anti-join is empty)
- [ ] **DWCA-04**: Data files are correctly serialized — UTF-8 without BOM, proper quoting/escaping of freeform body text, HTML stripped
- [ ] **DWCA-05**: The produced archive passes the GBIF DwC-A validator with no blocking (structural) errors
- [ ] **DWCA-06**: A GeoParquet sidecar is produced from the same `dwc.occurrences` projection — GeoParquet 1.0.0 with a WKB Point geometry column (WGS84/CRS84) and `decimalLatitude`/`decimalLongitude` retained as columns — round-trippable in DuckDB/QGIS/geopandas

### Nightly Export & Hosting (EXPORT)

- [ ] **EXPORT-01**: A scheduled job regenerates the archive automatically every night at a defined time/timezone
- [ ] **EXPORT-02**: The archive is published to the existing S3/CloudFront site and reachable at a stable public URL (`/dwca/…`), reusing existing infrastructure (no new AWS infra)
- [ ] **EXPORT-03**: Publication is atomic (write-then-swap), guards against overwriting with an empty result, and invalidates the CloudFront cache
- [ ] **EXPORT-04**: A checksum is published alongside the archive for integrity verification
- [ ] **EXPORT-05**: The GeoParquet sidecar is regenerated and published alongside the DwC-A by the same nightly job (same atomic-publish, empty-result guard, cache-invalidation, and checksum treatment)

### Download Access (DOWNLOAD)

- [ ] **DOWNLOAD-01**: A site visitor can discover and download the DarwinCore Archive from the site

## v2 Requirements (deferred)

### Individuals

- **INDIV-01**: Occurrence records carry individual-animal identity (`organismID` / Organism) linked from the existing individuals model (replacing regex extraction)

### Relationships & Registration

- **REL-01**: A ResourceRelationship extension links occurrences into travel segments by species
- **REG-01**: The dataset is registered with GBIF/OBIS (EML metadata, DOI, IPT/endpoint)

### Coverage

- **SRC-01**: iNaturalist & Happywhale records are included in the archive (currently excluded to avoid GBIF duplication)

## Out of Scope

| Feature | Reason |
|---------|--------|
| GBIF/OBIS registration | Download-only this milestone; EML kept valid so registration is later config, not a rebuild |
| Individual-animal linkage / `organismID` | Individuals model exists but is not linked to occurrences yet; deferred to a later milestone |
| Emitting regex-extracted whale identifiers (e.g. `T065S`) as identity terms | Unvalidated; at most labeled-unverified in `dynamicProperties`, never as `organismID`/`catalogNumber` |
| ResourceRelationship / travel-segment extension | GBIF does not index it today; presupposes deferred individual linkage; architecture stays extensible |
| iNaturalist & Happywhale records | Already published to GBIF by their canonical sources; including them would duplicate records |
| Mapping in application code over `public.occurrences` | UI-shaped view is wrong shape/source-set; DwC contract lives in dedicated `dwc` schema instead |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ALIGN-01 | Phase 5 | Pending |
| ALIGN-02 | Phase 5 | Pending |
| ALIGN-03 | Phase 5 | Pending |
| ALIGN-04 | Phase 5 | Pending |
| ALIGN-05 | Phase 5 | Pending |
| ALIGN-06 | Phase 5 | Pending |
| GAP-01 | Phase 4 | Pending |
| GAP-02 | Phase 4 | Pending |
| GAP-03 | Phase 4 | Pending |
| GAP-04 | Phase 4 | Pending |
| DWCA-01 | Phase 6 | Pending |
| DWCA-02 | Phase 6 | Pending |
| DWCA-03 | Phase 6 | Pending |
| DWCA-04 | Phase 6 | Pending |
| DWCA-05 | Phase 6 | Pending |
| DWCA-06 | Phase 6 | Pending |
| EXPORT-01 | Phase 7 | Pending |
| EXPORT-02 | Phase 7 | Pending |
| EXPORT-03 | Phase 7 | Pending |
| EXPORT-04 | Phase 7 | Pending |
| EXPORT-05 | Phase 7 | Pending |
| DOWNLOAD-01 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22 ✓
- Unmapped: 0

**Phase distribution:**
- Phase 4 (Rights & Data-Model Policy): GAP-01..04 (4)
- Phase 5 (DB Projection): ALIGN-01..06 (6)
- Phase 6 (Archive Generation): DWCA-01..06 (6)
- Phase 7 (Nightly Workflow & Hosting): EXPORT-01..05 (5)
- Phase 8 (Frontend Download Link): DOWNLOAD-01 (1)

---
*Requirements defined: 2026-06-09*
*Last updated: 2026-06-09 — added GeoParquet sidecar (DWCA-06, EXPORT-05) after format spike*
