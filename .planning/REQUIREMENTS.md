# v1.3 Requirements — Providers, Collections & Contributors

*Milestone goal: formalize the provenance graph (provider · collection · organization · contributor) across all four ingest providers so attribution is correct internally and in the DarwinCore Archive export. See [v1.3-EXECUTIVE-SUMMARY.md](v1.3-EXECUTIVE-SUMMARY.md) and [research/SUMMARY.md](research/SUMMARY.md).*

This is a backend / data-model / export milestone — no app UI surfaces (deferred).

## v1.3 Requirements

### Provenance Model (reference tables + seed)

- [x] **PROV-01**: A `providers` reference table exists, seeded with the four ingest providers (Direct, Maplify, iNaturalist, HappyWhale), with explicit SELECT grants
- [x] **ORG-01**: An `organizations` reference table exists (name, url, rights-holder text), seeded with the parent institutions behind known channels (e.g. Orca Network, Cascadia Research Collective, The Marine Mammal Center)
- [x] **COLL-01**: A `collections` reference table exists with a `kind` enum (`facebook_group`, `research_dataset`, `acoustic_feed`, `detector`, `direct_app` — no `aggregator_ingest`) and a nullable `organization_id` FK, seeded with the ~15 canonical collections
- [x] **CONTRIB-01**: Contributors are modeled on the existing `public.contributors` table and referenceable from every provider's records (per-provider; no cross-provider merge this milestone)
- [x] **CONTRIB-02**: `public.contributors` has a nullable `orcid` column, and the export emits `recordedByID` when an ORCID is present (values populated later)

### Per-Sighting Linkage

- [x] **LINK-01**: Each source schema's records (native `public.observations`, `maplify.sightings`, `inaturalist.observations`, `happywhale.encounters`) carry nullable `provider_id`, `collection_id`, `contributor_id`, and `source_url` columns; `collection_id` is indexed
- [x] **LINK-02**: Records inserted after deploy resolve a `collection_id`; the not-null/required constraint is applied only after the one-time backfill completes (nullable → backfill → constrain)
- [x] **LINK-03**: `source_url` is populated from each provider's existing record URL where available (iNaturalist `uri`, native `public.observations.url`)

### Resolution & Backfill

- [ ] **RESOLVE-01**: A URL-pattern resolver derives `provider_id` + `collection_id` from a `source_url` (domain/path registry), runs at ingest time, and stores the result as FKs (not at query time)
- [ ] **RESOLVE-02**: Maplify collection resolution uses a human-curated exact-match dictionary over the precedence order `source_url` → leading bracket tag → trailing "Submitted by … Trusted Observer" attribution → structured `maplify.sightings.source` code; trailing attributions yield a collection/org only, never a contributor; `comments` is left untouched (tags stripped in-view, never by UPDATE)
- [ ] **RESOLVE-03**: A one-time, idempotent backfill populates the linkage FKs for existing records across all four providers, preceded by a full `SELECT DISTINCT` census of bracket-tag variants; `comments` preserved verbatim
- [ ] **RESOLVE-04**: Ongoing ingest resolves `collection_id` by exact match; unmatched tags resolve to NULL (no auto-create, no fuzzy match, no alias table)

### DwC Attribution Export

- [x] **ATTR-01**: Exported occurrence records (native + Maplify) carry `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, and `recordedBy` from the contributor — replacing today's per-person `rightsHolder` and opaque source codes
- [x] **ATTR-02**: `datasetName` is per-collection (`"SalishSea.io — {collection}"`) for exported records, replacing the single "Whale Alert / Maplify" bucket
- [x] **ATTR-03**: iNaturalist and HappyWhale remain excluded from the archive **by construction** (SRC-01); a row-count gate in the nightly job fails if exported rows exceed the native + Maplify baseline
- [ ] **ATTR-04**: Upstream organizations surface in the archive's EML as `associatedParty` — never as `institutionCode`
- [ ] **ATTR-05**: The regenerated archive passes the GBIF DwC-A validator with no blocking/structural errors and no attribution regressions (field-list ↔ view ↔ `meta.xml` parity intact, `npm test` green)

## Future Requirements (deferred)

- **UI surfaces** — organization / collection browse + credit pages in the app (separate frontend phase once the graph is solid)
- **Cross-provider contributor unification** — a `contributor_links` table to merge identities across providers (the `jmaughn` ≈ James Maughn case)
- **URL → whole-occurrence importer** (source_url Layer 2) — seeded at [seeds/url-to-occurrence-importer.md](seeds/url-to-occurrence-importer.md)
- **Populate contributor ORCIDs** for native contributors (CONTRIB-02 ships the column; data entry is later)
- **`coordinateUncertaintyInMeters`** population from per-source accuracy fields (separate todo — data-derivation, not attribution)
- **EML resource-contacts enrichment** (`RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`) — separate DWCA-05 follow-up todo

## Out of Scope

| Item | Reason |
|------|--------|
| Exporting iNaturalist / HappyWhale to the DwC-A | They self-publish to GBIF; re-exporting would duplicate records (SRC-01 stands) |
| Direct partner *write* ingest (OrcaSound, HappyWhale push) | Separate ingest path; gated on partner resourcing — seeded at [seeds/orcasound-happywhale-direct-ingest.md](seeds/orcasound-happywhale-direct-ingest.md) |
| Retiring Maplify | Depends on direct-ingest coverage first |
| Fuzzy matching / alias table for collection resolution | Exact-match + human-curated dictionary only; avoids a perpetual alias-maintenance surface |
| Trust-tier / data-quality scoring on collections | Out of attribution scope |
| App UI org/collection pages | Deferred to a later frontend phase |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROV-01 | Phase 9 | Complete |
| ORG-01 | Phase 9 | Complete |
| COLL-01 | Phase 9 | Complete |
| CONTRIB-01 | Phase 9 | Complete |
| CONTRIB-02 | Phase 9 | Complete |
| LINK-01 | Phase 10 | Complete |
| LINK-02 | Phase 10 | Complete |
| LINK-03 | Phase 10 | Complete |
| RESOLVE-01 | Phase 11 | Pending |
| RESOLVE-02 | Phase 11 | Pending |
| RESOLVE-03 | Phase 11 | Pending |
| RESOLVE-04 | Phase 11 | Pending |
| ATTR-01 | Phase 12 | Complete |
| ATTR-02 | Phase 12 | Complete |
| ATTR-03 | Phase 12 | Complete |
| ATTR-04 | Phase 12 | Pending |
| ATTR-05 | Phase 13 | Pending |
