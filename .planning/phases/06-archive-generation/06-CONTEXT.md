# Phase 6: Archive Generation - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the **thin serializer** that consumes the Phase 5 `dwc` view contract (`dwc.occurrences`, `dwc.datasets`, `dwc.multimedia`) and produces two artifacts locally:

1. A valid **DwC-A zip** — `meta.xml` + `eml.xml` + occurrence-core data file + Simple Multimedia extension data file — that passes the GBIF DwC-A validator with no blocking structural errors.
2. A **GeoParquet 1.0.0 sidecar** from the same `dwc.occurrences` projection — WKB Point geometry (OGC:CRS84), with `decimalLatitude`/`decimalLongitude` retained, round-trippable in DuckDB/QGIS/geopandas.

**Scope:** new TypeScript code under `scripts/dwca/`; consumes Postgres read-only via DuckDB ATTACH; produces files on the local filesystem. **Out of scope:** scheduling (Phase 7), atomic publish + cache invalidation + checksum publication (Phase 7), frontend discovery (Phase 8), GBIF/OBIS registration (v2). The Phase 5 view contract is **frozen** — Phase 6 does not modify any `dwc.*` view.

Requirements covered: DWCA-01..DWCA-06.

</domain>

<decisions>
## Implementation Decisions

### Tooling — Hybrid TS orchestrator + DuckDB

- **T-01: Hybrid orchestration.** A TypeScript script orchestrates the run. **DuckDB** does all tabular extraction (occurrence core CSV, multimedia CSV, GeoParquet sidecar) via `ATTACH` + `COPY` against Postgres. **Node/TS** owns: EML and `meta.xml` templating, zip assembly, the canonical field-list assertion (see F-02), and orchestration around the COPYs. Rationale: the 2026-06-09 spike validated DuckDB as the cleanest path for CSV + GeoParquet from one engine; GeoParquet in JS is painful (roadmap planning note). XML templating and zip assembly belong in a real language, not bash.
- **T-02: TypeScript.** Matches the existing stack (Lit + Vite + TS application code; CDK TS in `infra/`). Type-check against `database.types.ts` if useful. Add a small `tsx` (or `ts-node`) entry point.
- **T-03: `@duckdb/node-api` library.** Programmatic DuckDB from TS — `ATTACH` Postgres, run COPYs, read row counts back so the orchestrator can perform a sanity check before zipping. Lets the orchestrator construct the COPY column list at runtime from the canonical `fields.ts` (see F-02). Spike already proved the native module works locally.
- **T-04: Code location = `scripts/dwca/`.** Dedicated multi-file dir: at minimum `build.ts` (entry), `fields.ts` (canonical ordered field lists for both core and extension — see F-01), `eml.ts` (EML templating + authored free-text), `meta-xml.ts` (meta.xml generation from `fields.ts`). Phase 7's nightly GHA workflow will call a package.json script that runs `build.ts`. New top-level dir; intentionally outside `src/` (not Vite-bundled, CI-only).

### Single ordered field list (DWCA-02) — TS config + runtime assertion

- **F-01: Canonical ordered field list lives in `scripts/dwca/fields.ts`.** Two exported arrays:
  - `OCCURRENCE_FIELDS` — 25 entries, one per `dwc.occurrences` column, **in view column order**. Each entry: `{ name: string; termUri: string; }` (extensible to type / nullability later if needed).
  - `MULTIMEDIA_FIELDS` — 6 entries, one per `dwc.multimedia` column, in view column order, same shape.

  This array IS the source of truth: `meta.xml` `<field>` elements are generated from it (ordinal = array index); the COPY column list is built from `OCCURRENCE_FIELDS.map(f => f.name)`. No drift possible between descriptor and data file because they share the array.

- **F-02: Runtime assertion against `information_schema.columns`.** At build start, query Postgres for `column_name, ordinal_position FROM information_schema.columns WHERE table_schema='dwc' AND table_name IN ('occurrences','multimedia') ORDER BY ordinal_position` and assert exact name/ordinal match against the TS arrays. **Fail loudly** with a structured diff on any drift. This is the single mechanism that catches a Phase 5 schema change that the Phase 6 field list hasn't been updated for — DWCA-02 enforced by build-time check, not by hope.

- **F-03: Per-field URI is data, not derived.** Most 25 occurrence columns map to `http://rs.tdwg.org/dwc/terms/{name}`, but **`rightsHolder` and `license` are Dublin Core**: `http://purl.org/dc/terms/rightsHolder`, `http://purl.org/dc/terms/license`. The TS field list carries the URI explicitly per entry — no convention-based derivation that would silently emit a wrong URI for the dcterms pair.

- **F-04: Multimedia uses the same pattern.** `MULTIMEDIA_FIELDS` mirrors `dwc.multimedia` (6 cols: `coreId`, `type`, `identifier`, `license`, `rightsHolder`, `creator`). meta.xml `<extension rowType="http://rs.tdwg.org/dwc/terms/Multimedia">` block is generated from this array; same `information_schema` assertion catches drift. Uniform pattern — same engineering for 25-col core and 6-col extension.

- **F-05: Data files — tab-delimited, no enclosure, UTF-8 without BOM.** GBIF DwC-A default: `fieldsTerminatedBy='\t'`, `linesTerminatedBy='\n'`, no `fieldsEnclosedBy`. `occurrenceRemarks` already has HTML stripped upstream in `dwc._native_occurrences` (`regexp_replace(o.body, '<[^>]+>', '', 'g')`); Phase 6 additionally collapses any embedded tabs/newlines in body text to spaces at write time (DWCA-04). UTF-8 encoding is set in `meta.xml` `encoding="UTF-8"`. The serializer asserts no BOM in output bytes.

- **F-06: Constants emitted as columns, NOT hoisted to meta.xml `default=""`.** `dwc.occurrences` emits constants (`basisOfRecord='HumanObservation'`, `occurrenceStatus='present'`, `geodeticDatum='WGS84'`, `datasetName`, `datasetID`, native-branch `license`, etc.) as literals on every row. The data file is a faithful 1:1 mirror of the view — no special "is this column in the file or not" branching in the serializer. File-size cost negligible; inspectability and invariant simplicity win.

### Geometry / GeoParquet (DWCA-06)

- **G-01: WKB Point built in DuckDB at COPY time.** The sidecar COPY: `COPY (SELECT *, ST_AsWKB(ST_Point("decimalLongitude", "decimalLatitude")) AS geometry FROM postgres_db.dwc.occurrences) TO 'occurrences.parquet' (FORMAT parquet, ...)`. `dwc.occurrences` is **untouched** — Phase 5's 25-column UNION ALL contract is preserved. Geometry derives from the same lat/lon the CSV exports; single source.
- **G-02: GeoParquet content = all 25 `dwc.occurrences` columns + `geometry` (26 cols total).** Full parity with the CSV. REQUIREMENTS DWCA-06 explicitly requires retaining `decimalLatitude`/`decimalLongitude` alongside geometry — researchers using non-spatial tools still get coordinates. Matches GBIF's own CSV/Parquet parity offering.
- **G-03: CRS encoding = OGC:CRS84.** GeoParquet 1.0.0 default; WGS84 datum with explicit longitude-first axis order. Avoids the EPSG:4326 axis-order ambiguity (lat-first vs lon-first reader disagreement). `dwc.occurrences.geodeticDatum='WGS84'` is compatible. Spike used CRS84.
- **G-04: Geometry column is appended after the 25 dwc cols (position 26).** Preserves the canonical `OCCURRENCE_FIELDS` ordering — `fields.ts` is unchanged by the parquet side. Most geo tools (DuckDB, QGIS, geopandas) read by column name, not ordinal.

### EML free-text authoring (POLICY §6.7 carry-over)

- **E-01: Authored free-text lives in `scripts/dwca/eml.ts`, NOT in a `dwc.datasets` migration.** Phase 5's M-03 keeps dataset structural identity (URI, title, license URI, publisher, contact) in the SQL view — that stays. **But** the Phase-6-authored prose (abstract refinement, `methods`, `geographic_coverage`) lives in TS. Rationale: the "DwC contract lives in SQL" precedent applies to the **data column projection** (`dwc.occurrences` is the export contract), not to dataset prose. Mixed pattern is already present — `temporal_coverage` is computed at gen time from `MIN/MAX(eventDate)` (POLICY §6.5) and never lived in the view. Prose edits become normal PRs; no migration ceremony for typo fixes. Easy to extend when GBIF registration adds new EML elements later.

- **E-02: `geographic_coverage` bbox = Acartia data cooperative boundaries.**
  - **Bounding coordinates:** 36°N – 54°N, 136°W – 120°W (north, south, west, east).
  - **Geographic description:** "The Salish Sea region; geographic scope inherited from the Acartia data cooperative's boundaries, the upstream aggregator for Maplify / Whale Alert records included in this archive."
  - **Rationale:** Maplify/Whale Alert records flow through Acartia upstream (POLICY §1.1 D-20). Inheriting Acartia's bbox keeps SalishSea.io's stated coverage aligned with the source aggregator's scope — no claim of geographic completeness beyond what the upstream pipeline supports. Stated intentional scope per POLICY §6.5; not realized data bbox.

- **E-03: `methods` = tight 1-2 paragraph factual draft.** Planner authors text covering exactly two acquisition mechanics:
  1. **Native submissions** — observations submitted via the SalishSea.io web app by authenticated contributors using Google Sign-In, including species identification, location, observation time, optional body text, and optional photos.
  2. **Maplify / Whale Alert ingestion** — third-party records ingested from the Whale Alert mobile app and its nested sub-sources (Orca Network, Cascadia Research Collective, and others) via the Acartia data cooperative aggregator upstream of SalishSea.io's `maplify.sightings` table.

  User reviews in plan-phase output or post-execute. No speculation about observer methodology, no extended rationale for cetacean focus, no operational disclaimers — just the facts of how the data arrives.

- **E-04: `pub_date` = nightly run date.** Today's date at archive regeneration time. Honest semantics: "this archive was published today." Phase 5's `dwc.datasets` already encodes `pub_date = CURRENT_DATE`, which evaluates correctly at every nightly DuckDB ATTACH read. No constant-pinning, no last-modified-date semantics.

### Claude's Discretion

The planner picks the following without needing to surface them to the user:

- **DuckDB → Postgres connection string.** Read from env (e.g., `SUPABASE_DB_URL` or similar). Phase 7 will inject from a GH Actions secret; Phase 6's `build.ts` reads from `process.env` in dev and CI alike. Local dev uses the supabase local URL (port 54322 per project memory).
- **Parquet compression codec.** Snappy (DuckDB default). Adequate for our row count; preserves seekability.
- **`meta.xml` `rowType` URIs.** `http://rs.tdwg.org/dwc/terms/Occurrence` for core, `http://rs.tdwg.org/dwc/terms/Multimedia` for the Simple Multimedia extension. EML version = 2.1.1 (GBIF's expected version; 2.2.0 is fine but offers no v1.2 benefit).
- **Internal data-file names inside the zip.** `.txt` (GBIF convention) is the default; `meta.xml` `location` attribute makes the choice opaque to readers. Recommend `occurrence.txt` + `multimedia.txt`.
- **Zip filename and output directory.** Recommend `dist/dwca/salishsea-occurrences-v1.zip` and `dist/dwca/salishsea-occurrences-v1.parquet` (matches the `occurrences-v1` slug from POLICY §6.3). Phase 7 picks up these stable local paths and atomically publishes to `https://salishsea.io/dwca/`. Planner adjusts if a different convention helps Phase 7.
- **GBIF validator integration (DWCA-05).** Run manually against https://www.gbif.org/tools/data-validator during plan-phase verification. **Plus** a round-trip parse test in the assertion harness: read the produced archive back with a DwC-A reader (or hand-parse `meta.xml` + the data file) and confirm a known seed record's column values land in the expected DwC terms. No automated CI integration with the online validator (overkill for v1.2; reintroduce in a future phase if registration is pursued).
- **Empty-result guard.** Phase 6's `build.ts` exits non-zero if `dwc.occurrences` returns zero rows or if either COPY produces a zero-byte file. The richer "don't overwrite a good archive with an empty one" atomic-publish guard belongs in Phase 7 (EXPORT-03) — Phase 6 only refuses to produce a manifestly-broken artifact.
- **Assertion failure surfacing.** When F-02's `information_schema` check fails, exit with a structured diff message: which TS-array entries are missing in the view, which view columns are missing from the array, any ordinal mismatches. Phase 7's GH Actions surfaces this via the normal failed-job notification.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 4 policy (the licensing/attribution/gap contract — still authoritative)
- `.planning/phases/04-rights-data-model-policy-gate/04-POLICY.md` — full policy doc. Sections most relevant to Phase 6:
  - §1.1 (D-20) — per-source license URIs (native CC-BY-NC 4.0; Maplify CC-BY 4.0 via Acartia upstream)
  - §1.2 — per-photo CC license CASE (already encoded in `dwc.multimedia` — Phase 6 just emits)
  - §2.3 — `dynamicProperties` JSON schema (treated as opaque text by Phase 6 — POLICY §5.4)
  - §5.4 — `dynamicProperties` treated as opaque text in CSV / Parquet
  - **§6.1–§6.7 — Dataset Identity & EML Content.** Phase 6 reads `dwc.datasets`, authors title/abstract/methods/geographic_coverage values (§6.7 ownership split), computes `temporal_coverage` from `MIN/MAX(eventDate)` at gen time (§6.5).

### Phase 5 — the projection contract Phase 6 consumes
- `supabase/migrations/20260617203900_dwc_schema.sql` — **the shipped contract**. 25-col `dwc.occurrences` UNION ALL view, 19-col `dwc.datasets` view-over-VALUES, 6-col `dwc.multimedia` native-only view. **MUST read** to align `OCCURRENCE_FIELDS` / `MULTIMEDIA_FIELDS` and `fields.ts` URI mapping.
- `.planning/phases/05-db-projection-dwc-schema/05-CONTEXT.md` — Phase 5 decision rationale; integration-points section explicitly names Phase 6 as the consumer.
- `.planning/phases/05-db-projection-dwc-schema/05-04-PLAN.md` + `05-04-SUMMARY.md` — final closer plan; specifies `dwc.datasets` shape and `dwc.multimedia` license-CASE forward-compat.
- `.planning/phases/05-db-projection-dwc-schema/05-VALIDATION.md` — psql assertion harness (DWCA-03 readiness — multimedia orphan-row guarantee).

### Milestone scope
- `.planning/REQUIREMENTS.md` — v1.2 scope. Phase 6 requirements: DWCA-01..DWCA-06.
- `.planning/ROADMAP.md` §"Phase 6" — phase goal, six success criteria, and the explicit Planning note flagging the DuckDB-vs-Node tooling decision (now resolved as T-01: hybrid).
- `.planning/PROJECT.md` — overall milestone scope; key decisions table.

### DwC-A and EML standards
- **GBIF DwC-A reference** — https://ipt.gbif.org/manual/en/ipt/latest/dwca-guide ("Darwin Core Archive — How-to Guide"). Authoritative shape for `meta.xml`, file conventions, encoding.
- **DwC-A meta.xml schema** — https://rs.gbif.org/schema/dwc-a/dwc-a.xsd
- **Simple Multimedia extension definition** — https://rs.gbif.org/extension/dwc/simple_multimedia.xml. Required and optional columns; rowType URI.
- **DwC term URIs** — https://dwc.tdwg.org/terms/. Used for `OCCURRENCE_FIELDS.termUri` values (note: `rightsHolder` and `license` are Dublin Core, not DwC).
- **Dublin Core terms** — http://purl.org/dc/terms/ (for `rightsHolder`, `license`).
- **GBIF data validator** — https://www.gbif.org/tools/data-validator. DWCA-05 verification surface.
- **EML 2.1.1 schema** — https://eml.ecoinformatics.org/. GBIF's expected EML version.

### GeoParquet / spatial
- **GeoParquet 1.0.0 spec** — https://geoparquet.org/releases/v1.0.0/. `geo` metadata block, WKB encoding, CRS encoding rules. CRS84 default.
- **DuckDB spatial extension** — https://duckdb.org/docs/extensions/spatial/overview. `ST_Point`, `ST_AsWKB`. The 2026-06-09 spike validated this path.

### DuckDB tooling
- **DuckDB postgres_scanner / ATTACH** — https://duckdb.org/docs/extensions/postgres. `ATTACH` against Supabase Postgres; runs as the connecting role (no RLS scope concern with service-role).
- **@duckdb/node-api** — https://www.npmjs.com/package/@duckdb/node-api (or the latest Node binding name DuckDB ships). Programmatic API for T-03.

### Acartia data cooperative (referenced for `geographic_coverage` decision E-02)
- Acartia data cooperative — referenced as the upstream source of Maplify / Whale Alert records (POLICY §1.1 D-20). `geographic_coverage` bbox in `eml.ts` is inherited from Acartia's published cooperative boundaries (36°N–54°N, 136°W–120°W). **Planner to add direct URL** to Acartia's boundary documentation in `eml.ts` as a code comment.

### Source schema (already locked by Phase 5 — referenced for understanding only)
- `supabase/migrations/20250903172708_initial_schema.sql` — base schema (`public.observations`, `public.contributors`, `public.observation_photos`, `inaturalist.taxa`).
- `database.types.ts` — generated TS types.

### Codebase maps (orientation)
- `.planning/codebase/STRUCTURE.md` — current dir layout. `scripts/dwca/` is new; `bin/` already houses utility scripts (CSP hash verifier).
- `.planning/codebase/TESTING.md` — Vitest + Jest split; co-located `*.test.ts` pattern. Phase 6 tests will use Vitest under `scripts/dwca/`.
- `.planning/codebase/STACK.md`, `INTEGRATIONS.md` — overall app shape.

### Project memory (deployment + AWS)
- Production env vars live in the GitHub Actions `production` environment. Phase 7 (not Phase 6) introduces the DB connection secret. **Phase 6 reads connection details from env** but does not modify GH Actions config — that surface is Phase 7.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The Phase 5 view contract is the input — fully shipped.** `dwc.occurrences` (25 cols), `dwc.datasets` (19 cols, 1 row), `dwc.multimedia` (6 cols, native-only). Phase 6 reads these directly via DuckDB `ATTACH` Postgres.
- **HTML stripping is already upstream.** `dwc._native_occurrences` emits `occurrenceRemarks` with HTML tags removed and empty strings collapsed to NULL (line 264 of the migration). Phase 6 does NOT re-strip HTML; it only needs to collapse embedded tabs/newlines to spaces at serialization for tab-delimited safety.
- **Constants already inlined.** `basisOfRecord`, `occurrenceStatus`, `geodeticDatum`, `datasetName`, `datasetID`, native-branch `license` are emitted as literal values on every `dwc.occurrences` row (Phase 5 plan-02 decision). Phase 6 emits them as columns — no special-case logic needed.
- **`dwc.multimedia` is ORDER BY observation_id, seq.** Multimedia rows arrive pre-sorted per occurrence; the COPY emits a deterministic byte-stable file (DWCA-03 secondary benefit).
- **`coreId` join key is byte-stable.** `dwc.multimedia.coreId = 'salishsea:' || op.observation_id::text`, matching `dwc.occurrences."occurrenceID"` for native rows. Maplify has no multimedia rows by construction (POLICY §1.4). Anti-join `dwc.multimedia LEFT JOIN dwc.occurrences ON coreId = "occurrenceID"` is empty by construction — Phase 5's assertion harness already covers this; Phase 6 may re-assert as a sanity check before zipping.

### Established Patterns
- **DwC contract lives in SQL.** Phase 5 froze the column projection in the view. Phase 6 is a **thin serializer** — it does NOT decide column shapes, types, or per-record values. Any data-shape change requires a Phase 5 migration, not a Phase 6 code edit. (The Phase 6 EML free-text in `eml.ts` is dataset prose, not record data — different surface; see E-01.)
- **Migrations are the unit of database change.** Phase 6 ships NO new migrations — it is pure consumer code. Any future change to the SQL contract is a Phase 5 / Phase 5b-followup migration, not a Phase 6 concern.
- **Existing scripting convention.** `bin/` houses one CSP-hash utility script (TS). `scripts/dwca/` is a new convention — a multi-file CI/build-only directory. The pattern signal to the reader: anything under `scripts/dwca/` is run by `npm` (locally and in CI), not by Vite, not bundled into the SPA.
- **TS-only stack.** Phase 6 introduces NO new languages. No Python, no bash beyond the package.json script entry.

### Integration Points
- **DuckDB ATTACH Postgres** — Phase 6's `build.ts` connects to Postgres via DuckDB `ATTACH`. Locally: supabase port 54322. In CI (Phase 7): the GH Actions production environment will inject the connection URL as a secret — Phase 6's contract with Phase 7 is **"build.ts reads `process.env.SUPABASE_DB_URL`"** (or whatever final var name Phase 7 picks; Phase 6 plan should make this configurable, not hardcoded).
- **Output handoff to Phase 7.** Phase 6 writes the zip + parquet + (optionally) intermediate files to a stable local directory (recommend `dist/dwca/`). Phase 7 reads from that directory and atomically publishes to S3 under `/dwca/…`. Phase 6's contract: stable filenames, side-effect-free local writes, non-zero exit on any failure.
- **No Phase 8 touch.** The frontend download link (Phase 8) consumes the published URL from Phase 7's S3 location, not Phase 6's local output. Phase 6 has zero frontend coupling.

</code_context>

<specifics>
## Specific Ideas

- The `geographic_coverage` bbox inherits Acartia's cooperative boundaries (36°N–54°N, 136°W–120°W) — significantly wider than the Salish Sea proper. This is **intentional alignment with the upstream aggregator** (the source of Maplify / Whale Alert records), not a claim that SalishSea.io has data across the full bbox. Planner: include a code comment in `eml.ts` linking to Acartia's published boundary spec.
- Phase 7's planning will need to know: **what files Phase 6 produces and where they land.** Recommend `dist/dwca/salishsea-occurrences-v1.zip` and `dist/dwca/salishsea-occurrences-v1.parquet`. The `-v1` slug matches `dataset_id`'s `occurrences-v1` (POLICY §6.3), keeping naming aligned across surfaces.
- The single-field-list assertion (F-02) is the most important DWCA-02 mechanism. It MUST be unskippable — no `--skip-assertions` flag in CI. If `dwc.occurrences` ever gains a 26th column without `fields.ts` being updated, the build SHOULD fail loudly. Don't let it silently emit a meta.xml that's missing a descriptor.
- The 2026-06-09 GeoParquet spike's outputs were ~4.3× smaller than CSV (per REQUIREMENTS.md). Planner does NOT need to re-validate this; the spike's findings are inherited.

</specifics>

<deferred>
## Deferred Ideas

- **Automated CI integration with the GBIF online validator** — for v1.2, manual validator upload during plan-phase verification is sufficient. A future phase could add a `validate-archive` CI job that uploads + polls validator.gbif.org for an exit code. Not v1.2 scope.
- **Per-day archival outputs (run-date-stamped filenames).** Phase 7's atomic-publish-then-swap implies a single stable filename. Keeping date-stamped copies (`salishsea-occurrences-20260618.zip`) for archival history would be useful for researchers tracking dataset drift over time, but it's a hosting concern (Phase 7+) not an export-shape concern.
- **EML version 2.2.0 upgrade.** v1.2 ships EML 2.1.1 (GBIF's expected version). A future phase can upgrade to 2.2.0 if/when GBIF / OBIS registration is pursued.
- **Audubon Core extension for richer multimedia metadata.** Simple Multimedia (the v1.2 extension) carries 6 honest columns; Audubon Core adds rights, technical metadata, etc. Out of scope for v1.2.
- **Native-only archive variant (D-07 / POLICY §4.1).** Explicitly punted to Phase 7/8 planning by Phase 4. Phase 6 does NOT split native vs. third-party output; downstream consumers filter by `datasetName` / `rightsHolder` if they need to.
- **ResourceRelationship extension (travel segments).** v2 only (REQUIREMENTS REL-01); not v1.2.
- **`organismID` / Organism linkage.** v2 only (REQUIREMENTS INDIV-01); not v1.2. The `20260330182547_individual_model.sql` migration (untracked at time of writing) is unrelated to v1.2.
- **iNaturalist & Happywhale records.** v2 only (REQUIREMENTS SRC-01); already published to GBIF by their canonical sources.

</deferred>

---

*Phase: 06-archive-generation*
*Context gathered: 2026-06-17*
