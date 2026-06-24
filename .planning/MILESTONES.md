# Milestones

## v1.3 Providers, Collections & Contributors (Shipped: 2026-06-24)

**Phases completed:** 6 phases (9–14), 14 plans, 23 tasks
**Requirements:** 24/24 shipped (PROV/ORG/COLL/CONTRIB/LINK/RESOLVE/ATTR/DWCA-GATE)
**Git range:** `feat(09-01)` → `feat(14-02)` (2026-06-19 → 2026-06-22); 103 files changed, +19,046 / −104

**Key accomplishments:**

- **Phase 9 — Reference tables:** `providers` (4), `organizations` (5), `collections` (21, `collection_kind` enum, no `aggregator_ingest`) seeded with RLS read policies + nullable `contributors.orcid`, unblocking all downstream FKs.
- **Phase 10 — Source FK columns:** added nullable `provider_id`/`collection_id`/`contributor_id`/`source_url` across all four source schemas (native / Maplify / iNaturalist / HappyWhale), `collection_id` indexed on the two exported tables, `source_url` generated from existing `url`/`uri`.
- **Phase 11 — Resolution & backfill:** pure-TS URL-pattern resolver + human-curated exact-match dictionary (UNION ALL precedence), `mint_contributor` (SECURITY DEFINER), and idempotent backfill UPDATEs + MERGE-based ingest wiring — RESOLVE-01–04.
- **Phase 12 — DwC view rebuild:** rebuilt `dwc.occurrences` from 25→26 columns to the aggregator pattern (`institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, per-collection `datasetName`, regex `recordedBy`, EML `associatedParty`) — validated read-only against ~4,411 prod rows.
- **Phase 13 — GBIF re-validation:** artifact-level SC verifier (`verify-artifact.ts`, 32 fixture tests) + GBIF validator REST client with strict `indexeable`/blocking gate; archive re-validated `indexeable=true`, zero structural errors, 12-item checklist green.
- **Phase 14 — Pre-prod build gate:** seeded local-DB CI fixture (`supabase/ci-seed.sql`) + `build.yml` psql seed step makes `build.test.ts` a true pre-merge gate; red-test confirmed it catches bare-schema-ref regressions (non-zero exit) — first real-runner PR (#278) green end-to-end.

---

## v1.2 Export to DarwinCore Archive (Shipped: 2026-06-18)

**Phases completed:** 5 phases, 16 plans, 31 tasks

**Key accomplishments:**

- Single authoritative 04-POLICY.md closes all four rights/gap requirements: CC-BY-NC 4.0 legalcode URI, per-photo CC converter, native/third-party attribution model, per-source gap table with explicit resolutions, and include-and-attribute/hosted-but-unlinked hold rule with per-org conferral questions
- Seed migration creates the `dwc` schema (USAGE-only to anon/authenticated) plus `dwc.taxa_classification`, a recursive view over `inaturalist.taxa.parent_id` that pivots Linnaean ancestors into columns while enforcing the M-05 higher-rank-only contract.
- Adds the 25-column `dwc._native_occurrences` view to the Phase 5 migration — the canonical projection of `public.observations` × `public.contributors` × `dwc.taxa_classification` into DwC-aligned columns per 04-POLICY §3.1. Establishes the column-order/type interface contract that plan 05-03's Maplify branch must mirror exactly so the union view in plan 05-04 compiles.
- Appends the 25-column `dwc._maplify_occurrences` view to the Phase 5 migration — the Maplify projection of `maplify.sightings` × `dwc.taxa_classification` × a LATERAL source→display-name CASE, mirroring plan 05-02's frozen interface contract so the UNION ALL in plan 05-04 will compile. Encodes 04-POLICY §3.2 (Maplify gap table), §2.2 (D-10/D-11 source mapping), §5.3 (`rwsas` defensive filter), §1.1 D-20 (Maplify CC-BY via Acartia), §4.1 D-03 (source-drop lever; ready, not active), and §2.3 (4-key dynamicProperties).
- Closes the Phase 5 migration with the three remaining DwC views (`dwc.occurrences` UNION, `dwc.datasets` single-row VALUES view, `dwc.multimedia` GBIF Simple Multimedia extension), the final blanket `GRANT SELECT`, and a 17-assertion psql harness — completing the SQL encoding contract for 04-POLICY but deferring the live-DB verification step because the local Supabase stack was not running at execution time (Docker daemon down, port 54322 closed).
- `scripts/dwca/` is now type-checked, dep-resolved, Vitest-discoverable, and exports placeholder `OCCURRENCE_FIELDS`/`MULTIMEDIA_FIELDS` arrays — Wave 1 can begin populating without environment setup overhead.
- `OCCURRENCE_FIELDS` (25) and `MULTIMEDIA_FIELDS` (6) are populated with their canonical name → term-URI mappings, and the DWCA-02 unit surface in `fields.test.ts` is now a live 14-test guardrail (0 skipped, 0 failed). The Wave-1 source of truth for column order and term URIs is in place.
- `buildMetaXml` and `buildEml` are populated, pure, and unit-tested — 35 passing assertions in two files guard ordinal/term alignment with `fields.ts`, the GBIF structural attributes the validator looks for, XML escaping on every free-text DB value, the E-03 two-paragraph methods invariant, and determinism. Plan 05's `build.ts` can now import both and obtain the two XML strings to zip.
- Plan 04 ships the two pure utility modules that Plan 05's `build.ts` orchestrates around: `scripts/dwca/assertions.ts` (the F-02 runtime guard that proves DWCA-02 at build start, plus two zero-result guards) and `scripts/dwca/zip.ts` (the deterministic-bytes yazl wrapper that writes the 4-file DarwinCore Archive). Both are unit-tested without a live DuckDB connection or external I/O beyond a tmp file — 22 new tests, all passing.
- Plan 05 lands `scripts/dwca/build.ts` — the single entry point invoked by `npm run build:dwca`. It composes the leaf modules from Plans 02-04 into a working end-to-end pipeline: SUPABASE_DB_URL guard → DuckDB ATTACH → F-02 assertions on both dwc views → tab-delimited CSV COPY → ST_Point GEOMETRY parquet COPY → empirical R1 verification of GeoParquet `geo` metadata → row-count parity → MIN/MAX(eventDate) → buildMetaXml + buildEml → deterministic writeZip. The live local run produced both artifacts (zip + parquet), exit 0, no DSN leak, and CONFIRMED R1 — DuckDB auto-emits GeoParquet 1.0.0 metadata when the column is typed GEOMETRY.
- Plan 06 lands `scripts/dwca/build.test.ts` — 10 vitest integration tests gated on `SUPABASE_DB_URL` that exercise Plan 05's full `build.ts` pipeline end-to-end (`beforeAll` runs `npm run build:dwca`) and then introspect the produced zip + parquet + CSVs to prove DWCA-01..04 and DWCA-06 by machine assertion. The user ran the integration suite locally against a populated Supabase on 2026-06-18 — all 10 tests passed. DWCA-05 (GBIF DwC-A validator) is DEFERRED: gbif.org's validator service was offline due to an upstream bug; the deterministic zip is in hand at `dist/dwca/salishsea-occurrences-v1.zip` and ready to re-upload once the service returns. Plan owner adjudicated: approve with DWCA-05 deferred. Phase 6 closes.
- 1. [Rule 1 - Bug] ESM module mocking requires vi.mock() hoisting, not vi.spyOn()
- Lambda@Edge OG-meta handler gains a path-prefix early-return for `/dwca/*` binary downloads, preventing bot UAs from receiving synthesized HTML instead of the archive.
- GitHub Actions workflow `dwca-nightly.yml` drafted with cron schedule, OIDC-authenticated S3 publish in checksum-LAST order, CloudFront invalidation, V-01 smoke check, and dedup'd failure-issue creation — stopped at Task 2 (peter-evans SHA human-verify gate).
- Pure helper module `src/download-info.ts` with `formatBytes`, `formatRelativeTime`, `fetchArchiveMetadata`, and `DownloadInfo` discriminated union; 20 Vitest tests all green.
- Wired the Plan 01 helpers into the existing About `<dialog>` in `src/salish-sea.ts`. Site visitors can now open the About modal and download the DwC-A `.zip` + `.parquet` (with `.sha256` verify links) from production, with live file sizes and a "updated X ago" freshness line.

---

## v1.1 Partner Org Links (Shipped: 2026-04-18)

**Phases completed:** 1 phases, 2 plans, 3 tasks

**Key accomplishments:**

- Pure CSV-driven link injection utility using Vite ?raw import and single-pass combined regex with case-insensitive matching, bracket handling, and double-link prevention
- Rendering pipeline integration: injectPartnerLinks pre-processes body text, marked Renderer adds target/rel to all links, DOMPurify ADD_ATTR config preserves those attributes through sanitization

---

## v1.0 Link Shareability (Shipped: 2026-04-17)

**Phases completed:** 2 phases, 7 plans, 12 tasks

**Key accomplishments:**

- Copy-link icon button added to obs-summary header using linkIcon + buildShareUrl helper, producing clean ?o=<id>-only shareable URLs with 2-second checkmark feedback
- Deep-link hydration via ?o=<id>: sets date from occurrence.observed_at and centers map on occurrence location at zoom 12, with silent fallback and no history pollution
- Jest test scaffolds for Lambda@Edge bot detection and OG tag generation (9 unit tests) and CDK InfraStack assertions (3 tests), all in RED state awaiting implementation
- Lambda@Edge viewer-request handler with bot detection, SSM credential caching, Supabase REST fetch, and OG tag generation — all 10 unit tests GREEN
- CDK InfraStack fully wired with CloudFront Distribution, Lambda@Edge VIEWER_REQUEST trigger (NODEJS_22_X), SSM credential parameters, and IAM read grant — all 3 CDK assertion tests GREEN

---
