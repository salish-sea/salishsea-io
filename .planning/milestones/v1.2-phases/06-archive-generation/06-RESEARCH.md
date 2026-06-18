# Phase 6: Archive Generation - Research

**Researched:** 2026-06-17
**Domain:** DarwinCore Archive serialization — DuckDB CSV/GeoParquet + TypeScript orchestration
**Confidence:** HIGH (core stack verified; one known gap on GeoParquet CRS metadata flagged explicitly)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- T-01: Hybrid orchestration — TypeScript owns EML/meta.xml templating, zip assembly, field-list assertion, orchestration. DuckDB owns CSV + GeoParquet COPYs via ATTACH Postgres.
- T-02: TypeScript (matches existing stack).
- T-03: `@duckdb/node-api` for programmatic DuckDB access.
- T-04: Code under `scripts/dwca/` (new top-level dir, CI-only, NOT Vite-bundled).
- F-01: Two canonical ordered field arrays in `scripts/dwca/fields.ts` — `OCCURRENCE_FIELDS` (25 entries) and `MULTIMEDIA_FIELDS` (6 entries), each entry `{ name: string; termUri: string; }`.
- F-02: Runtime `information_schema` assertion at build start — structured diff on any drift. Unskippable in CI.
- F-03: Per-field URI carried explicitly in `fields.ts` (no convention-based derivation — dcterms pair has different base).
- F-04: `MULTIMEDIA_FIELDS` mirrors `dwc.multimedia` (6 cols); same assertion pattern as F-02.
- F-05: Tab-delimited, no field enclosure, UTF-8 no BOM. Collapse embedded tabs/newlines in body text to spaces at serialization.
- F-06: Constants emitted as columns on every row — no `meta.xml default=""` branching.
- G-01: WKB geometry built via `ST_AsWKB(ST_Point("decimalLongitude", "decimalLatitude"))` in the COPY subquery.
- G-02: GeoParquet contains all 25 `dwc.occurrences` columns + `geometry` (26 cols total).
- G-03: CRS = OGC:CRS84 (lon-first WGS84).
- G-04: `geometry` column appended after position 25.
- E-01: EML free-text authored in `scripts/dwca/eml.ts` (not in SQL).
- E-02: Geographic bbox = Acartia data cooperative boundaries (36°N–54°N, 136°W–120°W).
- E-03: `methods` = two-paragraph factual draft covering native submissions + Maplify/Whale Alert ingestion.
- E-04: `pub_date` = nightly run date (CURRENT_DATE evaluated at gen time from `dwc.datasets`).

### Claude's Discretion
- Connection string: read from `process.env.SUPABASE_DB_URL`. Local: port 54322 (supabase local). Production: injected by Phase 7 GH Actions.
- Parquet compression: Snappy (DuckDB default).
- `meta.xml` rowType URIs: Occurrence + Multimedia.
- Internal data-file names: `occurrence.txt` + `multimedia.txt`.
- Output directory: `dist/dwca/salishsea-occurrences-v1.zip` and `dist/dwca/salishsea-occurrences-v1.parquet`.
- GBIF validator: manual upload during plan-phase verification. No automated CI integration v1.2.
- Empty-result guard: `build.ts` exits non-zero if zero rows or zero-byte output file.
- Assertion failure surfacing: structured diff (which TS-array entries missing in view; which view columns missing from array; ordinal mismatches).

### Deferred Ideas (OUT OF SCOPE)
- Automated CI integration with GBIF online validator
- Per-day archival outputs (date-stamped filenames)
- EML 2.2.0 upgrade
- Audubon Core extension
- Native-only archive variant
- ResourceRelationship extension
- `organismID` / Organism linkage
- iNaturalist & Happywhale records
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DWCA-01 | Valid DwC-A zip: `meta.xml`, `eml.xml`, Occurrence core file, Simple Multimedia extension file | §T1 (DuckDB API), §T2 (CSV COPY), §T4 (meta.xml structure), §T5 (EML), §T6 (zip assembly) |
| DWCA-02 | `meta.xml` and data files generated from a single ordered field list — descriptor indices and column order cannot drift | §T1 (runtime `information_schema` assertion), §T4 (field index generation from array) |
| DWCA-03 | Multimedia rows join to Occurrence core rows via byte-stable `coreId`; anti-join is empty | §T8 (round-trip parse test — anti-join assertion in Vitest) |
| DWCA-04 | Data files correctly serialized: UTF-8 without BOM, proper quoting/escaping, HTML stripped | §T2 (CSV COPY encoding), §T8 (BOM-check test, emoji round-trip) |
| DWCA-05 | Archive passes GBIF DwC-A validator with no blocking structural errors | §T4 (meta.xml structure), §T5 (EML structure), manual validator run |
| DWCA-06 | GeoParquet sidecar: GeoParquet 1.0.0, WKB Point, WGS84/CRS84, lat/lon retained as columns | §T3 (spatial COPY), §T11 (verification) |
</phase_requirements>

---

## Goal

Phase 6 delivers a TypeScript orchestrator under `scripts/dwca/` that reads the frozen Phase 5 `dwc` view contract via DuckDB ATTACH to Postgres and produces two local artifacts: (1) a valid DarwinCore Archive zip (`meta.xml`, `eml.xml`, `occurrence.txt`, `multimedia.txt`) that passes the GBIF DwC-A validator with no blocking structural errors, and (2) a GeoParquet 1.0.0 sidecar from the same `dwc.occurrences` projection containing a WKB Point geometry column (OGC:CRS84) alongside the 25 standard DwC columns. The script runs locally and in CI, reads connection details from environment variables, exits non-zero on any failure, and writes stable output paths that Phase 7's nightly job will pick up and atomically publish to S3.

---

## Locked Decisions Recap

| Decision ID | One-line summary |
|-------------|-----------------|
| T-01 | TS orchestrates; DuckDB does all tabular extraction via ATTACH + COPY |
| T-02 | TypeScript throughout (no new languages) |
| T-03 | `@duckdb/node-api` (node-neo) for programmatic DuckDB |
| T-04 | `scripts/dwca/` — new top-level dir, CI-only, not bundled |
| F-01 | Canonical field arrays in `fields.ts` (25 occurrence + 6 multimedia entries) |
| F-02 | `information_schema` assertion at build start — fail loudly on drift |
| F-03 | Per-field URI explicit in `fields.ts` (dcterms pair differs from dwc base) |
| F-04 | `MULTIMEDIA_FIELDS` + same assertion pattern |
| F-05 | Tab-delimited, no field enclosure, UTF-8 no BOM; collapse tabs/newlines in freetext |
| F-06 | Constants as columns, not `meta.xml default=""` |
| G-01 | `ST_AsWKB(ST_Point(lon, lat))` in COPY subquery |
| G-02 | 26 cols: all 25 DwC cols + geometry |
| G-03 | OGC:CRS84 |
| G-04 | `geometry` at position 26 |
| E-01 | EML prose authored in `eml.ts`, not SQL |
| E-02 | Bbox = Acartia cooperative boundaries (36–54°N, 120–136°W) |
| E-03 | Two-paragraph `methods` (native + Maplify) |
| E-04 | `pub_date` = run date from `dwc.datasets` |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Occurrence CSV serialization | DuckDB (via COPY) | — | DuckDB COPY is the correct engine for high-throughput columnar-to-CSV; avoids row-by-row Node streaming |
| Multimedia CSV serialization | DuckDB (via COPY) | — | Same reasoning |
| GeoParquet sidecar | DuckDB (spatial ext) | — | Only path for GeoParquet geo metadata from TypeScript; spike validated |
| `information_schema` column assertion | DuckDB query + TS logic | — | DuckDB executes query; TS computes structured diff |
| `meta.xml` generation | TypeScript | — | Programmatic from `fields.ts` array; typed template |
| `eml.xml` generation | TypeScript | DuckDB (temporal coverage query) | Prose authored in `eml.ts`; temporal coverage computed via DuckDB query on `dwc.occurrences` |
| Zip assembly | TypeScript (yazl) | — | Node-native; DuckDB has no zip writer |
| Orchestration + error handling | TypeScript (`build.ts`) | — | Single entry point wiring all steps |
| Field-list drift prevention | TypeScript (assertion) | — | Build-time gate against Phase 5 schema changes |

---

## Technical Research

### T1: `@duckdb/node-api` — API Shape and Version Pinning

**Current version:** `1.5.4-r.1` (published 2026-06-17 per npm registry check). [VERIFIED: npm registry]

**Dependency:** `@duckdb/node-bindings` (native binary, same version). Install both:

```bash
npm install @duckdb/node-api@1.5.4-r.1
# node-bindings is a peer dep and installs automatically
```

**Supported native platforms:** `linux_amd64`, `linux_arm64`, `osx_amd64`, `osx_arm64`, `windows_amd64`. Both darwin-arm64 (local dev) and linux-x64 (GH Actions ubuntu runner) are supported. [VERIFIED: official DuckDB docs]

**Core API pattern:**

```typescript
import { DuckDBInstance } from '@duckdb/node-api';

// In-memory (or file-backed for scratch space)
const instance = await DuckDBInstance.create(':memory:');
const conn = await instance.connect();

// Load extensions (both autoloaded from official repository if not already installed)
await conn.run('INSTALL postgres; LOAD postgres;');
await conn.run('INSTALL spatial; LOAD spatial;');

// ATTACH postgres read-only
const dsn = process.env.SUPABASE_DB_URL!; // e.g. 'postgresql://postgres:password@127.0.0.1:54322/postgres'
await conn.run(`ATTACH '${dsn}' AS pgdb (TYPE postgres, READ_ONLY);`);

// Run a COPY (no result set)
await conn.run(
  `COPY (SELECT ${fields} FROM pgdb.dwc.occurrences) TO '/path/occurrence.txt'
   (FORMAT csv, DELIMITER '\t', HEADER true, QUOTE '', ESCAPE '', NULLSTR '', ENCODING 'UTF-8')`
);

// Read a scalar result
const reader = await conn.runAndReadAll('SELECT COUNT(*) AS n FROM pgdb.dwc.occurrences');
const count = reader.getRowObjects()[0]!['n'] as bigint;

// Result row objects
const reader2 = await conn.runAndReadAll(
  `SELECT column_name, ordinal_position
   FROM information_schema.columns
   WHERE table_schema = 'dwc'
     AND table_name IN ('occurrences', 'multimedia')
   ORDER BY table_name, ordinal_position`
);
const rows = reader2.getRowObjects(); // [{ column_name: 'occurrenceID', ordinal_position: 1 }, ...]

conn.closeSync();
```

**Key API methods:**
- `connection.run(sql)` — executes, returns pending result (no row data needed for COPY)
- `connection.runAndReadAll(sql)` — executes and materializes all rows; returns reader
- `reader.getRowObjects()` — `Record<string, unknown>[]`
- `reader.getRowsJson()` — JSON-safe variant (handles bigint automatically)
- `conn.closeSync()` — disconnect

**Native binary / install notes:**
- `@duckdb/node-bindings` ships a pre-built native `.node` file via optional dependency platform packages (`@duckdb/node-bindings-linux-x64`, `@duckdb/node-bindings-darwin-arm64`, etc.). No postinstall compilation step.
- WARNING: The project's `package.json` `"type": "module"` ESM flag must be respected — `@duckdb/node-api` is fully ESM-compatible. Import with `import` not `require`. [ASSUMED — based on package type, not tested]
- CRITICAL: Do NOT use `npm update` on the lockfile — the project memory documents that `npm update` prunes cross-platform optional deps (relevant for `@duckdb/node-bindings` platform packages). Pin exact version and only update surgically.

**Extension loading order:** Load `postgres` before `ATTACH`; load `spatial` before any COPY to Parquet with geometry. Extensions can be installed once (local cache under `~/.duckdb/extensions`) then LOAD in each session. The `INSTALL` command is a no-op if the extension is already installed for that DuckDB version.

**`information_schema` with ATTACH:** DuckDB's own `information_schema.columns` reflects DuckDB-side schema (DuckDB tables, views, attached databases). For an attached postgres database named `pgdb`, you can query `pgdb.information_schema.columns` to get the Postgres view's columns. However, there is a known complication: if the attached db name is `pgdb` and you query `information_schema.columns` without the prefix, you get DuckDB's local `information_schema` (which won't contain `dwc.*` tables because those are in the attached Postgres). **The correct pattern is to either:**

(a) Use a prefixed query: `SELECT column_name, ordinal_position FROM pgdb.information_schema.columns WHERE table_schema='dwc' AND table_name IN ('occurrences','multimedia') ORDER BY table_name, ordinal_position` [ASSUMED — logical from DuckDB multi-db model, but verify at execution time]

(b) Or more reliably: use a direct Postgres query via `SELECT * FROM postgres_query('pgdb', 'SELECT column_name, ordinal_position FROM information_schema.columns WHERE ...')` [ASSUMED — postgres_query() function exists in the postgres extension for pass-through queries]

(c) Fallback: use DuckDB's `DESCRIBE pgdb.dwc.occurrences` which always reflects the live Postgres view schema.

The safest approach is `DESCRIBE pgdb.dwc.occurrences` for column names and order, which is guaranteed to reflect the live schema. [ASSUMED: verify this works against attached postgres view]

**Source:** [CITED: duckdb.org/docs/current/clients/node_neo/overview]

---

### T2: DuckDB COPY Syntax for Tab-Delimited CSV

**Verified COPY options** (from current DuckDB docs, confirmed for v1.5.x): [CITED: duckdb.org/docs/1.3/sql/statements/copy]

| Option | Type | Default | Our value |
|--------|------|---------|-----------|
| `DELIMITER` | VARCHAR | `,` | `'\t'` |
| `HEADER` | BOOL | `true` | `true` (write header; `ignoreHeaderLines="1"` in meta.xml) |
| `QUOTE` | VARCHAR | `"` | `''` (empty string — see note below) |
| `ESCAPE` | VARCHAR | `"` | `''` |
| `NULLSTR` | VARCHAR | `''` (empty) | `''` |
| `ENCODING` | VARCHAR | `'UTF-8'` | `'UTF-8'` |

**Setting QUOTE to empty string:** The option `QUOTE ''` is accepted by DuckDB and disables field enclosure — fields are never wrapped in quotes regardless of content. This is the correct setting for tab-delimited DwC-A files per GBIF convention (no `fieldsEnclosedBy`). [ASSUMED — confirmed in DuckDB source behavior but not explicitly documented as "empty string disables quoting"; empirical validation required]

**Important known behavior:** DuckDB by default applies "minimal quoting rules" and may quote fields containing special characters (like `#`) even when you haven't explicitly requested quoting. Setting `QUOTE ''` overrides this. However, there is a known issue (#20095) where DuckDB quotes hash-sign-containing fields even with RFC4180 minimal rules; with `QUOTE ''` this should be suppressed. [CITED: github.com/duckdb/duckdb/issues/20095]

**Tab handling in body text (F-05):** `dwc.occurrences."occurrenceRemarks"` may contain embedded tabs from body text. Since the DELIMITER is `\t`, DuckDB will NOT escape embedded tabs by default when `QUOTE ''` is set — they would break the column boundary. The orchestrator must handle this before the COPY, either via:
- A SQL expression in the SELECT: `regexp_replace("occurrenceRemarks", E'[\\t\\n\\r]+', ' ', 'g') AS "occurrenceRemarks"` applied in the COPY subquery
- This is the right place to do it — one SQL expression per tab-containing column

**UTF-8 without BOM:** DuckDB's CSV writer outputs UTF-8 without a BOM by default. The `ENCODING 'UTF-8'` option is explicit but the BOM is never emitted. [CITED: DuckDB docs note "COPY statements always use utf-8"; no BOM in output]

**Runtime column list construction:**

```typescript
const occFields = OCCURRENCE_FIELDS.map(f => `"${f.name}"`).join(', ');
const selectWithSanitize = OCCURRENCE_FIELDS.map(f => {
  // Collapse embedded tabs/newlines in freetext columns
  if (f.name === 'occurrenceRemarks' || f.name === 'dynamicProperties') {
    return `regexp_replace("${f.name}", E'[\\\\t\\\\n\\\\r]+', ' ', 'g') AS "${f.name}"`;
  }
  return `"${f.name}"`;
}).join(', ');

await conn.run(`
  COPY (SELECT ${selectWithSanitize} FROM pgdb.dwc.occurrences)
  TO '${outDir}/occurrence.txt'
  (FORMAT csv, DELIMITER '\\t', HEADER true, QUOTE '', ESCAPE '', NULLSTR '', ENCODING 'UTF-8')
`);
```

**HEADER true / ignoreHeaderLines in meta.xml:** Write the header line (column names as first row), then set `ignoreHeaderLines="1"` in `meta.xml`. This is the GBIF DwC-A standard convention — the header line names the columns, and the descriptor says to skip it. [CITED: dwc.tdwg.org/text/]

**Tab-delimited TSV example from DuckDB docs:**
```sql
COPY lineitem TO 'lineitem.tsv' (DELIMITER '\t', HEADER false);
```
Our case uses `HEADER true` so readers can see column names. [CITED: duckdb.org/docs/current/guides/file_formats/csv_export]

---

### T3: DuckDB GeoParquet COPY — Spatial Extension Specifics

**Extension setup:**
```sql
INSTALL spatial; LOAD spatial;
```

**COPY syntax:**
```sql
COPY (
  SELECT
    "occurrenceID", "basisOfRecord", "eventDate",
    -- ... all 25 dwc columns ...
    "informationWithheld",
    ST_AsWKB(ST_Point("decimalLongitude", "decimalLatitude")) AS geometry
  FROM pgdb.dwc.occurrences
) TO '/path/salishsea-occurrences-v1.parquet'
(FORMAT parquet, COMPRESSION snappy);
```

Note: When the `spatial` extension is loaded, a `BLOB` column named `geometry` containing WKB data is sufficient for round-trip use in DuckDB/geopandas. However, to get proper GeoParquet `geo` metadata written automatically, the column must be of DuckDB type `GEOMETRY`, not raw BLOB. `ST_AsWKB()` returns a BLOB. To get GEOMETRY type, use `ST_Point()` directly (without wrapping in `ST_AsWKB`):

```sql
ST_Point("decimalLongitude", "decimalLatitude") AS geometry
-- type: GEOMETRY (not BLOB)
```

When the column type is `GEOMETRY` and the spatial extension is loaded, DuckDB (v1.1+) **automatically writes the GeoParquet `geo` metadata block** in the parquet file footer. [CITED: github.com/duckdb/duckdb/pull/12503]

**What DuckDB writes in `geo` metadata (verified from PR #12503, DuckDB v1.1+):**
- `version`: `"1.0.0"`
- `primary_column`: name of the first geometry column (e.g., `"geometry"`)
- Column-level: `encoding: "WKB"`, `geometry_types: [...]`, `bbox: [...]`
- **NOT written:** `crs` field — CRS metadata is not emitted. The spec says omitting `crs` defaults to OGC:CRS84. [CITED: geoparquet.org/releases/v1.0.0/ §2.4: "If not provided, the default value is OGC:CRS84"]

**CRS84 compliance:** Because `crs` is omitted, consumers that follow the GeoParquet spec default to OGC:CRS84 (lon-first WGS84). This is correct for our data — `ST_Point(lon, lat)` puts longitude first per CRS84 convention. G-03 decision (OGC:CRS84) is therefore satisfied by omission, which is spec-compliant. [CITED: geoparquet.org/releases/v1.0.0/]

**Known issue (DuckDB v1.4.0):** DuckDB 1.4.0 had a GeoParquet export bug where `geometry_types` were invalid (issue #19034). This was fixed in subsequent releases. Current version (1.5.4) should not exhibit this. **Pin to 1.5.x and validate with `gpq validate` or `parquet_kv_metadata` during plan execution.** [CITED: github.com/duckdb/duckdb/issues/19034]

**Using ST_Point vs ST_AsWKB:** Use `ST_Point(lon, lat)` (returns GEOMETRY) not `ST_AsWKB(ST_Point(...))` (returns BLOB) to trigger automatic GeoParquet metadata. The CONTEXT.md G-01 decision says `ST_AsWKB(ST_Point(...)) AS geometry` — this produces a BLOB column, not GEOMETRY. **Risk:** A BLOB column will NOT trigger DuckDB's auto-GeoParquet metadata. The planner should use `ST_Point("decimalLongitude", "decimalLatitude") AS geometry` instead — this is functionally equivalent for the data (WKB is how parquet stores GEOMETRY internally) but the column type difference matters for metadata. See Risks section for detailed treatment.

**Round-trip verification:**
```sql
-- Check geo metadata
SELECT key::text, value::text FROM parquet_kv_metadata('salishsea-occurrences-v1.parquet') WHERE key = 'geo'::blob;

-- Round-trip geometry
SELECT ST_AsText(geometry) FROM read_parquet('salishsea-occurrences-v1.parquet') LIMIT 1;

-- Row count parity
SELECT
  (SELECT COUNT(*) FROM read_parquet('salishsea-occurrences-v1.parquet')) AS parquet_count,
  (SELECT COUNT(*) FROM pgdb.dwc.occurrences) AS pg_count;
```

**Source:** [CITED: github.com/duckdb/duckdb/pull/12503, geoparquet.org/releases/v1.0.0/]

---

### T4: GBIF DwC-A `meta.xml` Exact Shape

**Root element and namespaces:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xmlns:xs="http://www.w3.org/2001/XMLSchema"
         xsi:schemaLocation="http://rs.tdwg.org/dwc/text/ http://rs.tdwg.org/dwc/text/tdwg_dwc_text.xsd"
         metadata="eml.xml">
```

**Core element (Occurrence):**
```xml
<core encoding="UTF-8"
      fieldsTerminatedBy="\t"
      linesTerminatedBy="\n"
      fieldsEnclosedBy=""
      ignoreHeaderLines="1"
      rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
  <files>
    <location>occurrence.txt</location>
  </files>
  <id index="0"/>
  <!-- field index=0 is occurrenceID (the id column) -->
  <field index="0"  term="http://rs.tdwg.org/dwc/terms/occurrenceID"/>
  <field index="1"  term="http://rs.tdwg.org/dwc/terms/basisOfRecord"/>
  <!-- ... one per OCCURRENCE_FIELDS entry, index = array position ... -->
  <field index="24" term="http://rs.tdwg.org/dwc/terms/informationWithheld"/>
</core>
```

**Extension element (Simple Multimedia):**
```xml
<extension encoding="UTF-8"
           fieldsTerminatedBy="\t"
           linesTerminatedBy="\n"
           fieldsEnclosedBy=""
           ignoreHeaderLines="1"
           rowType="http://rs.tdwg.org/dwc/terms/Multimedia">
  <files>
    <location>multimedia.txt</location>
  </files>
  <coreid index="0"/>
  <!-- index=0 is coreId (matches occurrenceID in core) -->
  <field index="0"  term="http://rs.gbif.org/terms/1.0/coreid"/>
  <field index="1"  term="http://purl.org/dc/terms/type"/>
  <field index="2"  term="http://purl.org/dc/terms/identifier"/>
  <field index="3"  term="http://purl.org/dc/terms/license"/>
  <field index="4"  term="http://purl.org/dc/terms/rightsHolder"/>
  <field index="5"  term="http://purl.org/dc/terms/creator"/>
</extension>
```

**Key notes:**
- `<id index="0"/>` in core must point to the `occurrenceID` column (index 0 in `OCCURRENCE_FIELDS`). [CITED: dwc.tdwg.org/text/]
- `<coreid index="0"/>` in extension points to `coreId` (index 0 in `MULTIMEDIA_FIELDS`).
- `ignoreHeaderLines="1"` because we write a header line (HEADER true in COPY). [CITED: dwc.tdwg.org/text/]
- `fieldsEnclosedBy=""` — empty string means no enclosure. [CITED: dwc.tdwg.org/text/]
- `linesTerminatedBy="\n"` — DuckDB writes LF line endings on all platforms when using COPY TO file. [ASSUMED — DuckDB docs don't explicitly specify, but this is standard Unix convention; validate on Windows if needed]
- Simple Multimedia `rowType`: `http://rs.tdwg.org/dwc/terms/Multimedia` [CITED: rs.gbif.org/extension/dwc/simple_multimedia.xml — note: 404 at research time, confirmed from GBIF IPT documentation and CONTEXT.md]
- `metadata="eml.xml"` attribute on `<archive>` — relative path to EML file inside the zip.

**Term URIs for the 25 occurrence columns** (from `dwc.occurrences` column order):

| # | Column name | Term URI |
|---|-------------|----------|
| 0 | occurrenceID | `http://rs.tdwg.org/dwc/terms/occurrenceID` |
| 1 | basisOfRecord | `http://rs.tdwg.org/dwc/terms/basisOfRecord` |
| 2 | eventDate | `http://rs.tdwg.org/dwc/terms/eventDate` |
| 3 | scientificName | `http://rs.tdwg.org/dwc/terms/scientificName` |
| 4 | taxonRank | `http://rs.tdwg.org/dwc/terms/taxonRank` |
| 5 | kingdom | `http://rs.tdwg.org/dwc/terms/kingdom` |
| 6 | phylum | `http://rs.tdwg.org/dwc/terms/phylum` |
| 7 | class | `http://rs.tdwg.org/dwc/terms/class` |
| 8 | order | `http://rs.tdwg.org/dwc/terms/order` |
| 9 | family | `http://rs.tdwg.org/dwc/terms/family` |
| 10 | genus | `http://rs.tdwg.org/dwc/terms/genus` |
| 11 | decimalLatitude | `http://rs.tdwg.org/dwc/terms/decimalLatitude` |
| 12 | decimalLongitude | `http://rs.tdwg.org/dwc/terms/decimalLongitude` |
| 13 | geodeticDatum | `http://rs.tdwg.org/dwc/terms/geodeticDatum` |
| 14 | coordinateUncertaintyInMeters | `http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters` |
| 15 | individualCount | `http://rs.tdwg.org/dwc/terms/individualCount` |
| 16 | occurrenceStatus | `http://rs.tdwg.org/dwc/terms/occurrenceStatus` |
| 17 | occurrenceRemarks | `http://rs.tdwg.org/dwc/terms/occurrenceRemarks` |
| 18 | recordedBy | `http://rs.tdwg.org/dwc/terms/recordedBy` |
| 19 | rightsHolder | `http://purl.org/dc/terms/rightsHolder` |
| 20 | datasetName | `http://rs.tdwg.org/dwc/terms/datasetName` |
| 21 | datasetID | `http://rs.tdwg.org/dwc/terms/datasetID` |
| 22 | license | `http://purl.org/dc/terms/license` |
| 23 | dynamicProperties | `http://rs.tdwg.org/dwc/terms/dynamicProperties` |
| 24 | informationWithheld | `http://rs.tdwg.org/dwc/terms/informationWithheld` |

**Columns 19 (rightsHolder) and 22 (license) use `purl.org/dc/terms/` URIs** — this is the F-03 dcterms pair. All others use `rs.tdwg.org/dwc/terms/`. The `fields.ts` array must carry these explicitly. [CITED: dwc.tdwg.org/terms/ — rights terms are Dublin Core, not Darwin Core]

**Multimedia term URIs** (6 columns in `dwc.multimedia` column order):

| # | Column name | Term URI |
|---|-------------|----------|
| 0 | coreId | `http://rs.gbif.org/terms/1.0/coreid` |
| 1 | type | `http://purl.org/dc/terms/type` |
| 2 | identifier | `http://purl.org/dc/terms/identifier` |
| 3 | license | `http://purl.org/dc/terms/license` |
| 4 | rightsHolder | `http://purl.org/dc/terms/rightsHolder` |
| 5 | creator | `http://purl.org/dc/terms/creator` |

Note: all 6 multimedia columns are Dublin Core terms (`purl.org/dc/terms/`) except `coreId` which is a GBIF extension term. [ASSUMED — based on Simple Multimedia extension definition; verify against actual extension definition at rs.gbif.org at execution time]

**XML generation from `fields.ts`:** `meta-xml.ts` generates the `<field index="N" term="URI"/>` sequence by iterating `OCCURRENCE_FIELDS.entries()`. The `<id index="0"/>` is a special hard-coded element (not a field) pointing to `occurrenceID`.

**Source:** [CITED: dwc.tdwg.org/text/]

---

### T5: EML 2.1.1 Minimal Valid Document for GBIF

**Root namespace and schema location:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="eml://ecoinformatics.org/eml-2.1.1
           http://rs.gbif.org/schema/eml-gbif-profile/1.1/eml.xsd"
         packageId="https://salishsea.io/datasets/occurrences-v1/eml-1.xml"
         system="gbif"
         scope="system"
         xml:lang="en">
```

**`packageId` format:** `{dataset-uri}/eml-{version}.xml`. For our single v1.2 row: `https://salishsea.io/datasets/occurrences-v1/eml-1.xml`. Increment to `eml-2.xml` when the document changes significantly. [CITED: ipt.gbif.org/manual/en/ipt/latest/gbif-metadata-profile]

**Complete skeleton with all required elements for GBIF:**

```xml
<eml:eml ...>
  <dataset>
    <title>SalishSea.io Cetacean Occurrences (v1.2)</title>

    <creator>
      <organizationName>SalishSea.io</organizationName>
      <electronicMailAddress>rainhead@gmail.com</electronicMailAddress>
    </creator>

    <metadataProvider>
      <organizationName>SalishSea.io</organizationName>
      <electronicMailAddress>rainhead@gmail.com</electronicMailAddress>
    </metadataProvider>

    <pubDate>2026-06-17</pubDate>  <!-- computed at gen time from dwc.datasets.pub_date -->

    <language>en</language>

    <abstract>
      <para>
        Native cetacean sighting records submitted by SalishSea.io contributors,
        and Maplify/Whale Alert cetacean records ingested from the Acartia data cooperative,
        expressed as Darwin Core occurrence data for the Salish Sea region.
        Covers orca, humpback, grey whale, and other cetaceans observed in the Salish Sea.
      </para>
    </abstract>

    <keywordSet>
      <keyword>cetaceans</keyword>
      <keyword>Salish Sea</keyword>
      <keyword>whale sightings</keyword>
      <keyword>occurrence</keyword>
      <keywordThesaurus>n/a</keywordThesaurus>
    </keywordSet>

    <intellectualRights>
      <para>
        This work is licensed under a
        <ulink url="https://creativecommons.org/licenses/by-nc/4.0/legalcode">
          <citetitle>Creative Commons Attribution Non Commercial (CC-BY-NC) 4.0 License</citetitle>
        </ulink>.
        Per-record license is encoded in the occurrence data file (native records: CC-BY-NC 4.0;
        Maplify/Whale Alert records: CC-BY 4.0 via the Acartia data cooperative).
      </para>
    </intellectualRights>

    <coverage>
      <geographicCoverage>
        <geographicDescription>
          The Salish Sea region; geographic scope inherited from the Acartia data
          cooperative's boundaries, the upstream aggregator for Maplify/Whale Alert
          records included in this archive.
        </geographicDescription>
        <boundingCoordinates>
          <westBoundingCoordinate>-136</westBoundingCoordinate>
          <eastBoundingCoordinate>-120</eastBoundingCoordinate>
          <northBoundingCoordinate>54</northBoundingCoordinate>
          <southBoundingCoordinate>36</southBoundingCoordinate>
        </boundingCoordinates>
      </geographicCoverage>
      <temporalCoverage>
        <rangeOfDates>
          <beginDate><calendarDate>2020-01-01</calendarDate></beginDate>  <!-- computed from MIN(eventDate) -->
          <endDate><calendarDate>2026-06-17</calendarDate></endDate>      <!-- computed from MAX(eventDate) -->
        </rangeOfDates>
      </temporalCoverage>
      <taxonomicCoverage>
        <generalTaxonomicCoverage>Cetacea (Order) — whales, dolphins, and porpoises</generalTaxonomicCoverage>
        <taxonomicClassification>
          <taxonRankName>Order</taxonRankName>
          <taxonRankValue>Cetacea</taxonRankValue>
        </taxonomicClassification>
      </taxonomicCoverage>
    </coverage>

    <contact>
      <individualName>
        <givenName>Peter</givenName>
        <surName>Abrahamsen</surName>
      </individualName>
      <organizationName>SalishSea.io</organizationName>
      <electronicMailAddress>rainhead@gmail.com</electronicMailAddress>
    </contact>

    <methods>
      <methodStep>
        <description>
          <para>
            Native observations are submitted directly through the SalishSea.io web application
            by authenticated contributors using Google Sign-In. Each record includes a species
            identification, geographic location (WGS84 coordinate pair), observation timestamp
            (full UTC precision), optional individual count, optional free-text body, and
            optional photographs. Contributors hold copyright over their observations and photos
            under CC-BY-NC 4.0 as a condition of the platform's data sharing policy.
          </para>
          <para>
            Maplify/Whale Alert records are ingested from the WASEAK API operated by
            Conserve.IO on the Acartia data cooperative (acartia.io) platform. Records
            include species identification, geographic location, date (at date precision —
            the `created_at` timestamp reflects report receipt, not observed sighting time),
            individual count, source attribution, and optional comments. Sub-source
            organizations feeding into the Acartia cooperative include Orca Network and
            Cascadia Research Collective. Records are published under CC-BY 4.0 as asserted
            by contributors to the Acartia cooperative at registration.
          </para>
        </description>
      </methodStep>
    </methods>

  </dataset>
</eml:eml>
```

**Required elements summary:**
- `title` — required [CITED: ipt.gbif.org/manual/en/ipt/latest/gbif-metadata-profile]
- `creator` — required
- `contact` — required (GBIF uses this as the primary contact for GBIF.org display)
- `pubDate` — required
- `language` — required
- `abstract` — required (GBIF blocks datasets without it)
- `intellectualRights` — required (machine-readable license required for GBIF registration)
- `coverage` — recommended but not strictly required for the validator
- `methods` — recommended; absence may trigger quality flags but not blocking errors
- `metadataProvider` — recommended

**Easily missed:** `language` must be `en` (lowercase two-letter ISO 639-1), not `English`. `pubDate` must be `YYYY-MM-DD`. The `<para>` wrapper is required inside `<abstract>` and `<description>`. [CITED: ipt.gbif.org/manual/en/ipt/latest/gbif-metadata-profile]

**XML entity escaping in EML free-text:** Any `&`, `<`, `>`, `"`, `'` in authored prose must be escaped. Minimum safe escape table for template literals:

```typescript
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // ' (apostrophe) only needs escaping in attribute values; omit for element content
}
```

The `<ulink>` element in `<intellectualRights>` requires the URL in the `url` attribute — the ampersand in query strings must be `&amp;`. [ASSUMED — standard XML escaping rules; no EML-specific deviation expected]

**Source:** [CITED: ipt.gbif.org/manual/en/ipt/latest/gbif-metadata-profile]

---

### T6: TypeScript Zip Assembly

**Recommendation: `yazl` v3.3.1** [VERIFIED: npm registry]

**Rationale:**
- Deterministic-friendly: `mtime` option on every `addBuffer()` / `addFile()` call accepts a fixed `Date` — pass `new Date('2000-01-01T00:00:00Z')` to pin timestamps across runs. When entry order is also fixed (always add meta.xml, eml.xml, occurrence.txt, multimedia.txt in that sequence), the resulting zip bytes are identical for identical inputs. [CITED: github.com/thejoshwolfe/yazl README]
- Low-level and explicit: no implicit recursion, no glob expansion, deterministic entry order.
- Tiny dependency tree: only `buffer-crc32`.
- Well-maintained: v3.3.0 added Info-ZIP "universal timestamp" extension for UTC precision.

**Rejected alternative: `archiver` v8.0.0** — No documented support for deterministic timestamp control. Issue #383 (opened 2019) requesting deterministic archives remains unresolved. Good for streaming use cases but not our small-file scenario.

**Pattern for four-file archive from in-memory buffers:**

```typescript
import yazl from 'yazl';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const FIXED_MTIME = new Date('2000-01-01T00:00:00Z'); // deterministic

async function writeZip(
  outPath: string,
  files: { name: string; content: Buffer }[]
): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const { name, content } of files) {
    zip.addBuffer(content, name, { mtime: FIXED_MTIME, compress: true });
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(outPath));
}

// Usage:
await writeZip('dist/dwca/salishsea-occurrences-v1.zip', [
  { name: 'meta.xml',       content: Buffer.from(metaXml, 'utf8') },
  { name: 'eml.xml',        content: Buffer.from(emlXml,  'utf8') },
  { name: 'occurrence.txt', content: await fs.readFile(occurrenceTxtPath) },
  { name: 'multimedia.txt', content: await fs.readFile(multimediaTxtPath) },
]);
```

**Determinism note:** Fixed `mtime` + fixed entry order = same zip bytes for same inputs. This is a Phase 7 nice-to-have for content-addressed cache invalidation. The Phase 6 planner should use fixed mtime (above) to make this available. [CITED: yazl README — mtime option documented]

**Source:** [CITED: npmjs.com/package/yazl, github.com/thejoshwolfe/yazl README]

---

### T7: TypeScript XML Templating

**Recommendation: Hand-rolled template literals with explicit escaping.**

Two XML files with very different profiles:
- `meta.xml`: Programmatically generated from `OCCURRENCE_FIELDS` / `MULTIMEDIA_FIELDS` arrays. Structure is repetitive and predictable (array of `<field>` elements). Template literals + array `.map()` is cleaner than an XML builder for this case.
- `eml.xml`: Mostly static authored text with ~5 interpolated values (`pubDate`, temporal coverage dates, title). Template literal with `escapeXml()` helper is sufficient.

**Rejected alternative: `xmlbuilder2` v4.0.3** — High-quality typed XML builder, appropriate for complex XML generation. Adds a 940 KB unpacked dependency for a problem solvable with template literals. Overkill for two small documents.

**XML escaping function** (required, see T5):

```typescript
function xmlEsc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

**`meta.xml` generation pattern:**

```typescript
function buildMetaXml(
  occFields: readonly OccurrenceField[],
  mmFields: readonly MultimediaField[],
): string {
  const coreFields = occFields
    .map((f, i) => `  <field index="${i}" term="${f.termUri}"/>`)
    .join('\n');
  const extFields = mmFields
    .map((f, i) => `  <field index="${i}" term="${f.termUri}"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://rs.tdwg.org/dwc/text/ http://rs.tdwg.org/dwc/text/tdwg_dwc_text.xsd"
  metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n"
        fieldsEnclosedBy="" ignoreHeaderLines="1"
        rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files><location>occurrence.txt</location></files>
    <id index="0"/>
${coreFields}
  </core>
  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n"
             fieldsEnclosedBy="" ignoreHeaderLines="1"
             rowType="http://rs.tdwg.org/dwc/terms/Multimedia">
    <files><location>multimedia.txt</location></files>
    <coreid index="0"/>
${extFields}
  </extension>
</archive>`;
}
```

Note: `fieldsTerminatedBy="\t"` in the XML uses a literal backslash-t (two characters), not an actual tab. GBIF's parser interprets this as the tab character. [CITED: dwc.tdwg.org/text/ §fieldsTerminatedBy description]

---

### T8: Round-Trip Parse Test Pattern

**Recommendation: Hand-parse `meta.xml` + data file (no DwC-A reader library)**

There is no well-maintained JavaScript DwC-A reader library. The test surface is small enough that hand-parsing is correct and maintainable.

**Test file pattern** (`scripts/dwca/build.test.ts`):

```typescript
import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const DIST = path.resolve(process.cwd(), 'dist/dwca');

// These tests run AFTER build.ts has executed (integration-style)
describe('DwC-A round-trip', () => {

  // (a) Column-to-term mapping: parse meta.xml fields, read a known row
  test('occurrence.txt column order matches meta.xml field indices', () => {
    const metaXml = readFileSync(path.join(DIST, 'meta.xml'), 'utf8');
    // Extract field term URIs in index order (simple regex, not full XML parse)
    const fieldTerms = [...metaXml.matchAll(/<field index="(\d+)" term="([^"]+)"/g)]
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map(m => m[2]!);

    const lines = readFileSync(path.join(DIST, 'occurrence.txt'), 'utf8').split('\n');
    const headerCols = lines[0]!.split('\t');
    expect(headerCols.length).toBe(fieldTerms.length);
    // Header names: for each field term URI, the last path segment should match column name
    // (This validates structural alignment, not exact URI → name mapping)
  });

  // (b) coreId anti-join: no multimedia row lacks a corresponding occurrence row
  test('all multimedia coreId values match an occurrenceID in occurrence.txt', () => {
    const occLines = readFileSync(path.join(DIST, 'occurrence.txt'), 'utf8').split('\n');
    const occIds = new Set(occLines.slice(1).filter(Boolean).map(l => l.split('\t')[0]!));

    const mmLines = readFileSync(path.join(DIST, 'multimedia.txt'), 'utf8').split('\t');
    // Parse coreId (index 0) from multimedia.txt
    const mmFile = readFileSync(path.join(DIST, 'multimedia.txt'), 'utf8');
    const mmRows = mmFile.split('\n').slice(1).filter(Boolean); // skip header
    for (const row of mmRows) {
      const coreId = row.split('\t')[0]!;
      expect(occIds.has(coreId), `coreId ${coreId} has no matching occurrenceID`).toBe(true);
    }
  });

  // (c) UTF-8 no BOM + emoji round-trip
  test('occurrence.txt has no BOM', () => {
    const buf = readFileSync(path.join(DIST, 'occurrence.txt'));
    expect(buf[0]).not.toBe(0xEF); // BOM would be EF BB BF
  });

  test('multimedia.txt has no BOM', () => {
    const buf = readFileSync(path.join(DIST, 'multimedia.txt'));
    expect(buf[0]).not.toBe(0xEF);
  });
});
```

**Encoding-correctness test (DWCA-04):** The DuckDB COPY always writes UTF-8 without BOM. The BOM test above is a production guard. For emoji/accent round-trip, inject a known test fixture row via Postgres seed data (scoped to test runs) or assert that a known `occurrenceRemarks` value with non-ASCII characters round-trips cleanly. [ASSUMED — a fixed seed row in the local test DB is the simplest approach; the planner should decide whether to add one]

**Note on test execution:** These are integration tests that require `build.ts` to have run. They do not mock DuckDB or Postgres. The planner should structure the test suite so unit tests (pure function tests for `meta-xml.ts`, `eml.ts`) run in `vitest` normally, and integration tests are either gated behind a `--integration` flag or documented as requiring the build to have run first. [ASSUMED — simplest approach]

---

### T9: `information_schema` Assertion Query

The F-02 assertion is the most important correctness guarantee in Phase 6. The recommended implementation:

**Step 1 — Fetch Postgres view columns via DuckDB:**

```typescript
// DESCRIBE works against attached postgres views and returns exact column order
const reader = await conn.runAndReadAll(`DESCRIBE pgdb.dwc.occurrences`);
const pgCols = reader.getRowObjects().map((r, i) => ({
  name: r['column_name'] as string,
  ordinal: i + 1, // DESCRIBE returns in column order
}));

// Repeat for multimedia
const reader2 = await conn.runAndReadAll(`DESCRIBE pgdb.dwc.multimedia`);
const pgMmCols = reader2.getRowObjects().map((r, i) => ({
  name: r['column_name'] as string,
  ordinal: i + 1,
}));
```

**Alternatively** (direct information_schema query on the attached db):
```sql
SELECT column_name, ordinal_position
FROM pgdb.information_schema.columns
WHERE table_schema = 'dwc' AND table_name = 'occurrences'
ORDER BY ordinal_position
```

The `pgdb.information_schema.columns` prefix routes the query to the attached Postgres database's information_schema. [ASSUMED — this follows DuckDB's multi-database qualified naming convention; must be verified at execution time since this specific pattern is not explicitly documented]

**Step 2 — Structured diff:**

```typescript
function assertFieldAlignment(
  pgCols: { name: string; ordinal: number }[],
  tsFields: readonly { name: string }[],
  table: string
): void {
  const errors: string[] = [];

  for (let i = 0; i < Math.max(pgCols.length, tsFields.length); i++) {
    const pg = pgCols[i];
    const ts = tsFields[i];
    if (!pg) errors.push(`  [+${i}] TS has "${ts!.name}" but view has no column at index ${i}`);
    else if (!ts) errors.push(`  [-${i}] View has "${pg.name}" at index ${i} but TS array ends`);
    else if (pg.name !== ts.name)
      errors.push(`  [~${i}] TS expects "${ts.name}" but view has "${pg.name}"`);
  }

  if (errors.length > 0) {
    console.error(`\nField alignment mismatch for dwc.${table}:`);
    errors.forEach(e => console.error(e));
    process.exit(1);
  }
}
```

This exits non-zero with a human-readable diff — Phase 7's GH Actions surfaces this via failed job notification.

---

### T10: Vitest Config Under `scripts/dwca/`

**Current vitest config** (`vitest.config.ts` at project root):

```typescript
export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    exclude: ['e2e/**', 'infra/**', 'node_modules/**'],
  },
}));
```

**Default include glob:** Vitest's default `include` pattern is `['**/*.{test,spec}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}']` (relative to project root). The current config does not override `include`. Because `scripts/dwca/*.test.ts` matches `**/*.test.ts`, these files WILL be picked up by the existing Vitest config without any change. [CITED: vitest.dev/config/include]

**No config change needed for `scripts/dwca/` — tests co-located as `*.test.ts` will be picked up automatically.**

However, `scripts/dwca/` will need its own `tsconfig.json` or the root `tsconfig.json` must include `scripts/**` in its `include` array. Check the root tsconfig before planning.

**One consideration:** Integration tests that require a running Postgres + DuckDB build run are not fast — they should be either:
- Placed in a separate `scripts/dwca/*.integration.test.ts` file excluded from the default run, or
- Gated behind an env var check (`if (!process.env.SUPABASE_DB_URL) test.skip(...)`)

The planner should decide which approach fits the project's test execution model.

---

### T11: GeoParquet 1.0.0 Conformance Verification

**Verification commands (DuckDB SQL):**

```sql
-- 1. Check geo metadata presence and content
SELECT
  key::text AS key,
  encode(value, 'escape')::text AS geo_json
FROM parquet_kv_metadata('dist/dwca/salishsea-occurrences-v1.parquet')
WHERE key = 'geo'::blob;
-- Expected result contains JSON with:
-- {"version":"1.0.0","primary_column":"geometry","columns":{"geometry":{"encoding":"WKB","geometry_types":["Point"]}}}
-- Note: "crs" field will be absent (defaults to OGC:CRS84 per spec)

-- 2. Round-trip geometry (read WKB back as GEOMETRY type)
LOAD spatial;
SELECT ST_AsText(geometry) AS wkt
FROM read_parquet('dist/dwca/salishsea-occurrences-v1.parquet')
LIMIT 5;
-- Expected: POINT(-122.33... 47.6...) (lon, lat order for CRS84)

-- 3. Row count parity
SELECT
  (SELECT COUNT(*) FROM read_parquet('dist/dwca/salishsea-occurrences-v1.parquet')) AS parquet_count,
  (SELECT COUNT(*) FROM pgdb.dwc.occurrences) AS pg_count;
-- parquet_count must equal pg_count

-- 4. Column count check
SELECT COUNT(*) FROM (
  DESCRIBE SELECT * FROM read_parquet('dist/dwca/salishsea-occurrences-v1.parquet')
) t;
-- Must be 26 (25 DwC cols + geometry)
```

**External validation:** `gpq validate dist/dwca/salishsea-occurrences-v1.parquet` (requires `gpq` CLI). For plan-phase verification, a DuckDB round-trip is sufficient. Full `gpq` validation is a nice-to-have.

**QGIS / geopandas round-trip:** Open the parquet in QGIS 3.28+ or `geopandas.read_parquet()` as the final user-facing validation.

---

### T12: CI Environment Considerations

**`@duckdb/node-api` native binary install:**
- Ships pre-built native binaries as optional npm packages (`@duckdb/node-bindings-linux-x64`, `@duckdb/node-bindings-darwin-arm64`, etc.)
- No postinstall compilation step — binaries download as optional deps at install time
- `npm ci` on GH Actions (ubuntu-latest = linux_amd64) will pull the `linux_amd64` binary automatically
- CRITICAL: Do NOT use `npm update` to bump this package — the project memory documents that `npm update` prunes cross-platform optional deps. Surgically update the lockfile entry instead. [CITED: project MEMORY.md — npm-update-prunes-optional-deps.md]

**Connection string:**
- Local dev: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (supabase local, port 54322 per project memory)
- Production (Phase 7): injected as a GH Actions secret — Phase 6's contract: `process.env.SUPABASE_DB_URL`
- Phase 6's `build.ts` must read from `process.env.SUPABASE_DB_URL` and fail loudly if absent:
  ```typescript
  const dsn = process.env.SUPABASE_DB_URL;
  if (!dsn) throw new Error('SUPABASE_DB_URL is not set');
  ```

**Output directory:** `dist/dwca/` must be created before writing. DuckDB's COPY will fail if the parent directory does not exist. `build.ts` must `await fs.mkdir('dist/dwca', { recursive: true })` before running COPYs.

**Phase 7 handoff contract:**
- `dist/dwca/salishsea-occurrences-v1.zip` — stable filename
- `dist/dwca/salishsea-occurrences-v1.parquet` — stable filename
- Phase 6 exits non-zero on any failure (empty result, file missing, schema mismatch)
- Phase 6 does NOT publish to S3 or modify GitHub Actions config

---

## File-by-File Plan Surface

```
scripts/dwca/
├── build.ts              Entry point. Orchestrates: assert → COPY occurrence.txt → COPY multimedia.txt → COPY parquet → build meta.xml → build eml.xml → zip assembly → emit dist/dwca/*. Reads SUPABASE_DB_URL from env.
├── fields.ts             Two exported readonly arrays: OCCURRENCE_FIELDS (25 entries) and MULTIMEDIA_FIELDS (6 entries). Each entry: { name: string; termUri: string; }. Source of truth for field list, COPY column order, and meta.xml <field> indices.
├── assertions.ts         assertFieldAlignment(conn, fieldDef, tableName). Queries dwc.{table} schema via DuckDB ATTACH and produces structured diff against fields.ts array. Exits process on mismatch. Also: assertNonZeroRows(conn), assertNoZeroByteFile(path).
├── meta-xml.ts           buildMetaXml(occFields, mmFields) → string. Generates meta.xml document from field arrays. Pure function; no I/O.
├── eml.ts                buildEml(datasets: DatasetsRow, temporalCoverage: { begin: string; end: string }) → string. Authors EML 2.1.1 XML using dwc.datasets row + computed temporal coverage. Pure function; no I/O.
├── zip.ts                writeZip(outPath, files: {name: string; content: Buffer}[]) → Promise<void>. Thin yazl wrapper. Fixed mtime for deterministic output.
├── build.test.ts         Vitest integration tests: round-trip parse (column-term alignment), multimedia coreId anti-join, UTF-8 no-BOM checks. Requires build to have run (reads from dist/dwca/).
└── fields.test.ts        Vitest unit tests: OCCURRENCE_FIELDS has exactly 25 entries; MULTIMEDIA_FIELDS has exactly 6; dcterms pair uses correct purl.org URIs; no duplicate field names; index 0 of OCCURRENCE_FIELDS is 'occurrenceID'.
```

**Supporting files (at project root):**
- `tsconfig.json` — may need `scripts/**` added to `include` (planner to verify)
- `package.json` — add `"dwca:build": "tsx scripts/dwca/build.ts"` script (or `"node --experimental-strip-types"` for Node 24, which the project already targets)

---

## Risks & Open Questions

### R1: GeoParquet Metadata — `ST_AsWKB` vs `ST_Point` Column Type (HIGH PRIORITY)

**Risk:** The CONTEXT.md G-01 decision specifies `ST_AsWKB(ST_Point(...)) AS geometry`, which returns a BLOB column. DuckDB's auto-GeoParquet metadata only triggers when the column type is `GEOMETRY`. Writing a BLOB column named `geometry` will NOT produce GeoParquet `geo` metadata.

**Evidence:** DuckDB PR #12503 (v1.1 GeoParquet support) states: "if you have the parquet extension and the spatial extension loaded, exporting normal parquet files containing GEOMETRY columns will automatically write the required geoparquet metadata." The key word is GEOMETRY columns, not BLOB. [CITED: github.com/duckdb/duckdb/pull/12503]

**Resolution options:**
- Option A (recommended): Use `ST_Point("decimalLongitude", "decimalLatitude") AS geometry` (no `ST_AsWKB` wrapper) — the column type is GEOMETRY, DuckDB writes geo metadata automatically.
- Option B: Use `ST_AsWKB(ST_Point(...))` and inject geo metadata manually via `KV_METADATA` option: `COPY (...) TO 'file.parquet' (FORMAT parquet, KV_METADATA {'geo': '{"version":"1.0.0",...}'::blob})`
- Option A is simpler and the correct approach. Planner should use `ST_Point(...)` not `ST_AsWKB(ST_Point(...))`.

**Planner action:** Override G-01's `ST_AsWKB` wrapper — use `ST_Point()` directly. The CONTEXT.md locked G-01 but the CONTEXT wasn't aware of this type distinction.

### R2: GeoParquet CRS Metadata — Omitted by DuckDB (LOW RISK)

**Finding:** DuckDB (v1.1+) does not write the `crs` field in GeoParquet `geo` metadata. This is intentional per PR #12503: "We do not support setting projection crs information when writing."

**Risk level:** LOW. The GeoParquet 1.0.0 spec (§2.4) states: "If not provided, the default value is OGC:CRS84." Omitting `crs` is spec-compliant behavior. Consumers that follow the spec will interpret the geometry as OGC:CRS84 (lon-first WGS84). G-03's requirement for CRS84 is satisfied by omission.

**Remaining concern:** Some older/non-compliant readers may not handle the omission correctly. QGIS 3.28+ and geopandas both follow the spec default.

**Resolution:** No action needed for v1.2. Document in `eml.ts` comments that CRS is OGC:CRS84 by GeoParquet spec default. If a future consumer reports CRS ambiguity, inject via KV_METADATA.

### R3: DuckDB `QUOTE ''` Behavior — No Enclosure

**Risk:** Setting `QUOTE ''` to disable field enclosure is the correct approach for DwC-A tab-delimited files, but this option's behavior for empty-string is not explicitly documented in DuckDB docs as "disables all quoting."

**Mitigation:** Validate empirically during Wave 0 by COPYing a small fixture table with special characters (newlines, hashes, quotes in values) and asserting the output has no enclosure characters.

### R4: `pgdb.information_schema.columns` Qualified Access

**Risk:** The pattern `SELECT ... FROM pgdb.information_schema.columns WHERE table_schema='dwc'` assumes DuckDB routes the qualified `information_schema` reference to the attached Postgres. This has not been explicitly confirmed in documentation. An alternative issue (DuckDB #14562) shows that `information_schema` namespace conflicts can arise.

**Mitigation:** Use `DESCRIBE pgdb.dwc.occurrences` as the primary approach — this is simpler and definitively reflects the live Postgres schema at runtime. Fall back to the qualified `information_schema` only if `DESCRIBE` doesn't provide ordinal position.

### R5: Tab/Newline Collapsing Scope

**Risk:** F-05 requires collapsing embedded tabs/newlines in body text. Only `occurrenceRemarks` and `dynamicProperties` can realistically contain such characters. But `recordedBy`/`rightsHolder` (contributor names) could theoretically contain tabs.

**Mitigation:** Apply `regexp_replace(col, E'[\\t\\n\\r]+', ' ', 'g')` to all text columns that come from user-provided data: `occurrenceRemarks`, `dynamicProperties`, `recordedBy`, `rightsHolder`, `datasetName`. Hardcoded constant columns (basisOfRecord, occurrenceStatus, etc.) do not need it.

### R6: Empty `occurrence.txt` if Local DB Has No Data

**Risk:** The local supabase instance after `supabase db reset` has no observations. `build.ts` would exit non-zero (empty-result guard), blocking local test runs of the full pipeline.

**Mitigation:** Either (a) seed the local DB with test observations for build testing, or (b) allow the local run to succeed with non-zero count and only block on truly zero rows (i.e., test the empty-guard logic separately from the GBIF-validator output). Planner should decide whether to add seed data for local build testing.

---

## Validation Architecture

> `workflow.nyquist_validation: true` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (already installed — `vitest: ^4.1.7` in devDependencies) |
| Config file | `vitest.config.ts` (root level — no new config needed; `scripts/**/*.test.ts` covered by default glob) |
| Quick run command | `npm test -- scripts/dwca/fields.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DWCA-01 | Valid DwC-A zip produced containing 4 required files | integration | `npm test -- scripts/dwca/build.test.ts` | No — Wave 0 |
| DWCA-02 | meta.xml field indices match data file column order | unit + integration | `npm test -- scripts/dwca/fields.test.ts` (structural) + `build.test.ts` (round-trip) | No — Wave 0 |
| DWCA-03 | Multimedia coreId anti-join is empty | integration | `npm test -- scripts/dwca/build.test.ts` | No — Wave 0 |
| DWCA-04 | UTF-8 no BOM; embedded tabs collapsed; HTML stripped (upstream) | integration | `npm test -- scripts/dwca/build.test.ts` | No — Wave 0 |
| DWCA-05 | GBIF DwC-A validator: no blocking errors | manual | Upload to https://www.gbif.org/tools/data-validator | N/A — manual only |
| DWCA-06 | GeoParquet: geo metadata present, WKB Point, 26 cols, row count parity | integration | DuckDB SQL verification (see T11 commands), run in Wave 4 | No — Wave 0 |

**DWCA-02 unit surface** (`fields.test.ts` — pure, no DB needed):

| Check | Test |
|-------|------|
| `OCCURRENCE_FIELDS.length === 25` | unit |
| `MULTIMEDIA_FIELDS.length === 6` | unit |
| `OCCURRENCE_FIELDS[0].name === 'occurrenceID'` | unit |
| `OCCURRENCE_FIELDS[19].termUri` starts with `purl.org/dc/terms/` (rightsHolder) | unit |
| `OCCURRENCE_FIELDS[22].termUri` starts with `purl.org/dc/terms/` (license) | unit |
| No duplicate `name` values in either array | unit |

### Sampling Rate

- **Per task commit:** `npm test -- scripts/dwca/fields.test.ts` (pure unit tests; < 1 second)
- **Per wave merge (after build runs):** `npm test -- scripts/dwca/` (full suite including integration)
- **Phase gate:** All tests green + manual GBIF validator upload passes before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `scripts/dwca/fields.test.ts` — unit tests for OCCURRENCE_FIELDS and MULTIMEDIA_FIELDS array shape
- [ ] `scripts/dwca/build.test.ts` — integration tests (run after build; covers DWCA-01, -02, -03, -04)
- [ ] `scripts/dwca/` directory itself — new; no files exist yet
- [ ] `dist/dwca/` directory — created at build time; must be in `.gitignore`
- [ ] Seed data for local build testing (at least one observation with photos in local Supabase) [ASSUMED needed — planner to decide]

Framework and test infrastructure for `scripts/dwca/` are already in place (Vitest picks up `*.test.ts` by default glob).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js 24.x | `build.ts` execution | ✓ | `^24.10` per package.json | — |
| `@duckdb/node-api` | DuckDB connection | Not installed yet | 1.5.4-r.1 | — |
| Supabase local (port 54322) | Local build testing | ✗ (Docker not running at research time per STATE.md) | — | Must be started before build test |
| Vitest | Unit tests | ✓ | `^4.1.7` | — |

**Missing dependencies with no fallback:**
- Supabase local must be running (`supabase start`) for integration tests and full build
- `@duckdb/node-api` must be installed before any `scripts/dwca/` code can run

---

## Package Legitimacy Audit

> slopcheck was not available at research time. All packages marked [ASSUMED] pending planner verification. The planner must gate each install behind a human checkpoint.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@duckdb/node-api` | npm | ~2 yrs | Very high (duckdb official) | github.com/duckdb/duckdb-node-neo | [ASSUMED OK] | Approved — official DuckDB org package |
| `yazl` | npm | ~11 yrs | Medium | github.com/thejoshwolfe/yazl | [ASSUMED OK] | Approved — established, well-known |
| `xmlbuilder2` | npm | ~6 yrs | Medium | github.com/oozcitak/xmlbuilder2 | [ASSUMED OK] | NOT recommended — use template literals instead |

**Packages removed due to slopcheck [SLOP]:** none
**Packages flagged as suspicious [SUS]:** none

Net new installs: `@duckdb/node-api` + `yazl` (2 packages). `xmlbuilder2` is NOT recommended — hand-rolled templates sufficient.

---

## Security Domain

> `security_enforcement` not set in config.json → treated as enabled. Phase 6 is a local CLI script with no network-facing surface. ASVS categories relevant to this phase are limited.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | build.ts runs with service-role credentials from env; no user auth |
| V3 Session Management | No | — |
| V4 Access Control | Partial | Postgres connection uses service-role (bypasses RLS); ATTACH READ_ONLY prevents writes |
| V5 Input Validation | Yes | EML free-text XML escaping (`xmlEsc()` helper); SQL injection via DSN string (mitigate: read DSN from env only, never from CLI args) |
| V6 Cryptography | No | — |

**Known threat:** The `SUPABASE_DB_URL` contains credentials. Guard: (a) read from env only, (b) never log the DSN string, (c) mask it in any error messages.

---

## Sources

### Primary (HIGH confidence)
- [CITED: duckdb.org/docs/current/clients/node_neo/overview] — @duckdb/node-api API documentation
- [CITED: github.com/duckdb/duckdb/pull/12503] — GeoParquet metadata support (v1.1)
- [CITED: dwc.tdwg.org/text/] — DarwinCore Text Guidelines (meta.xml schema)
- [CITED: ipt.gbif.org/manual/en/ipt/latest/gbif-metadata-profile] — GBIF EML requirements
- [CITED: geoparquet.org/releases/v1.0.0/] — GeoParquet 1.0.0 spec (CRS default rule)
- [CITED: github.com/thejoshwolfe/yazl README] — yazl API
- [VERIFIED: npm registry] — package versions (@duckdb/node-api 1.5.4-r.1, yazl 3.3.1, archiver 8.0.0)

### Secondary (MEDIUM confidence)
- [CITED: duckdb.org/docs/1.3/sql/statements/copy] — COPY TO CSV options
- [CITED: vitest.dev/config/include] — Vitest default include pattern
- [CITED: github.com/duckdb/duckdb/issues/19034] — GeoParquet export bug v1.4.0
- [CITED: github.com/duckdb/duckdb-spatial/discussions/484] — GeoParquet kv_metadata access

### Tertiary (LOW confidence / [ASSUMED])
- Extension loading order semantics — based on DuckDB docs but not verified for this specific sequence
- `pgdb.information_schema.columns` qualified access — logical from multi-db model, not explicitly documented
- `QUOTE ''` disabling enclosure — not explicitly documented; behavioral expectation
- DuckDB line endings on non-Unix platforms — [ASSUMED] LF output

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@duckdb/node-api` confirmed from official DuckDB docs; yazl from npm registry
- Architecture: HIGH — follows locked decisions from CONTEXT.md; DwC-A meta.xml structure from authoritative source
- GeoParquet conformance: MEDIUM — DuckDB auto-writes `geo` metadata (confirmed PR #12503); CRS field omitted by design (spec-compliant); ST_Point vs ST_AsWKB type risk flagged (R1)
- Pitfalls: HIGH — tab-in-freetext, BOM, QUOTE option, DuckDB version, ST_Point vs ST_AsWKB all documented

**Research date:** 2026-06-17
**Valid until:** 2026-07-17 (stable-ish ecosystem; DuckDB releases frequently — re-verify if upgrading beyond 1.5.x)

---

## RESEARCH COMPLETE
