# Feature Research

**Domain:** Biodiversity data aggregation — provenance/attribution model for a multi-source cetacean occurrence platform
**Researched:** 2026-06-19
**Confidence:** HIGH for DwC-A attribution fields (verified against TDWG/GBIF/OBIS documentation and live aggregator datasets); MEDIUM for collection-granularity conventions (inferred from eBird/iNaturalist/Happywhale patterns, no explicit GBIF policy document found); LOW for community-channel-specific attribution (Facebook groups are not modeled in any biodiversity standard)

---

## Context: What the Ecosystem Actually Does

Research examined five real aggregators to calibrate "table stakes" vs "differentiators":

**eBird (Cornell Lab → GBIF):** One monolithic dataset per publisher. Fixed `institutionCode=CLO` on every record. `recordedBy` = observer name. Per-checklist provenance is internal, not per-collection in DwC. No per-subchannel `datasetName`.

**iNaturalist (→ GBIF, dataset key `50c9509d`):** One monolithic dataset for all research-grade observations. `institutionCode=iNaturalist`. `recordedBy` = profile display name (not username). `recordedByID` = ORCID when user has one linked. Monolithic is fine at their scale because they register as a direct publisher.

**Happywhale (→ OBIS-SEAMAP → GBIF):** Publishes dozens of separate datasets, one per species/ocean-basin combination. Each is a distinct GBIF dataset with its own EML, not a single archive with per-row `datasetName`. Contributors are listed in EML (up to 12,642 names in one dataset). `recordedBy` is populated from contributor names.

**GBIF per-record `datasetName` (released ~2024):** GBIF now supports different `datasetName` values on different rows within a single registered dataset, enabling search within aggregated datasets. This was a GBIF-side enhancement specifically to support aggregators publishing multiple sub-sources in one archive. **This validates SalishSea.io's approach.**

**DFO Maritimes Cetacean Sightings (OBIS-SEAMAP):** Aggregates from diverse sources (NGOs, fisheries observers, private consultants, whale-watchers). No per-record observer attribution — dataset-level provenance only. Records are anonymous. This is the "minimum viable" attribution bar.

**Key conclusion:** The SalishSea.io model (one archive, per-row `datasetName = "SalishSea.io — {collection}"`, fixed `institutionCode="SalishSea"`, nullable `recordedBy`) is at the upper end of what real aggregators do. No aggregator we found credits individual community channels (Facebook groups) in DwC — they're either lumped or published as separate datasets. SalishSea.io's per-collection `datasetName` is genuinely differentiating.

---

## Feature Landscape

### Table Stakes (Users and Data Consumers Expect These)

| Feature | Why Expected | Complexity | DwC Export Dependency |
|---------|--------------|------------|----------------------|
| `providers` table: four rows (iNat, Maplify, HappyWhale, Native) | Internal provenance record; required for correct backfill routing and future ingest correctness. Does NOT enter DwC. | LOW | None — internal only. |
| `collections` table: ~15 canonical rows with names, URLs, `kind` enum | Every record needs a collection assignment for per-collection `datasetName` in the export. Without this, the DwC improvement is impossible. | LOW-MEDIUM | **Direct dependency:** `dwc._maplify_occurrences` and `dwc._native_occurrences` must JOIN to collections to emit `datasetName = 'SalishSea.io — {collection.name}'`. The current hardcoded LATERAL CASE arms (`orca_network → "Orca Network"`, etc.) are replaced by this JOIN. |
| `organizations` table: nullable parent institution | Required for UI credit and EML supplementary metadata. Does not emit to `institutionCode` in DwC (that stays fixed `"SalishSea"`). | LOW | Indirect: EML `samplingProtocol` or `bibliographicCitation` at dataset level (not per-row). |
| `collection_id` FK on sightings (Maplify + native) | Required to drive per-collection `datasetName`. Without this FK, the JOIN above cannot work. | MEDIUM | **Direct dependency** on the DwC view rebuild. |
| `contributor_id` FK on sightings (all four providers) | Required to emit `recordedBy` correctly and replace the current opaque `usernm` (Maplify) and `rightsHolder = person name` (native, currently wrong). | MEDIUM | **Direct dependency on native branch:** `dwc._native_occurrences` currently emits `rightsHolder = contributor.name` — this must change to `rightsHolder = "SalishSea.io"`, `recordedBy = contributor.name`. |
| `source_url` first-class on sighting record | Required as preferred resolution signal for provider + collection. Also becomes `references` in DwC export for iNat/native records where available. | LOW-MEDIUM | Potential enhancement to `dwc._native_occurrences."references"` (currently uses `o.url`). |
| Maplify backfill: bracket tag + trailing attribution → `collection_id` | Without this, the ~5,500 Maplify records stay in a single opaque bucket. This is the primary fix the milestone exists to deliver. | MEDIUM | **Critical path** for export improvement. The LATERAL CASE arms in `dwc._maplify_occurrences` must be replaced. |
| URL-pattern registry (domain/path → provider + collection) | Required for iNat and native records where `source_url` is present. Enables future FB ingest to resolve automatically. | LOW | Indirect: drives FK population that feeds the DwC JOIN. |
| `institutionCode = "SalishSea"` on every exported row | GBIF strongly recommends `institutionCode`. Currently absent from native branch (emitting person name as rightsHolder instead) and from Maplify branch. Fixes the most embarrassing attribution error. | LOW | **Direct change to both branch views.** Native branch currently has `c.name` in `rightsHolder` and no `institutionCode`. Maplify branch has `dn.display_name` as `rightsHolder`. Both must be updated. |
| `rightsHolder = "SalishSea.io"` (fixed, not person name) | Aggregator pattern: SalishSea.io holds the rights to the dataset as publisher, not individual observers. Current native branch is wrong on this. | LOW | Same view change as above. |
| `recordedBy` = contributor name (correct term for observer) | Currently native branch uses `c.name` for both `rightsHolder` and `recordedBy` (wrong for `rightsHolder`). Maplify uses `usernm` (opaque code, not a name). After v1.3 both use real contributor names. | LOW | View change plus contributor data quality for Maplify. |
| Seed data: 4 provider rows + ~15 collection rows + associated organizations | Backfill cannot run without seed data in place. Collections are the reference dictionary for exact-match resolution. | LOW | Prerequisite for all backfill. |

### Differentiators (Above the Aggregator Norm)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-collection `datasetName` within one archive | No other cetacean aggregator of this size does this. Orca Network, Cascadia Research, TMMC, Whale Alert Global, Whale Alert Alaska each become distinct discoverable channels in GBIF search — this gives each community credit it currently lacks. GBIF added per-record `datasetName` search specifically to support this pattern. | MEDIUM | Requires collection FK + view rebuild. High payoff. |
| `collection.url` in EML `samplingProtocol` or `bibliographicCitation` | Links the exported dataset to the source community (e.g. Orca Network FB group URL, Cascadia website). Most aggregators provide this at most at dataset level, not per channel. | LOW-MEDIUM | Dataset-level EML would need to describe all channels. Per-row `bibliographicCitation` is technically possible but GBIF community discourages "different citations per record" as noisy. Recommendation: list channel URLs in EML abstract/methods rather than per-row. |
| Modeling Facebook groups as first-class collections (not "community channel" catch-all) | No DwC standard exists for this. SalishSea.io being explicit about which FB group a record came from is more attribution than any comparable aggregator provides for informal community channels. | LOW | Internal model. Not visible in DwC beyond `datasetName`. The `collections.kind = 'facebook_group'` enum value is the differentiator. |
| `source_url` as the preferred resolution signal (URL-pattern registry) | Positions the platform for automatic attribution on future ingest paths (FB post URLs, direct API imports). No backfill system currently has this architectural foundation. | MEDIUM | Pays off mainly for future ingests; Maplify rows have no source URL today so bracket parsing still required. |
| Cross-provider contributor modeling (per-provider, unification deferred) | HappyWhale has 515 contributors; iNaturalist has many hundreds. Modeling them internally even though their records don't export enables future UI credit (contributor pages, occurrence filtering by observer). Most aggregators don't do this at all for 3rd-party sources. | MEDIUM | No DwC impact this milestone. Value is internal + future. |
| `recordedByID` with ORCID/Wikidata URI | GBIF supports ORCID/Wikidata URIs in `recordedByID` for linking to Bionomia profiles. Enables automated attribution credit for researchers. | LOW-MEDIUM | Only applicable where contributor has an ORCID. For native contributors: check if any have ORCIDs. For HappyWhale/iNat: not needed (self-publish). Recommend: add `contributor.orcid` nullable column and populate manually for the 28 native contributors as a P2 differentiator. Do NOT block the milestone on this. |

### Anti-Features (Avoid These)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| `institutionCode` = upstream org (e.g. "OrcaNetwork", "Cascadia") per record | "Correct" institutional attribution — Cascadia records should say Cascadia. | **Wrong for the aggregator pattern.** `institutionCode` means "the institution with custody of this record." SalishSea.io has custody. Putting the upstream org here would confuse GBIF's identifier triplet and imply those orgs are GBIF publishers. The DFO dataset, OBIS-SEAMAP datasets, and every other aggregator use a fixed `institutionCode` for the aggregator. | Credit upstream orgs via `datasetName`, EML metadata, and `organization.url`. |
| Publishing iNat + HappyWhale records in the DwC-A | Completeness — all 21,000+ records in one export. | SRC-01: both self-publish to GBIF and would be duplicates. GBIF deduplication is imperfect; duplicate records reduce data quality globally. | Model internally for UI credit; exclude from export. SRC-01 unchanged. |
| Fuzzy or alias-based collection matching at ingest time | Robustness against tag variations. | Creates a maintenance burden (alias dictionary grows forever) and risks false positives (similar-sounding community names). The exec summary's one-time exact-match backfill + human eyeball for typos is the correct approach. | Exact-match on `collections.name` after one-time backfill. New tags handled manually by ops. |
| `collectionCode` per collection as an additional DwC field | Some aggregators use `collectionCode` for sub-source tracking alongside `datasetName`. | GBIF uses `{institutionCode, collectionCode, catalogNumber}` as a fallback triplet when `occurrenceID` is absent. SalishSea.io already has stable prefixed `occurrenceID` (`salishsea:`, `maplify:`). Adding `collectionCode` per channel risks triplet-based duplicate detection confusion and adds a column with no consumer value when `occurrenceID` is already stable. | Use only `datasetName` for collection attribution. Leave `collectionCode` absent or constant. |
| Per-row `bibliographicCitation` with channel URL | Gives explicit URL credit to each source channel in the exported record. | GBIF community explicitly discourages "different citations per record" as noisy. `bibliographicCitation` at dataset level is the standard. Per-row use is possible but would generate ~5,968 slightly different citation strings, complicating citation aggregation for researchers. | Put channel URLs in EML `methods`/`abstract`/`samplingDescription`. |
| Cross-provider contributor deduplication (e.g. unifying `jmaughn` iNat with James Maughn native) | True observer credit across all platforms. | Identity resolution across platforms requires manual curation or probabilistic matching. Open question in exec summary. Deduplication logic is complex, error-prone, and not needed for any DwC term this milestone. | Defer to a future milestone. Model per-provider this milestone; add a `canonical_contributor_id` FK later if unification is pursued. |
| Auto-creating collections on unknown bracket tags | Keeps `collection_id` fully populated without manual ops. | Creates junk collection rows for one-off tags, typos, and test data. The ~8 empty brackets and various one-offs in the Maplify data would generate noise rows. | Leave `collection_id = NULL` for unmatched tags. Ops reviews periodically and adds legitimate new collections manually. |
| Contributor pages / organization pages in the UI | Community credit surfaces as browsable pages. | Scope question: the exec summary marks UI surfaces as an open question (Q4). Adding frontend pages is a significant additional phase. The backfill + DwC export improvement is the core v1.3 work. | Seed the data model correctly; defer UI surfaces to a later phase or bundle if cheap. |

---

## Feature Dependencies

```
providers/collections/organizations tables (seed data)
    └──required by──> Maplify backfill (bracket tag → collection_id)
    └──required by──> iNat/HappyWhale/native FK population
    └──required by──> URL-pattern registry (maps domain → provider_id + collection_id)

collection_id FK on sightings
    └──required by──> dwc._maplify_occurrences datasetName JOIN (replaces LATERAL CASE)
    └──required by──> dwc._native_occurrences datasetName JOIN

contributor_id FK on sightings
    └──required by──> dwc._native_occurrences recordedBy + corrected rightsHolder
    └──required by──> dwc._maplify_occurrences recordedBy (replaces opaque usernm)

institutionCode/rightsHolder fix
    └──required by──> both branch views: schema change + new columns

Maplify backfill (bracket tag + trailing attribution parsing)
    └──depends on──> collections seed data (exact-match dictionary)
    └──required by──> production collection_id population (~5,500 rows)

source_url on sightings
    └──enhances──> URL-pattern registry (preferred resolution signal)
    └──enhances──> dwc._native_occurrences "references" (if populated from iNat URI)

recordedByID (ORCID)
    └──optional enhancement──> contributor.orcid nullable column
    └──no DwC view change needed until column exists
```

### Dependency Notes

- **Seed data is the critical prerequisite.** Nothing else can be backfilled or exported correctly until `providers`, `collections`, and `organizations` rows exist. This should be the first phase.
- **DwC view rebuild touches both branch views.** `dwc._maplify_occurrences` and `dwc._native_occurrences` both need changes: the LATERAL CASE arms go away, `institutionCode` is added as a new column, `rightsHolder` is fixed. This adds a 26th column to the UNION ALL — both branches must change in lockstep (the existing UNION ALL type-parity contract will catch any drift at migration time).
- **Column count change in dwc.occurrences.** Adding `institutionCode` (and potentially `collectionCode` if chosen) means `dwc.occurrences` gains a column. The Phase 6 DuckDB COPY pipeline reads `dwc.occurrences` by column position — `meta.xml` must be updated in sync. This is the primary DwC export dependency risk.
- **Maplify backfill is one-time, not runtime.** The backfill sets `collection_id` and `contributor_id` on existing `maplify.sightings` rows. New ingest uses the URL-pattern registry + exact-match going forward. The two flows are independent.
- **iNat + HappyWhale get FKs but do not affect the export.** Their contributor/collection/provider FKs are wired for internal UI use and future-proofing. SRC-01 exclusion means no DwC view changes for those branches.

---

## MVP Definition

### v1.3 Core (Required for Attribution Goals)

- [ ] `providers`, `collections`, `organizations` tables created with seed data (~4 providers, ~15 collections, ~8 orgs)
- [ ] `provider_id`, `collection_id`, `contributor_id`, `source_url` FKs/columns added to all four source schemas
- [ ] URL-pattern registry implemented (domain/path → provider + collection mapping)
- [ ] Maplify backfill: bracket-tag + trailing-attribution → `collection_id` (one-time, human-eyeballed dictionary)
- [ ] `dwc._native_occurrences` updated: `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, `recordedBy=contributor.name`, `datasetName='SalishSea.io — Direct'`
- [ ] `dwc._maplify_occurrences` updated: LATERAL CASE replaced by collection JOIN, `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, `datasetName='SalishSea.io — {collection.name}'`
- [ ] `meta.xml` updated for the new `institutionCode` column
- [ ] EML updated to describe collection channels in methods/abstract

### Add After Core (v1.3 if Scope Allows)

- [ ] `source_url` populated on native observations from `public.observations.url`
- [ ] `source_url` populated on iNat observations from `inaturalist.observations.uri`
- [ ] Contributor resolution for Maplify: "Submitted by [name]" extraction → `contributor_id` (where a real name is present, not just an org name)
- [ ] UI: collection name visible on occurrence card (low-cost label, not a full collection page)

### Defer (Future Milestone)

- [ ] `recordedByID` with ORCID URIs (requires `contributor.orcid` column + manual curation)
- [ ] Cross-provider contributor unification (`jmaughn` iNat = James Maughn native)
- [ ] Organization/collection detail pages in the UI
- [ ] SRC-01 reconsideration: iNat/HappyWhale in the archive

---

## DwC Export Impact Summary

The v1.3 attribution changes require these concrete changes to the existing `dwc` schema:

| Change | Affected Object | Risk |
|--------|----------------|------|
| Add `institutionCode` column | Both branch views + `dwc.occurrences` UNION | MEDIUM — adds 26th column; `meta.xml` and DuckDB COPY must update in sync |
| Fix `rightsHolder` from person name → "SalishSea.io" | `dwc._native_occurrences` | LOW — column already exists, value changes |
| Replace LATERAL CASE with collection JOIN for `datasetName` | `dwc._maplify_occurrences` | MEDIUM — JOIN requires `collection_id` FK to be populated; NULL-safe (COALESCE to "SalishSea.io — Unattributed") |
| Fix `recordedBy` from `usernm` to `contributor.name` | `dwc._maplify_occurrences` | LOW-MEDIUM — requires contributor FK population on Maplify rows |
| Change `datasetName` from single title to per-collection value | `dwc._native_occurrences` (was single title) | LOW — constant → JOIN |
| Update `dwc.datasets` row title to match new `datasetName` pattern | `dwc.datasets` view | LOW — metadata only |

**NULL safety requirement:** Records with no resolved collection (unmatched bracket tags, new ingests before collection is created) should fall back to `datasetName = 'SalishSea.io — Unattributed'` rather than NULL. NULL `datasetName` is legal in DwC but loses per-channel credit.

---

## Gaps in the Exec Summary Model — Research Findings

The exec summary's model is sound. Research surfaces two gaps not explicitly addressed:

**Gap 1: `collectionCode` vs `datasetName` — resolved in favor of `datasetName` only.**
The exec summary uses `datasetName` for collection attribution. This is correct. `collectionCode` is used by GBIF's legacy triplet-based identifier as a fallback when `occurrenceID` is absent — since SalishSea.io uses stable prefixed `occurrenceID`, adding `collectionCode` would be noise. Do not add it.

**Gap 2: `recordedByID` is a differentiator, not a table stake.**
The exec summary mentions `recordedByID` where stable. Research confirms: for community reporters (Maplify, Facebook groups), no stable identifier exists and ORCID/Wikidata URIs are the only accepted format. This is a P2 enhancement for named contributors with ORCIDs, not a v1.3 blocker. Recommend adding `contributor.orcid` (nullable) to the schema in v1.3 but populating it separately.

**Gap 3: EML update scope.**
The exec summary notes organization as supplementary EML metadata. Research confirms: channel URLs (FB group links, Cascadia website, Orca Network website) should appear in EML `methods` or `abstract`, not per-row in DwC. The existing EML in `dwc.datasets` has a single row — after v1.3, the abstract and methods sections should describe the ~10 collection channels. This is a low-complexity update but must be scheduled as part of the DwC export phase.

**Gap 4: iNaturalist granularity question (exec summary open question 2).**
Research finding: iNaturalist publishes to GBIF as one monolithic dataset — they do not expose per-project datasets. SalishSea.io therefore needs only one `collection` row for iNaturalist ("iNaturalist"), not per-project rows. Same for HappyWhale: one collection row ("HappyWhale"). Finer granularity would require per-project API queries and adds complexity with no GBIF payoff. **Recommendation: one collection per external platform (iNat, HappyWhale), not per project.**

---

## Sources

- [GBIF Data Quality Requirements — Occurrence Datasets](https://www.gbif.org/data-quality-requirements-occurrences) — HIGH (required/recommended terms)
- [Darwin Core Quick Reference Guide (TDWG)](https://dwc.tdwg.org/terms/) — HIGH (term definitions including recordedBy, recordedByID, datasetName, institutionCode)
- [GBIF Release Notes — per-record datasetName search](https://www.gbif.org/release-notes) — HIGH (GBIF added per-record datasetName search to support aggregated datasets)
- [GBIF Community Forum — identifying iNaturalist observations in GBIF](https://discourse.gbif.org/t/how-is-inaturalist-data-identified/4240) — MEDIUM (six publishers use institutionCode=iNaturalist; eight separate datasetName values)
- [GBIF Community Forum — iNaturalist author attribution in downloads](https://discourse.gbif.org/t/identifying-authors-of-inaturalist-observations-within-gbif-download-data/4258) — MEDIUM (recordedBy = profile display name, not username; rightsHolder most reliable field)
- [TDWG People in Biodiversity Data — recordedByID](https://www.tdwg.org/community/attribution/people/) — HIGH (ORCID + Wikidata URI format; pipe-separated; no order semantics; Agent Actions extension in development)
- [GBIF Community Forum — bibliographicCitation usage](https://discourse.gbif.org/t/confused-about-bibliographiccitation-youre-not-alone/3945) — HIGH (per-row different citations discouraged; dataset-level citation preferred)
- [GBIF — Happywhale North Pacific right whale dataset](https://www.gbif.org/dataset/25da6d17-16b7-42d8-974c-dcae5cf038b1) — MEDIUM (Happywhale publishes per species/basin, not one archive; contributors listed in EML)
- [OBIS-SEAMAP — DFO Maritimes Region Cetacean Sightings](https://seamap.env.duke.edu/dataset/1144/html) — MEDIUM (aggregated multi-source dataset; no per-record observer attribution; dataset-level provenance only)
- [OBIS Darwin Core Manual](https://manual.obis.org/darwin_core.html) — MEDIUM (recordedBy: list of names; institutionCode: custodian institute acronym)
- [eBird on GBIF — institutionCode=CLO](https://www.gbif.org/news/82357/ebird-update-pushes-records-in-gbif-over-500-million) — HIGH (fixed institutionCode for aggregator, recordedBy = observer name, one monolithic dataset)

---
*Feature research for: v1.3 Providers, Collections & Contributors attribution model*
*Researched: 2026-06-19*
