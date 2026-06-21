# Roadmap: SalishSea.io

## Milestones

- ✅ **v1.0 Link Shareability** — Phases 1-2 (shipped 2026-04-17)
- ✅ **v1.1 Partner Org Links** — Phase 3 (shipped 2026-04-18)
- ✅ **v1.2 Export to DarwinCore Archive** — Phases 4-8 (shipped 2026-06-18) — see [.planning/milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- 📋 **v1.3 Providers, Collections & Contributors** — Phases 9-13 (in planning)

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

<details>
<summary>✅ v1.2 Export to DarwinCore Archive (Phases 4-8) — SHIPPED 2026-06-18</summary>

- [x] Phase 4: Rights & Data-Model Policy (1/1 plan) — completed 2026-06-10
- [x] Phase 5: DB Projection (`dwc` schema) (4/4 plans) — completed 2026-06-17
- [x] Phase 6: Archive Generation (6/6 plans) — completed 2026-06-18
- [x] Phase 7: Nightly Workflow & Hosting (3/3 plans) — completed 2026-06-18
- [x] Phase 8: Frontend Download Link (2/2 plans) — completed 2026-06-18

Full milestone details: [.planning/milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

### 📋 v1.3 — Providers, Collections & Contributors

- [x] **Phase 9: Reference Table Foundation** — Create `providers`, `organizations`, `collections` tables with seed data and RLS read policies (completed 2026-06-19)
- [x] **Phase 10: Source Table FK Columns** — Add nullable `provider_id`, `collection_id`, `contributor_id`, `source_url` to all four source tables (completed 2026-06-19)
- [x] **Phase 11: Resolution & Backfill** — URL-pattern resolver + Maplify bracket-tag/attribution backfill + all-provider FK population (completed 2026-06-21)
- [x] **Phase 12: DwC View Rebuild** — 26-column coordinated change: branch views + UNION + fields.ts + meta.xml + EML + row-count gate (completed 2026-06-21)
- [ ] **Phase 13: Verification & GBIF Re-validation** — End-to-end "Looks Done But Isn't" checklist + GBIF validator re-run

## Backlog

Candidate phases not yet assigned to a milestone. Promote with `/gsd-review-backlog`.

*(Backlog item 999.1 Collections and Contributors promoted into v1.3 Phases 9-13.)*

### Phase 999.2: ingest in-region Orca sightings from GBIF (BACKLOG)

**Goal:** [Captured for future planning] — pull occurrence records for Salish Sea cetaceans that already live in GBIF (e.g. from datasets we don't otherwise ingest) and surface the in-region ones on the platform. Note v1.3 context: iNaturalist + HappyWhale are deliberately export-*excluded* from our DwC-A because they self-publish to GBIF — an inbound GBIF ingest is the mirror-image idea and must avoid re-importing our own contributed records (provenance/dedup against provider+source_url).
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Occurrence Links | v1.0 | 2/2 | Complete | 2026-03-04 |
| 2. Rich Previews | v1.0 | 5/5 | Complete | 2026-04-17 |
| 3. Partner Org Hyperlinking | v1.1 | 2/2 | Complete | 2026-04-18 |
| 4. Rights & Data-Model Policy | v1.2 | 1/1 | Complete | 2026-06-10 |
| 5. DB Projection (`dwc` schema) | v1.2 | 4/4 | Complete | 2026-06-17 |
| 6. Archive Generation | v1.2 | 6/6 | Complete | 2026-06-18 |
| 7. Nightly Workflow & Hosting | v1.2 | 3/3 | Complete | 2026-06-18 |
| 8. Frontend Download Link | v1.2 | 2/2 | Complete | 2026-06-18 |
| 9. Reference Table Foundation | v1.3 | 1/1 | Complete    | 2026-06-19 |
| 10. Source Table FK Columns | v1.3 | 1/1 | Complete    | 2026-06-19 |
| 11. Resolution & Backfill | v1.3 | 4/4 | Complete   | 2026-06-21 |
| 12. DwC View Rebuild | v1.3 | 3/3 | Complete    | 2026-06-21 |
| 13. Verification & GBIF Re-validation | v1.3 | 2/3 | In Progress|  |

## Phase Details

### Phase 9: Reference Table Foundation

**Goal**: The provenance graph's reference tables exist, are seeded with canonical data, and are readable by all consumers — unblocking every FK addition and backfill that follows
**Depends on**: Nothing (first v1.3 phase; builds on shipped v1.2 schema)
**Requirements**: PROV-01, ORG-01, COLL-01, CONTRIB-01, CONTRIB-02
**Success Criteria** (what must be TRUE):

  1. `SELECT * FROM providers` returns exactly four rows (Direct, Maplify, iNaturalist, HappyWhale); `SET ROLE anon; SELECT COUNT(*) FROM providers` returns > 0 (SELECT grant confirmed)
  2. `SELECT * FROM organizations` returns the parent institutions (Orca Network, Cascadia Research Collective, The Marine Mammal Center, etc.) with non-null `url`; same anon-role smoke test passes
  3. `SELECT * FROM collections` returns ~15 canonical collections with correct `kind` enum values; `aggregator_ingest` is absent from the enum by construction; same anon-role smoke test passes
  4. `SELECT column_name FROM information_schema.columns WHERE table_name = 'contributors' AND column_name = 'orcid'` returns one row (nullable `orcid` column exists on `public.contributors`)
  5. `public.contributors` rows are referenced from all four source schemas without a cross-provider merge (per-provider model intact; no shared contributor_id across providers)**Plans**: 1 plan
- [x] 09-01-PLAN.md — Reference-tables migration (collection_kind enum + providers/organizations/collections + RLS SELECT policies + nullable contributors.orcid + idempotent seed) and the 09_reference_assertions.sql gate

### Phase 10: Source Table FK Columns

**Goal**: Every source table carries nullable `provider_id`, `collection_id`, `contributor_id`, and `source_url` columns — ready to receive backfill, with `collection_id` indexed on exported tables
**Depends on**: Phase 9 (FK targets must exist before columns can reference them)
**Requirements**: LINK-01, LINK-02, LINK-03
**Success Criteria** (what must be TRUE):

  1. `\d public.observations`, `\d maplify.sightings`, `\d inaturalist.observations`, `\d happywhale.encounters` each show `provider_id`, `collection_id`, `contributor_id`, `source_url` columns; all are nullable
  2. `collection_id` has an index on `public.observations` and `maplify.sightings` (the two exported tables); confirmed via `\d` or `pg_indexes`
  3. `public.observations.source_url` is populated from `public.observations.url` for rows where `url IS NOT NULL`; `inaturalist.observations.source_url` is populated from `inaturalist.observations.uri` for all rows
  4. New Maplify ingest with no matching collection inserts successfully (collection_id nullable — no NOT NULL constraint applied yet); existing row counts are unchanged

**Plans**: 1 plan

- [x] 10-01-PLAN.md — Additive FK-column migration (provider_id/collection_id/contributor_id/source_url on all four source tables, partial collection_id index on the two exported tables, slug-resolved provider_id default, generated source_url incl. repo-canonical HappyWhale URL) and the 10_fk_columns_assertions.sql SC#1-SC#4 gate

### Phase 11: Resolution & Backfill

**Goal**: All four source tables have their provider/collection/contributor FKs populated for existing records — established via a full `SELECT DISTINCT` bracket-tag census, a human-verified exact-match dictionary, and a URL-pattern resolver — with `comments` preserved verbatim throughout
**Depends on**: Phase 10 (FK columns must exist); Phase 9 (seed data must be present for FKs to resolve)
**Requirements**: RESOLVE-01, RESOLVE-02, RESOLVE-03, RESOLVE-04
**Success Criteria** (what must be TRUE):

  1. `SELECT COUNT(*) FROM maplify.sightings WHERE comments ~ '^\[' AND collection_id IS NULL` returns 0 (all bracket-tagged rows resolved); `SELECT COUNT(*) FROM maplify.sightings WHERE comments ~ 'Trusted Observer' AND collection_id IS NULL` returns 0 or a documented known-unresolved count
  2. `comments` column is bit-for-bit unchanged after backfill: no UPDATE on `maplify.sightings.comments` appears in any migration or script; bracket tags and trailing attributions are still present in the column
  3. `SELECT COUNT(*) FROM maplify.sightings WHERE contributor_id IS NOT NULL AND comments ~ 'Trusted Observer'` returns 0 (trailing "Submitted by … Trusted Observer" lines yielded collection/org only, never contributor)
  4. `scripts/ingest/resolve-provider.ts` URL-pattern resolver exists as a pure function; `inaturalist.observations` and `public.observations` rows with valid URLs have `provider_id` and `collection_id` set; HappyWhale encounter rows have `provider_id` set
  5. Unmatched bracket tags resolve to NULL (no auto-create, no fuzzy match); ongoing ingest path for new records uses the resolver at ingest time

**Plans**: 4 plans
**Wave 1**

- [x] 11-01-PLAN.md — Pure TS URL-pattern resolver `scripts/ingest/resolve-provider.ts` + vitest (RESOLVE-01)
- [x] 11-02-PLAN.md — Read-only prod bracket-tag/attribution/source census + [BLOCKING] human-verify of acronym expansions (RESOLVE-03 precondition)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 11-03-PLAN.md — Resolution schema migration: collection_rule table + resolve_collection fn + collection_id DEFAULTs + inat_login + mint_contributor (SECURITY DEFINER) + acronym backfill + assertion snippet (RESOLVE-02/04)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 11-04-PLAN.md — Idempotent backfill UPDATEs (all four providers + iNat contributor) + live ingest-function edits (update_sightings, iNat MERGE) + [BLOCKING] supabase db push + prod diff-gate (RESOLVE-03/04)

### Phase 12: DwC View Rebuild

**Goal**: The `dwc.occurrences` view emits 26 columns with correct aggregator-pattern attribution — `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, per-collection `datasetName` — with SRC-01 exclusion preserved by construction, `npm test` green, and the nightly row-count guard in place
**Depends on**: Phase 11 (collection FKs must be populated for JOINs to return meaningful values); Phase 10 (FK columns referenced by the rebuilt views)
**Requirements**: ATTR-01, ATTR-02, ATTR-03, ATTR-04
**Success Criteria** (what must be TRUE):

  1. `SELECT DISTINCT "institutionCode" FROM dwc.occurrences` returns exactly `{'SalishSea'}` — no upstream org codes, no NULLs
  2. `SELECT DISTINCT "rightsHolder" FROM dwc.occurrences` returns exactly `{'SalishSea.io'}` — no contributor names, no org names, no opaque source-bucket names
  3. `SELECT DISTINCT "datasetName" FROM dwc.occurrences` returns ~10+ distinct values, all prefixed `'SalishSea.io — '`; `recordedBy` on Maplify rows reflects contributor name via FK join (not opaque codes like `whalealertoa`)
  4. `npm test` (including `fields.test.ts`) passes green: `OCCURRENCE_FIELDS.length === 26`, `assertFieldAlignment` confirms view column order matches the TS array; `meta.xml` output declares 26 fields in correct ordinal order
  5. `SELECT COUNT(*) FROM dwc.occurrences` does not exceed the sum of `public.observations` + filtered `maplify.sightings` row counts (SRC-01 row-count gate passes; iNat and HappyWhale rows absent by construction); the nightly job guard enforces this gate

**Plans**: 3 plans
**Wave 1**

- [x] 12-01-PLAN.md — D-03 prod census of trusted Maplify comment parentheticals; grounds the recordedBy regex (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 12-02-PLAN.md — 26-column view rebuild (institutionCode/rightsHolder/datasetName/recordedBy/trusted), fields.ts + meta.xml parity, SC assertions, [BLOCKING] schema push (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 12-03-PLAN.md — EML associatedParty (data-driven, contentProvider) + build.ts wiring + row-count guard verification (Wave 3)

**Cross-cutting constraints:**

- npm test passes green

### Phase 13: Verification & GBIF Re-validation

**Goal**: The corrected archive passes the GBIF DwC-A validator with no blocking/structural errors, attribution improvements are confirmed end-to-end, and all "Looks Done But Isn't" checklist items are green
**Depends on**: Phase 12 (rebuilt views must be live; nightly archive must have regenerated)
**Requirements**: ATTR-05
**Success Criteria** (what must be TRUE):

  1. GBIF DwC-A validator returns "can be indexed by GBIF" with zero blocking or structural errors on the nightly-regenerated archive
  2. The archive's `occurrence.txt` contains no rows with `occurrenceID` prefixed `'inaturalist:'` or `'happywhale:'` (SRC-01 confirmed in the artifact, not just the view)
  3. A spot-check of exported rows shows Maplify records carry `datasetName = "SalishSea.io — Orca Network"` (or the correct per-collection name), `institutionCode = "SalishSea"`, `rightsHolder = "SalishSea.io"`, and `recordedBy` as a human name — replacing the previous opaque bucket and per-contributor rightsHolder
  4. EML lists upstream organizations as `associatedParty` elements (never as `institutionCode`); EML `<title>` reflects the v1.3 archive version

**Plans**: 3 plans

**Wave 1** *(parallel — no file overlap)*

- [x] 13-01-PLAN.md — verify-artifact.ts (artifact-level SC#2/SC#3/SC#4 assertions) + the 5 read-only prod-DB checklist queries recorded in 13-CHECKLIST.md
- [x] 13-02-PLAN.md — validate-gbif.ts (GBIF validator REST submit + poll + indexeable/blocking-category gate for SC#1)

**Wave 2** *(blocked on Wave 1)*

- [ ] 13-03-PLAN.md — fresh local build (D-02) + run artifact verifier + GBIF validator; [human-verify] result review; conditional inline remediation (EML contact D-03 / optional Maplify coordinateUncertainty D-04) gated on validator output
