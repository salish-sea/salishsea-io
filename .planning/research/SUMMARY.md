# Project Research Summary

**Project:** SalishSea.io — v1.2 Export to DarwinCore Archive
**Domain:** Biodiversity data publishing (DarwinCore Archive export) bolted onto an existing static-SPA + Supabase + S3/CloudFront system
**Researched:** 2026-06-09
**Confidence:** HIGH

## Executive Summary

This milestone publishes a nightly-regenerated DarwinCore Archive (DwC-A) — a self-describing ZIP (`meta.xml` + `eml.xml` + Occurrence core + Multimedia extension) — of SalishSea.io's native observations plus Maplify/Whale Alert records, downloadable from the site. The deliverable is purely **additive and read-only**: nothing in the existing app runtime changes. The research converges hard on one architecture and one operational mechanism, both of which reuse infrastructure that already exists and is proven in production.

**Recommended architecture:** a dedicated read-only `dwc` Postgres schema (a `dwc.classification(taxon_id)` recursive-CTE function that walks `inaturalist.taxa` to kingdom→genus, plus `dwc.occurrences` and `dwc.multimedia` views built directly from the **source tables** — `public.observations`, `maplify.sightings`, photo tables — **not** the UI-shaped `public.occurrences` view). The export contract lives in SQL as a single auditable artifact; a thin Node/TS script (`bin/export-dwca.ts`) is a dumb serializer (SELECT → stream CSV → emit meta/eml → zip with `archiver`). **Operational mechanism:** a nightly GitHub Actions workflow (`export-dwca.yml`, mirroring the existing `smoke.yml` cron pattern) that reuses the existing AWS OIDC role (`salishsea-deploy-action`) to `aws s3 cp` the zip to `s3://salishsea-io/site/dwca/` and invalidate CloudFront — served at `https://salishsea.io/dwca/...` with **zero new AWS infrastructure**. Reject pg_cron (can't zip/write S3) and Supabase Edge Functions (new runtime, no AWS path to `salishsea.io`).

**Key risks cluster into four explicitly-separated severities** the roadmapper must triage differently: **BLOCKER** (archive won't load — meta.xml index drift, coreId join breakage, occurrenceID instability, CSV/encoding corruption), **QUALITY** (loads but GBIF validator/researchers flag it — fabricated eventDate precision, `coordinateUncertaintyInMeters=0`, lat/lon axis swap, taxonRank mismatches), **RIGHTS** (most expensive to recover — redistributing Maplify/Whale Alert without confirmed permission, and native records having **no record-level license**), and **GAP** (~8 data-model holes GAP-A…GAP-H that the milestone goal explicitly requires be surfaced as findings, not silently fudged). The rights gate must sequence **first** — it can block or rescope (native-only first cut) before any code is written.

## Key Findings

### Recommended Stack

See [STACK.md](./STACK.md). The build is plain Node 24 / TypeScript 5.9 matching the rest of the codebase, run inside a scheduled GitHub Actions workflow that already has the AWS OIDC role and Supabase env vars wired through the `production` environment. The only new runtime dependencies are zip + serialization libraries; the publish path shells out to the preinstalled `aws` CLI exactly as `deploy.yml` does. No new AWS infra, no new IAM role, no Edge Function runtime.

**Core technologies:**
- **GitHub Actions scheduled workflow** — nightly trigger + compute — already the deploy/CI substrate; `smoke.yml` proves the `schedule`+`workflow_dispatch`+`production`-env pattern; OIDC role already grants S3 write + CloudFront invalidation.
- **`archiver` 8.0.0** — stream-write the `.zip` — streaming keeps memory flat as the occurrence core grows; avoids `adm-zip`'s load-everything-in-memory approach.
- **`postgres` (porsager) 3.4.9 + `csv-stringify` 6.7.0** — direct pooled connection + correct delimiter/quote escaping — beats PostgREST's `max_rows=1000` cap for a bulk export; a real serializer (never string concat) is mandatory to avoid CSV corruption. (`@supabase/supabase-js` with pagination is the zero-new-secret fallback.)
- **meta.xml / eml.xml via template strings** — small fixed-shape XML — no heavy XML library needed.

**New secret to flag (per deployment memory):** a Supabase service-role / DB connection string in the `production` GitHub environment. `DB_PASSWORD` already exists; surface any genuinely-new var to the user and await confirmation before first run.

### Expected Features

See [FEATURES.md](./FEATURES.md). A "good" archive unzips, its `meta.xml` resolves every column to a real DwC term URI, join keys are intact, and `eml.xml` carries a machine-readable license + citation. Download-only needs no DOI/IPT/registration, but emitting valid `meta.xml` + EML keeps that path open for free.

**Must have (table stakes):**
- Occurrence core with the 4 GBIF-required terms — `occurrenceID`, `basisOfRecord`, `scientificName`, `eventDate`.
- Spatial block — `decimalLatitude`/`decimalLongitude`/`geodeticDatum`/`coordinateUncertaintyInMeters` (blank when unknown, never 0).
- Taxonomy block — `taxonRank` + `kingdom`…`genus` via the taxa-hierarchy walk.
- `individualCount`, `occurrenceStatus=present`, `recordedBy`, occurrence `license` + `rightsHolder` as proper CC **URIs**.
- Valid `meta.xml` + GBIF-profile `eml.xml`; nightly regeneration + hosted download.

**Should have (differentiators):**
- **Simple Multimedia extension** (`gbif/1.0/multimedia`) for photos — structured per-image license/attribution, strongly preferred over an `associatedMedia` string for an image-rich dataset.
- `references` (link back to the SalishSea.io occurrence page) — high value, near-zero cost.

**Defer (anti-features for this cut):**
- **ResourceRelationship extension for travel segments** — GBIF does not index it today; verbose; presupposes the deferred individual-linkage. Architecture stays extensible to add it later without restructuring.
- `organismID` / individual-animal linkage — explicitly deferred; regex-extracted `T065S` identifiers must NOT be emitted as identity terms (at most labeled-unverified in `dynamicProperties`).
- GBIF/OBIS registration + DOI — reachable by design, later config step.

### Architecture Approach

See [ARCHITECTURE.md](./ARCHITECTURE.md). One decision drives everything: **where does the DwC projection live?** Answer: a dedicated read-only `dwc` Postgres schema, NOT app-code mapping over `public.occurrences`. The UI view is the wrong shape (composite types tuned for the map) and the wrong source set (all four sources); building the DwC views directly from source tables avoids lossy composite-unpacking, fragile `id LIKE 'maplify:%'` source filtering, and couples the GBIF contract to the UI view's churn. The taxonomy walk is inherently a SQL recursion problem (recursive CTE over `parent_id`), and source filtering is clean at the `FROM` clause. The script becomes a thin serializer; the contract ships via the existing `supabase db push`.

**Major components:**
1. **`dwc` schema** (NEW migration) — `dwc.classification()` recursive function + `dwc.occurrences` and `dwc.multimedia` views over source tables. The auditable single source of truth for field alignment.
2. **`bin/export-dwca.ts`** (NEW) — query views → stream CSVs → emit meta.xml/eml.xml → zip.
3. **`export-dwca.yml`** (NEW workflow) — nightly cron; reuse `salishsea-deploy-action` OIDC role; `s3 cp` + CloudFront invalidation of `/dwca/*`.
4. **Frontend download link** (MINIMAL) — one static `<a download>` to `https://salishsea.io/dwca/...`.

`public.occurrences`, the Lit runtime, and source tables stay **UNCHANGED**.

### Critical Pitfalls

See [PITFALLS.md](./PITFALLS.md). Severity is deliberately separated so the roadmapper can triage: BLOCKER (won't load) / QUALITY (validator warnings) / RIGHTS (redistribution & licensing) / GAP (data-model holes).

1. **Rights gate (RIGHTS, highest recovery cost)** — Maplify/Whale Alert are third-party data baked into a redistributable file; native records have **no record-level license** and contributors never consented to one. *Avoid:* confirm redistribution rights and decide the occurrence-record license **before** generating; carry structured attribution; consider a native-only first cut if unresolved. **Sequence first.**
2. **meta.xml field-index ↔ column drift (BLOCKER, silent)** — positional indices that drift corrupt every record silently. *Avoid:* generate meta.xml and the TSV from one ordered field-list; round-trip-parse a known record.
3. **coreId join breakage (BLOCKER, silent photo loss)** — multimedia `coreid` must byte-match a core `id` (prefix consistency); same source-exclusion filter on both files. *Avoid:* derive `occurrenceID` once, reuse verbatim; anti-join must be empty.
4. **CSV/encoding corruption (BLOCKER)** — freeform body text with commas/quotes/newlines/`<br>`/emoji + UTF-8 BOM. *Avoid:* real serializer, strip HTML, UTF-8 no-BOM end-to-end.
5. **Fabricated precision / invalid sentinels (QUALITY+GAP)** — Maplify report-time emitted as precise sighting `eventDate`; `coordinateUncertaintyInMeters=0`; lat/lon axis swap (`ST_Y` is latitude). *Avoid:* date-precision for Maplify, omit-when-unknown (never 0), unit-test a known Salish Sea coordinate.
6. **Non-atomic nightly publish (OPERATIONAL/BLOCKER-for-users)** — torn reads, stale CloudFront cache, empty-result wipe. *Avoid:* write-then-swap, invalidate, empty-result guard, checksum, defined timezone.

## Implications for Roadmap

Research yields a **strict dependency-ordered build sequence**: rights gate → DB projection → meta.xml/EML → export script → nightly workflow → frontend link. The data-model GAPs (GAP-A…GAP-H) are not implementation detail — the milestone goal literally requires they be surfaced as decisions; many resolve as policy inside the `dwc` views.

### Phase 1: Rights & Data-Model Policy (gate)
**Rationale:** RIGHTS findings are the most expensive to recover from and can rescope the entire milestone; the ~8 GAPs must become explicit requirements before any column is mapped. This is a requirements/decision phase, not heavy code.
**Delivers:** confirmed Maplify/Whale Alert redistribution rights (or decision to ship native-only first); occurrence-record license decision + native `license` column/policy + contributor-consent stance; resolutions for GAP-A…GAP-H (eventDate precision, uncertainty-omit, basisOfRecord per source, count/status, identifier exclusion, license-less photo exclusion).
**Addresses:** licensing/rights table-stakes; the milestone's "audit and document gaps" goal.
**Avoids:** Pitfalls 11, 12 (rights), and pre-decides 5, 6, 10, 13 so generation can't silently fudge them.

### Phase 2: DB Projection (`dwc` schema)
**Rationale:** the leaf dependency that blocks everything below; encodes most GAP decisions as auditable SQL. Develops/validates entirely offline against local Supabase.
**Delivers:** `dwc.classification()` recursive function, then `dwc.occurrences` + `dwc.multimedia` views over source tables, source-filtered to native + Maplify only, with stable source-prefixed `occurrenceID`.
**Uses:** SQL recursive CTE; ships via existing `supabase db push`.
**Implements:** the core architecture component; **avoids** Pitfalls 3 (occurrenceID), 7 (axis/datum), 8 (taxonRank/classification) at the source of truth.

### Phase 3: Archive Generation (meta.xml/EML + export script)
**Rationale:** depends on the view's column contract from Phase 2; the descriptor and serializer are coupled and validated together against the GBIF validator.
**Delivers:** meta.xml + eml.xml templates generated from one ordered field-list; `bin/export-dwca.ts` streaming CSVs into a zip; local end-to-end run.
**Uses:** `archiver`, `postgres`/`csv-stringify` (STACK.md).
**Avoids:** Pitfalls 1 (index drift), 2 (coreId join), 4/15 (CSV/encoding) — all generation-phase, all verified by round-trip and anti-join tests.

### Phase 4: Nightly Workflow & Hosting
**Rationale:** depends on a working script; introduces the only prod-touching, secret-requiring surface.
**Delivers:** `export-dwca.yml` (cron + `workflow_dispatch`, reuse OIDC role + S3/CloudFront), atomic write-then-swap publish, empty-result guard, checksum, CloudFront invalidation; confirm `/dwca/*` passes through to S3 (not SPA index rewrite); add the service-role secret to `production` env (flag to user).
**Avoids:** Pitfalls 14 (atomic publish), 16 (streamed export at scale).

### Phase 5: Frontend Download Link
**Rationale:** lowest-risk, last; depends on a stable published URL.
**Delivers:** one static `<a download>` + short "Data download / DwC-A" copy.

### Phase Ordering Rationale
- **Rights first** because it can block or rescope (native-only) and is the costliest to undo after publication.
- **DB → descriptor → script → workflow → link** is the explicit dependency-ordered sequence from ARCHITECTURE.md; Phases 2–3 are fully offline-validatable, de-risking before any prod-touching workflow exists.
- GAP decisions front-loaded into Phases 1–2 so the generator (Phase 3) is a faithful serializer with nothing to fudge.

### Research Flags
Phases likely needing deeper research during planning:
- **Phase 1 (Rights):** Maplify/Whale Alert terms-of-service and redistribution permission are a legal/external question, not in the codebase — may require contacting sources; outcome can rescope the milestone.
- **Phase 4 (Hosting):** confirm the CloudFront behavior passes `/dwca/*` straight to S3 rather than rewriting to `index.html` (verify against the Lambda@Edge/behavior config).

Phases with standard patterns (skip research-phase):
- **Phase 2 (DB Projection):** well-grounded — taxa `parent_id` + ordered rank enum and recursive-CTE idiom already exist in the repo.
- **Phase 3 (Generation):** DwC-A structure and the library choices are HIGH-confidence and documented.
- **Phase 5 (Frontend link):** trivial static addition.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Infra facts (OIDC role, `/site` origin path, `smoke.yml` cron) read directly from repo; library versions verified on npm 2026-06-09. |
| Features | HIGH | DwC-A structure, GBIF-required terms, Multimedia extension verified against TDWG/GBIF docs; ResourceRelationship indexing status MEDIUM (defer is safe regardless). |
| Architecture | HIGH | Existing schema/migrations/workflows read directly; Actions-vs-Edge choice MEDIUM (both work; Actions lower-friction). |
| Pitfalls | HIGH | Structural rules + validator flags from authoritative GBIF docs; data-model GAPs read directly from this project's schema. |

**Overall confidence:** HIGH

### Gaps to Address
- **GAP-A…GAP-H (data-model policy):** eventDate precision (Maplify report-time), omit-unknown coordinate uncertainty, native record-level license, third-party redistribution rights, per-source basisOfRecord, count/occurrenceStatus, unvalidated identifier exclusion, license-less photo exclusion. → Resolve in Phase 1 as explicit requirements; encode in Phase 2 views. These are the milestone's stated "identify gaps" goal — surface prominently.
- **Maplify/Whale Alert redistribution rights:** unconfirmed external dependency → Phase 1 gate; fallback is native-only first cut.
- **New `production` secret (Supabase service-role / DB URL):** per deployment memory, confirm with user before first workflow run.
- **CloudFront `/dwca/*` pass-through:** verify during Phase 4 build.

## Sources

### Primary (HIGH confidence)
- Repo: `.github/workflows/deploy.yml`, `smoke.yml`; `infra/lib/infra-stack.ts`; `supabase/config.toml`; migrations (`initial_schema`, `cron`, `taxon_species_id`, `sightings_uses_contributors`, `admins`/occurrences view) — existing infra, OIDC role, `/site` origin, taxa hierarchy, source-prefixed ids.
- [GBIF IPT DwC-A How-to Guide](https://ipt.gbif.org/manual/en/ipt/latest/dwca-guide), [Darwin Core Text Guide (TDWG)](https://dwc.tdwg.org/text/), [OBIS Manual §7](https://manual.obis.org/data_format.html) — archive structure, meta.xml/EML, star schema.
- [GBIF Occurrence issues & flags](https://techdocs.gbif.org/en/data-use/occurrence-issues-and-flags), [GBIF data-quality recommendations](https://techdocs.gbif.org/en/data-publishing/data-quality-recommendations), [Simple Multimedia extension](https://rs.gbif.org/extension/gbif/1.0/multimedia.xml) — required terms, validator flags, multimedia fields.
- [GBIF license processing](https://data-blog.gbif.org/post/gbif-occurrence-license-processing/) — record vs dataset license, aggregation.
- npm registry — archiver 8.0.0, postgres 3.4.9, csv-stringify 6.7.0 (verified 2026-06-09).

### Secondary (MEDIUM confidence)
- [GBIF occurrence clustering / ResourceRelationship status](https://techdocs.gbif.org/en/data-processing/clustering-occurrences) — ResourceRelationship not yet indexed (supports deferral).
- [Supabase Scheduling / pg_net](https://supabase.com/docs/guides/functions/schedule-functions) — pg_cron+pg_net path for option (a) tradeoff analysis (Actions chosen).

---
*Research completed: 2026-06-09*
*Ready for roadmap: yes*
