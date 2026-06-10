# Feature Research

**Domain:** Biodiversity data publishing — DarwinCore Archive (DwC-A) export for a cetacean occurrence platform
**Researched:** 2026-06-09
**Confidence:** HIGH (DwC-A structure, GBIF required terms, Multimedia extension verified against TDWG/GBIF docs; ResourceRelationship indexing status MEDIUM)

## How a DwC-A Works as a Deliverable

A DarwinCore Archive is a **single ZIP (or tar.gz)** bundling a small set of files. It is a self-describing, star-schema dataset: one **core** table plus zero or more **extension** tables that join to the core by a shared record key. For this milestone the core is an **Occurrence** core. The archive contains:

| File | Required? | Role |
|------|-----------|------|
| `meta.xml` | Yes (when extensions or non-standard column names are present) | The descriptor. Maps every column position in each data file to a DwC term URI; declares the core `rowType`, field delimiter, line terminator, encoding, header-row count, and the `id`/`coreId` join between core and extensions. |
| `occurrence.txt` (name is free) | Yes | The core data file. Tab- or comma-delimited, one occurrence per line, UTF-8. First column is the record id used as the join key. |
| `multimedia.txt` (name is free) | Optional | Extension data file. One row per photo; each row carries the `coreId` pointing back to its occurrence (many rows per occurrence). |
| `eml.xml` | Strongly expected | GBIF-profile EML (Ecological Metadata Language). Dataset-level metadata: title, abstract, creators/contacts, license, citation, methods, geographic/temporal coverage. Referenced from `meta.xml` via the `metadata=` attribute. |

"Good" = a consumer can unzip it, read `meta.xml`, and load every file with no out-of-band knowledge. The archive validates against the GBIF DwC-A validator, every mapped column resolves to a real DwC term URI, the join keys are intact, and `eml.xml` carries a machine-readable license and citation. A download-only first cut does **not** need a DOI, an IPT, or GBIF registration — but emitting valid `meta.xml` + EML keeps that path open for free later.

## Feature Landscape

### Table Stakes (A Consumer Expects These)

These are the GBIF-required-or-strongly-recommended Occurrence terms. Missing the required four makes the archive unpublishable and effectively useless to a researcher. Each row notes the **existing `public.occurrences` field it maps from**.

| DwC Term | Maps From (existing field) | Why Expected | Complexity | Notes / Gaps |
|----------|---------------------------|--------------|------------|--------------|
| `occurrenceID` | source-prefixed `id` (e.g. `salishsea:1234`) | **GBIF-required.** Stable global key; must never change for a given occurrence. | LOW | Existing prefixed id is ideal. Document the URI scheme. |
| `basisOfRecord` | derived per source | **GBIF-required.** Controlled vocab. | LOW | Native + Maplify/Whale Alert sightings = `HumanObservation`. Use `MachineObservation` only for automated/sensor detections — Whale Alert app reports are human, so `HumanObservation` is almost always correct. **Gap: needs a per-source mapping decision.** |
| `scientificName` | `taxon.scientific_name` | **GBIF-required.** Lowest-rank name available, authorship optional. | LOW | iNaturalist-derived taxa give clean binomials. |
| `eventDate` | `observed_at` (timestamptz) | **GBIF-required.** ISO 8601-1:2019. | LOW | Emit as ISO 8601 with offset, e.g. `2026-03-30T18:25:47-07:00`. Keep timezone — researchers need local diel timing. |
| `decimalLatitude` / `decimalLongitude` | `location` (lon/lat) | Strongly recommended; the whole point of a sightings dataset. | LOW | Already WGS84. |
| `geodeticDatum` | constant `WGS84` (or EPSG:4326) | Strongly recommended; coordinates are meaningless without it. | LOW | Constant literal. |
| `coordinateUncertaintyInMeters` | `positional_accuracy` (meters) | Strongly recommended. **Zero is invalid per GBIF.** | LOW | Map null → omit, 0 → omit (not 0). **Gap: Maplify/Whale Alert may lack accuracy — leave blank rather than guess.** |
| `taxonRank` | `taxon.rank` | Strongly recommended; disambiguates `scientificName`. | LOW | Direct map (species/genus/etc.). |
| `kingdom`, `phylum`, `class`, `order`, `family`, `genus` | walk `taxa` parent hierarchy | Strongly recommended; powers taxonomic matching, prevents homonym ambiguity. | MEDIUM | Requires recursive walk of the `taxa` parent chain to fill each Linnaean rank column. `kingdom` (Animalia) is the highest-value one for GBIF matching. **Gap: walk logic + handling missing intermediate ranks.** |
| `individualCount` | `count` | Expected for sightings; how many animals seen. | LOW | Null → omit. |
| `occurrenceStatus` | constant `present` | Expected. Controlled vocab `present`/`absent`. | LOW | All sightings are `present` (this is presence-only data, no absence records). Constant literal. |
| `recordedBy` | `attribution` ("username on source") | Expected; who observed it. | LOW | Existing attribution string works; consider stripping " on source" or keeping as-is. |
| `license` | per-occurrence or dataset default | Expected; consumers must know reuse terms. | LOW–MEDIUM | Must be a **license URI** (e.g. `http://creativecommons.org/licenses/by/4.0/`), not a code. Photos carry per-item licenses; the **occurrence record** itself needs a license too. **Gap: decide the occurrence-record license (often CC-BY 4.0 or CC0) vs. inheriting from photos.** |
| `associatedMedia` | `photos[].src` | Lightweight media linkage when not using the Multimedia extension. | LOW | Redundant if the Multimedia extension is included; pick one (extension preferred). |

### Differentiators (Raise the Dataset's Quality / Reach)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Simple Multimedia extension** (`gbif/1.0/multimedia`) | First-class, structured photo metadata with per-image license/attribution — far richer than a delimited `associatedMedia` string. The natural home for your `photos[]` array. | MEDIUM | One extension row per photo, joined by `coreId`. Field mapping below. **Strongly recommended over `associatedMedia`** for an image-rich whale dataset. |
| `rightsHolder` | Names the entity owning rights (per photo and/or dataset). | LOW | Photo `attribution` → `rightsHolder`; dataset-level holder in EML. |
| `references` (occurrence) | Direct link back to the SalishSea.io occurrence page (your `url`). | LOW | Drives traffic and lets researchers verify provenance. High value, near-zero cost. |
| `behavior` / `dynamicProperties` | Travel direction doesn't have a clean core term; `dynamicProperties` (JSON) or `behavior` can carry it. | LOW | Map `travel direction` → `dynamicProperties` as `{"travelDirection":"..."}` or to `behavior`. Avoids data loss. |
| Rich **EML** (methods, coverage, citation, contacts) | Turns a file dump into a citable dataset; prerequisite for later DOI/GBIF. | MEDIUM | Write once, regenerate nightly with updated record counts/date range. |
| `countryCode` | GBIF-required *for GBIF publishing*; cheap to add. | LOW | Salish Sea spans US/CA — derive from coordinates or omit until registration. Not needed for download-only. |

### Anti-Features (Over-Engineering for a Download-Only First Cut)

| Feature | Why Requested | Why Problematic Now | Alternative |
|---------|---------------|---------------------|-------------|
| **ResourceRelationship extension for travel segments** | DwC's "correct" way to link occurrences into a same-individual/same-group track; matches the app's travel-segment concept. | GBIF **does not yet index or cluster on** ResourceRelationship or `associatedOccurrences` — it's defined and "future-expected" but inert in current pipelines. The extension generates verbose, complex rows and the milestone explicitly **defers individual linkage**. High effort, ~zero consumer payoff today. | Defer. If segment linkage is wanted cheaply, stuff a group/segment id into `dynamicProperties` or `associatedOccurrences` as a flat string. Revisit ResourceRelationship when `organismID` linkage lands. |
| **organismID / Organism core or relationships** | Individual whale IDs (T065S) are regex-extractable now. | Milestone explicitly defers formal individual linkage; emitting half-linked `organismID`s creates a data-integrity liability. | Optionally surface the raw extracted identifier in `dynamicProperties` (e.g. `{"catalogID":"T065S"}`) as a non-authoritative hint, clearly not an `organismID`. |
| **GBIF/OBIS registration, DOI, IPT hosting** | "Real" datasets are registered. | Scope says download-only; registration adds org accounts, endorsement, DwC validator gating, and a deployment surface. | Emit valid `meta.xml` + EML so registration is a later config step, not a rebuild. "Reachable by design," per PROJECT.md. |
| **Audubon Core full media-description extension** | More media fields than Simple Multimedia. | Overkill; the 14-field Simple Multimedia extension already covers URL + attribution + license + type cleanly and is the GBIF-indexed one. | Use Simple Multimedia. |
| **Sampling-event core / `eventID` structure** | Models survey effort. | This is opportunistic presence-only sighting data, not structured sampling — an Occurrence core is correct. | Occurrence core, no event structure. |
| **Synthesizing missing `coordinateUncertaintyInMeters`** | Fill blanks so every row looks complete. | Fabricated precision misleads researchers; `0` is explicitly invalid in GBIF. | Leave blank when unknown. Honest nulls beat invented numbers. |

## Simple Multimedia Extension — Field Mapping

`rowType: http://rs.gbif.org/terms/1.0/Multimedia`. One row per photo, joined to the occurrence by `coreId`. Your `photos[]` items (src/thumb URL, attribution, mimetype, license code) map as:

| Multimedia term | Maps From | Notes |
|-----------------|-----------|-------|
| `type` | constant `StillImage` | Controlled (`StillImage`/`Sound`/`MovingImage`). All photos = `StillImage`. |
| `format` | photo `mimetype` | IANA media type, e.g. `image/jpeg`. |
| `identifier` | photo `src` | **Direct URL to the image file**, not the webpage. |
| `references` | occurrence `url` (or thumb landing) | The HTML page showing the image/metadata, for attribution. |
| `title` | optional | Hyperlink text; can be omitted or derived. |
| `license` | photo `license` code → **license URI** | Convert `cc0`→`https://creativecommons.org/publicdomain/zero/1.0/`, `cc-by`→`.../licenses/by/4.0/`, etc. **Gap: code→URI mapping table needed.** |
| `rightsHolder` | photo `attribution` | Owner of the image. |
| `creator` | photo `attribution` | Person who took it (may equal rightsHolder). |
| `created` | `observed_at` (fallback) | True capture time if available, else observation time. |
| `publisher` | constant `SalishSea.io` | Entity making the image available. |

`thumb` URL has no dedicated DwC term — omit, or note in `description`. Don't invent terms for it.

## Controlled Vocabularies That Matter

- **`basisOfRecord`**: `HumanObservation` (sightings — almost all records), `MachineObservation` (automated sensor detections only). Other values (`PreservedSpecimen`, `FossilSpecimen`, `LivingSpecimen`, `MaterialEntity`) are irrelevant here.
- **`occurrenceStatus`**: `present` | `absent`. This dataset is presence-only → constant `present`.
- **`type` (Multimedia)**: `StillImage` | `Sound` | `MovingImage` → constant `StillImage`.
- **`license`**: must be a **resolvable URI**, not a short code. Use Creative Commons URIs (`CC0 1.0`, `CC-BY 4.0`, etc.). GBIF only fully accepts `CC0`, `CC-BY`, and `CC-BY-NC` at the **dataset** level; per-item photo licenses can be any CC URI. **Gap: map your `cc0/cc-by/...` codes to canonical CC URIs.**
- **`geodeticDatum`**: `WGS84` (or `EPSG:4326`) — constant.
- **`taxonRank`**: lowercase DwC convention (`species`, `genus`, …) — verify your `taxa.rank` values match.

## Feature Dependencies

```
Valid DwC-A ZIP
    └──requires──> meta.xml descriptor (maps columns → DwC term URIs, declares joins)
                       └──requires──> Occurrence core file (the 4 required terms + id key)
    └──requires──> eml.xml (dataset metadata + license + citation)

Multimedia extension
    └──requires──> coreId join key shared with Occurrence core
    └──requires──> license code → CC URI mapping table
    └──requires──> per-photo data already in photos[]  ✓ exists

kingdom..genus columns
    └──requires──> recursive walk of taxa parent hierarchy

license (occurrence + photo) ──requires──> code→URI mapping
travelDirection / catalogID ──enhances──> dynamicProperties (lossless carry-through)

ResourceRelationship (travel segments) ──conflicts──> "defer individual linkage" scope + not GBIF-indexed
```

### Dependency Notes

- **meta.xml is the linchpin:** every other file's columns are meaningless without it. Build it from a single declarative column→term mapping so the core writer and descriptor never drift.
- **kingdom..genus depends on the taxa walk:** this is the one MEDIUM-complexity data task; everything else is near-direct field mapping. Flag it as the most likely place for bugs (missing ranks, broken parent chains).
- **License appears twice:** once on the occurrence record, once per photo. Both need the same code→URI converter. Centralize it.
- **ResourceRelationship conflicts with milestone scope:** it presupposes the deferred individual/segment linkage and yields no GBIF benefit today.

## MVP Definition

### Launch With (v1.2)

- [ ] Occurrence core with the 4 GBIF-required terms — `occurrenceID`, `basisOfRecord`, `scientificName`, `eventDate` — non-negotiable.
- [ ] Spatial block — `decimalLatitude`, `decimalLongitude`, `geodeticDatum`, `coordinateUncertaintyInMeters` (blank when unknown).
- [ ] Taxonomy block — `taxonRank`, `kingdom`, `phylum`, `class`, `order`, `family`, `genus` via taxa-hierarchy walk.
- [ ] `individualCount`, `occurrenceStatus=present`, `recordedBy`, `references` (occurrence url).
- [ ] `license` (occurrence) + `rightsHolder` as proper CC URIs.
- [ ] Valid `meta.xml` descriptor and GBIF-profile `eml.xml`.
- [ ] Simple Multimedia extension for photos (preferred over `associatedMedia`).
- [ ] Nightly regeneration + hosted download.

### Add After Validation (later)

- [ ] `travelDirection` / extracted `catalogID` via `dynamicProperties` — lossless, low cost, can slip to launch if cheap.
- [ ] `countryCode` — add when GBIF registration is on the table.
- [ ] DwC-A validator run in CI against the nightly output.

### Future Consideration (v2+ / other milestones)

- [ ] `organismID` + individual-animal linkage (separate milestone).
- [ ] ResourceRelationship for travel segments — only after individual linkage exists AND GBIF begins indexing it.
- [ ] GBIF/OBIS registration + DOI.

## Feature Prioritization Matrix

| Feature | Consumer Value | Implementation Cost | Priority |
|---------|----------------|---------------------|----------|
| 4 required terms + valid meta.xml/EML | HIGH | LOW–MEDIUM | P1 |
| Spatial block (lat/lon/datum/uncertainty) | HIGH | LOW | P1 |
| Taxonomy block (kingdom..genus walk) | HIGH | MEDIUM | P1 |
| Simple Multimedia extension | HIGH | MEDIUM | P1 |
| license/rightsHolder as CC URIs | HIGH | LOW–MEDIUM | P1 |
| references / recordedBy / individualCount / occurrenceStatus | MEDIUM | LOW | P1 |
| travelDirection + catalogID via dynamicProperties | MEDIUM | LOW | P2 |
| countryCode | LOW (download-only) | LOW | P3 |
| DwC-A validator in CI | MEDIUM | LOW | P2 |
| ResourceRelationship (travel segments) | LOW (not indexed) | HIGH | P3 |
| GBIF/OBIS registration + DOI | MEDIUM (later) | HIGH | P3 |

## Gaps Flagged for Requirements Author

Where the existing model has no clean source for a table-stakes term — each becomes a requirement:

1. **`basisOfRecord` per source** — no field exists; needs an explicit source→value map (native/Maplify/Whale Alert all likely `HumanObservation`; confirm none are sensor-derived).
2. **`coordinateUncertaintyInMeters` for Maplify/Whale Alert** — may be absent; rule: emit blank, never `0`, never invented.
3. **`kingdom..genus` walk** — recursive traversal of `taxa.parent`; handle missing intermediate ranks and ensure DwC-spelled rank values.
4. **`license` code → CC URI mapping** — both occurrence-record license and per-photo `cc0/cc-by/...` codes; one shared converter.
5. **Occurrence-record license decision** — distinct from photo licenses; pick dataset default (CC-BY 4.0 or CC0).
6. **`travelDirection` has no core term** — decide `dynamicProperties` vs `behavior` to avoid data loss.
7. **`attribution` formatting for `recordedBy`/`creator`** — keep "username on source" or normalize.
8. **`thumb` URL** — no DwC home; confirm it's acceptable to drop.

## Sources

- [Darwin Core Archives – How-to Guide (GBIF IPT Manual)](https://ipt.gbif.org/manual/en/ipt/latest/dwca-guide) — HIGH (DwC-A structure)
- [Darwin Core Quick Reference Guide (TDWG)](https://dwc.tdwg.org/terms/) — HIGH (term definitions, controlled vocabs)
- [GBIF Simple Multimedia extension schema](https://rs.gbif.org/extension/gbif/1.0/multimedia.xml) — HIGH (14 multimedia fields)
- [GBIF Data quality recommendations (techdocs)](https://techdocs.gbif.org/en/data-publishing/data-quality-recommendations) — HIGH (required vs recommended terms)
- [GBIF IPT Manual — Occurrence Data](https://ipt.gbif.org/manual/en/ipt/latest/occurrence-data) — HIGH
- [GBIF Registered Extensions](https://rs.gbif.org/extensions.html) — HIGH (extension catalog)
- [GBIF Occurrence clustering / ResourceRelationship status](https://techdocs.gbif.org/en/data-processing/clustering-occurrences) — MEDIUM (ResourceRelationship/associatedOccurrences not yet indexed)
- [Vector data publishing guide (ResourceRelationship use cases)](https://docs.gbif.org/vector-guide-to-data-publishing/en/) — MEDIUM

---
*Feature research for: DarwinCore Archive export (cetacean occurrence data)*
*Researched: 2026-06-09*
