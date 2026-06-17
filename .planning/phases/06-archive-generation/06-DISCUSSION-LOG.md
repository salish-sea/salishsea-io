# Phase 6: Archive Generation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 06-archive-generation
**Areas discussed:** Tooling, Single ordered field list, Geometry origin for GeoParquet, EML free-text authoring location

---

## Tooling

### Q1: What's the orchestration shape for the export?

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: Node + DuckDB | TS orchestrator; DuckDB does tabular COPYs (CSV + GeoParquet); Node owns XML templating + zip assembly. Spike-validated. | ✓ |
| Pure DuckDB CLI + bash glue | One .sql script + bash wrapper for XML emission via heredoc. EML's nested elements + conditional coverage blocks make bash painful. | |
| Pure Node serializer | `postgres` + `csv-stringify` + `archiver` + parquet-wasm. Roadmap flags GeoParquet in JS as painful. | |

**User's choice:** Hybrid: Node + DuckDB (Recommended)

### Q2: What language for the Node orchestrator?

| Option | Description | Selected |
|--------|-------------|----------|
| TypeScript | Matches Lit + Vite + TS stack and `infra/` CDK convention. Can import `database.types.ts`. | ✓ |
| Plain JS / Node | No compile step. Lighter weight for a small orchestrator. | |
| Python | Best DwC/EML library ecosystem but adds a new toolchain to a TS-only repo. | |

**User's choice:** TypeScript (Recommended)

### Q3: How should the TS orchestrator invoke DuckDB?

| Option | Description | Selected |
|--------|-------------|----------|
| @duckdb/node-api library | Programmatic; lets the orchestrator build COPY column list from `fields.ts`. Spike-proven. | ✓ |
| DuckDB CLI subprocess + .sql file | Standalone .sql is inspectable but splits column list across .sql and meta.xml (drift risk). | |
| DuckDB-WASM in Node | Pure-Node, no native binary. Slower; less mature for COPY-to-Parquet. | |

**User's choice:** @duckdb/node-api library (Recommended)

### Q4: Where should the export code live in the repo?

| Option | Description | Selected |
|--------|-------------|----------|
| scripts/dwca/ | Dedicated multi-file dir aligning with `npm run build:dwca` Phase 7 entry. | ✓ |
| bin/ | Existing utility-scripts convention; tight for multi-file. | |
| src/dwca/ | Co-located with app source — but export is CI-only, not Vite-bundled. | |

**User's choice:** scripts/dwca/ (Recommended)

---

## Single ordered field list (DWCA-02)

### Q1: Where should the canonical ordered field list live?

| Option | Description | Selected |
|--------|-------------|----------|
| TS config + runtime assertion | `scripts/dwca/fields.ts` ordered array; assert at startup against `information_schema.columns`. Drift caught at build time. | ✓ |
| SQL view is source of truth | Introspect `dwc.occurrences` via `information_schema` at gen time; derive URIs from name. Zero-drift but needs override table for non-DwC URIs. | |
| Generated from one shared template | Build pre-step writes both meta.xml and fields.ts from a YAML spec. Adds code-gen step. | |

**User's choice:** TS config + runtime assertion (Recommended)

**Notes:** During analysis, identified that `rightsHolder` and `license` are Dublin Core terms (`http://purl.org/dc/terms/...`), not DwC. This rules out pure name-based URI derivation and validates the TS-config approach with per-field URI as data.

### Q2: Does the same single-field-list pattern govern multimedia.txt's descriptors?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — mirror pattern | Second exported array in `fields.ts` for `dwc.multimedia` (6 cols); same `information_schema` assertion. | ✓ |
| Hand-author multimedia descriptors | Inline the extension block in meta.xml template. Less code; relies on noticing Phase 5 changes. | |

**User's choice:** Yes — mirror pattern (Recommended)

### Q3: How are data files delimited and quoted?

| Option | Description | Selected |
|--------|-------------|----------|
| Tab-delimited, no enclosure, newlines stripped | GBIF DwC-A default. occurrenceRemarks HTML stripped upstream; collapse tabs/newlines at write time. | ✓ |
| Tab-delimited + fieldsEnclosedBy='"' | Belt-and-suspenders for embedded tabs. Adds escaping rules. | |
| Comma-delimited (CSV / RFC4180) | Familiar but every text field needs quoting + escaping. | |

**User's choice:** Tab-delimited, no enclosure, newlines stripped (Recommended)

### Q4: Should constants be hoisted to meta.xml `default=""` or emitted as columns?

| Option | Description | Selected |
|--------|-------------|----------|
| Emit as columns | Data file mirrors view exactly. Simpler invariant; one COPY = one data file. | ✓ |
| Hoist constants to meta.xml `default=""` | Spec-clean, smaller files; reader-support variance; adds branching to serializer. | |

**User's choice:** Emit as columns (Recommended)

---

## Geometry origin for GeoParquet

### Q1: Where should the WKB Point geometry column come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Built in DuckDB at COPY time | `ST_AsWKB(ST_Point(decimalLongitude, decimalLatitude))`. Spike-validated. View untouched. | ✓ |
| Retrofit dwc.occurrences with geometry column | Adds 26th col; breaks Phase 5's frozen 25-col UNION ALL contract. | |
| Build WKB in TS at write time | Hand-encode in TS; roadmap flags as painful. | |

**User's choice:** Built in DuckDB at COPY time (Recommended)

### Q2: What columns go into the GeoParquet sidecar?

| Option | Description | Selected |
|--------|-------------|----------|
| All 25 dwc.occurrences cols + geometry | Full CSV parity. REQUIREMENTS DWCA-06 explicitly requires retaining lat/lon. | ✓ |
| Curated subset | Leaner; diverges from "same projection" roadmap intent. | |

**User's choice:** All 25 dwc.occurrences cols + geometry (Recommended)

### Q3: What CRS encoding for the GeoParquet `geo` metadata?

| Option | Description | Selected |
|--------|-------------|----------|
| OGC:CRS84 | GeoParquet 1.0.0 default. WGS84 datum, explicit lon-lat axis. Spike used this. | ✓ |
| EPSG:4326 | Familiar identifier but inherits axis-order ambiguity. | |
| Omit CRS (assume default) | Smaller metadata; less explicit. Spec recommends declaring. | |

**User's choice:** OGC:CRS84 (Recommended)

### Q4: Where does the geometry column sit in the parquet schema?

| Option | Description | Selected |
|--------|-------------|----------|
| Appended after the 25 dwc cols | Position 26. Canonical fields.ts ordering preserved. | ✓ |
| First column | Some geo tools prefer; DuckDB/QGIS don't care. | |

**User's choice:** Appended after the 25 dwc cols (Recommended)

---

## EML free-text authoring location

### Q1: Where should the Phase-6-authored EML free-text live?

| Option | Description | Selected |
|--------|-------------|----------|
| TS template in scripts/dwca/eml.ts | Prose lives with serializer. Edits are normal PRs. Mixed pattern already implied (temporal_coverage is computed). | ✓ |
| Phase 6 migration updates dwc.datasets | Maximum SQL consistency; heavy ceremony for prose edits. | |
| Separate authored content file | Cleanest separation; marginal benefit at v1.2 prose length. | |

**User's choice:** TS template in scripts/dwca/eml.ts (Recommended)

### Q2: What geographic bbox should `geographic_coverage` declare?

| Option | Description | Selected |
|--------|-------------|----------|
| Salish Sea Marine Ecoregion bbox (~47.0°N–50.5°N, -125.0°W to -122.0°W) | Canonical Salish Sea scope. | |
| Tighter bbox to sighting density | Smaller bbox; excludes peripheral sightings. | |
| Computed from MIN/MAX at gen time | Realized data bbox; contradicts POLICY §6.5 (stated, not derived). | |
| **Acartia data cooperative boundaries: 36°N–54°N, 136°W–120°W** | **User-provided.** Inherits the upstream aggregator's scope. | ✓ |

**User's choice (free-text):** "The same as the Acartia data cooperative boundaries: 36-54 degrees north, 120-136 degrees west"

**Notes:** This decision intentionally aligns SalishSea.io's stated coverage with the Acartia cooperative — the upstream source of Maplify / Whale Alert records (per POLICY §1.1 D-20). The bbox is significantly wider than the Salish Sea proper; it claims aggregator-aligned scope rather than realized-data scope.

### Q3: How should the `methods` EML text be authored?

| Option | Description | Selected |
|--------|-------------|----------|
| Tight 1-2 paragraph factual draft | Two acquisition mechanics: native via SalishSea.io app; Maplify via Acartia upstream. User reviews. | ✓ |
| Extended prose with rationale + limitations | Adds context but more prose to maintain. | |
| Leave NULL for v1.2 | Defers prose authoring. | |

**User's choice:** Tight 1-2 paragraph factual draft (Recommended)

### Q4: What `pub_date` semantics should the EML use?

| Option | Description | Selected |
|--------|-------------|----------|
| Nightly run date | Honest "published today" semantics. Phase 5's CURRENT_DATE already encodes this. | ✓ |
| Pin a constant v1.2 release date | Stable across runs; same pub_date for changing content. | |
| Last-modified date (MAX of observation timestamps) | Different semantics: "data through {date}." | |

**User's choice:** Nightly run date (Recommended)

---

## Claude's Discretion

- DuckDB → Postgres connection string read from env (`SUPABASE_DB_URL` or similar); Phase 7 supplies via GH Actions secret.
- Parquet compression codec: snappy (DuckDB default).
- `meta.xml` `rowType` URIs (Occurrence / Multimedia); EML version 2.1.1.
- Internal data-file names inside the zip (`.txt` GBIF convention recommended).
- Zip filename and output directory (recommend `dist/dwca/salishsea-occurrences-v1.zip` + `.parquet`).
- GBIF validator integration strategy: manual upload during plan-phase verification + round-trip parse in assertion harness; no automated CI integration.
- Phase 6 empty-result guard: exit non-zero on zero rows or zero-byte file; richer atomic-publish guard is Phase 7's concern.
- Assertion-failure surfacing: structured diff exit message.

## Deferred Ideas

- Automated CI integration with GBIF online validator (future phase).
- Per-day archival outputs (run-date-stamped filenames) — Phase 7+ hosting concern.
- EML version 2.2.0 upgrade (when GBIF/OBIS registration is pursued).
- Audubon Core extension for richer multimedia metadata (out of v1.2 scope).
- Native-only archive variant (POLICY §4.1 / D-07; Phase 7/8 planning).
- ResourceRelationship extension (v2 / REL-01).
- `organismID` linkage (v2 / INDIV-01).
- iNaturalist & Happywhale records (v2 / SRC-01).
