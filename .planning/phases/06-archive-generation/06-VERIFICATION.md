---
phase: 06-archive-generation
verified: 2026-06-18T08:42:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "The produced archive passes the GBIF DwC-A validator with no blocking (structural) errors"
    reason: "GBIF data validator service (https://www.gbif.org/tools/data-validator) is offline upstream as of 2026-06-18. Deterministic zip is in hand at dist/dwca/salishsea-occurrences-v1.zip and ready for re-upload once the service returns; FIXED_MTIME guarantees the verdict will be reproducible. Local integration tests prove DWCA-01..04/06 structurally — the validator is the external corroboration step, not the structural gate. Plan owner adjudicated at 06-06-SUMMARY.md."
    accepted_by: "rainhead"
    accepted_at: "2026-06-18T00:00:00Z"
deferred:
  - truth: "DWCA-05: archive passes the GBIF DwC-A validator with no blocking errors"
    addressed_in: "Phase 6 follow-up (post-validator-return)"
    evidence: "06-06-SUMMARY.md §DWCA-05 — DEFERRED documents queued follow-up: re-upload deterministic zip once gbif.org/tools/data-validator returns online; update REQUIREMENTS.md DWCA-05 row from Pending to Complete."
---

# Phase 6: Archive Generation — Verification Report

**Phase Goal:** A thin serializer reads the `dwc` views and produces a valid DwC-A zip — `meta.xml` + `eml.xml` + Occurrence core + Simple Multimedia extension — that passes the GBIF validator, with descriptor and serializer driven from one ordered field list so indices cannot drift.

**Verified:** 2026-06-18T08:42:00Z
**Status:** passed (with one validator deferral via override)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Phase 6 Success Criteria)

| #   | Truth                                                                                                                                                                | Status               | Evidence                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Running the export locally produces a `.zip` containing `meta.xml`, `eml.xml`, an Occurrence core file, and a Simple Multimedia extension file for photos.           | VERIFIED             | `scripts/dwca/build.ts` step 20 (lines 357-362) writes a four-entry zip via `writeZip` with hardcoded entry names. `build.test.ts` test 1 (line 84) asserts the zip exists and `unzip -l` reports all four entries. Live run 2026-06-18 passed. |
| 2   | `meta.xml` and the data files are generated from a single ordered field list; round-trip parse of a known record confirms each value maps to the expected DwC term.  | VERIFIED             | `OCCURRENCE_FIELDS` / `MULTIMEDIA_FIELDS` in `fields.ts` are imported by `meta-xml.ts` (descriptor) AND by `build.ts` `buildSelectList()` (CSV header + COPY column list). `build.test.ts` tests 3, 4, 9 round-trip the descriptor end-to-end.  |
| 3   | Every Multimedia row joins to an Occurrence core row via a byte-stable `coreId` — anti-join is empty.                                                                | VERIFIED             | `build.test.ts` test 5 asserts every multimedia.coreId ∈ occurrence.occurrenceID set. Inherited from Phase 5 `dwc.multimedia.coreId = 'salishsea:' \|\| op.observation_id::text` byte-stability guarantee.                                      |
| 4   | Data files are serialized as UTF-8 without BOM, freeform body text correctly quoted/escaped, HTML stripped, accents/emoji round-tripping intact.                     | VERIFIED             | `build.ts` step 19 (line 349) asserts no BOM; step 9-10 use `QUOTE '', ESCAPE ''` with regexp_replace tab-collapse on user-content cols. `build.test.ts` tests 6, 7, 8 assert no BOM + exact 25-col splits. HTML strip inherited from Phase 5.   |
| 5   | The produced archive passes the GBIF DwC-A validator with no blocking (structural) errors.                                                                           | PASSED (override)    | Override: GBIF validator service offline upstream 2026-06-18 — accepted by rainhead. Deterministic zip preserved at `dist/dwca/salishsea-occurrences-v1.zip` (FIXED_MTIME = 2000-01-01) ready for re-upload. Structural gates 1-4, 6 PASSED.    |
| 6   | A GeoParquet sidecar is produced from the same `dwc.occurrences` projection — GeoParquet 1.0.0, WKB Point geometry (WGS84/CRS84), with `decimalLatitude`/`decimalLongitude` retained, round-trips in DuckDB. | VERIFIED | `build.ts` step 11 emits 26 cols via `ST_Point(decimalLongitude, decimalLatitude) AS geometry`; step 12 verifies `geo.version='1.0.0'`, `primary_column='geometry'`, `encoding='WKB'` via `parquet_kv_metadata`. R1 confirmed empirically 2026-06-18. `build.test.ts` test 10 re-asserts from outside the build process. |

**Score:** 6/6 truths verified (5 directly, 1 via accepted override for upstream-offline validator)

### Deferred Items

| # | Item                                                                                | Addressed In           | Evidence                                                                                                                |
| - | ----------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1 | DWCA-05: re-upload deterministic zip to GBIF validator when service returns online. | Phase 6 follow-up      | 06-06-SUMMARY.md §DWCA-05 lists 5-step follow-up: wait for service, re-run build, upload zip, confirm verdict, update REQUIREMENTS.md. |

### Required Artifacts

| Artifact                              | Expected                                                                | Status              | Details                                                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/dwca/fields.ts`              | Canonical 25 + 6 ordered field arrays; single source of truth (F-01/F-03) | VERIFIED            | 96 lines. `OCCURRENCE_FIELDS` (25 entries, indices 19/22 use dcterms URIs) + `MULTIMEDIA_FIELDS` (6 entries, index 0 uses GBIF coreid URI). Imported by build.ts, meta-xml.ts, build.test.ts.                  |
| `scripts/dwca/meta-xml.ts`            | Pure `buildMetaXml(occFields, mmFields)` generator                       | VERIFIED            | 76 lines. Pure function; descriptor indices derive from array position. Literal `\\t` / `\\n` escapes per GBIF text guidelines. Imported by build.ts step 17.                                                  |
| `scripts/dwca/eml.ts`                 | Pure `buildEml({datasets, temporalCoverage})` generator                  | VERIFIED            | 220 lines. EML 2.1.1 envelope, Acartia bbox (36–54°N, -136 to -120°W), two-paragraph methods, full xmlEsc on all DatasetsRow text. Imported by build.ts step 17.                                               |
| `scripts/dwca/assertions.ts`          | `assertFieldAlignment` (F-02 runtime guard) + zero-row + zero-byte guards | VERIFIED            | 163 lines. Three guards: `AlignmentError` carries structured diff; `assertNonZeroRows` returns bigint count; `assertNoZeroByteFile` stats path. All imported by build.ts.                                      |
| `scripts/dwca/zip.ts`                 | Deterministic yazl wrapper with FIXED_MTIME                              | VERIFIED            | 94 lines. `FIXED_MTIME = 2000-01-01T00:00:00Z` pins every entry; six-pattern path-traversal validator; preserves input order. Imported by build.ts step 20.                                                    |
| `scripts/dwca/build.ts`               | Orchestrator: ATTACH → assert → COPY × 3 → R1 verify → build XML → zip   | VERIFIED            | 391 lines, 22 numbered steps. DSN guard, F-02 guards, R1 GeoParquet metadata verification (FAIL LOUDLY), row-count parity, BOM defense-in-depth, deterministic zip assembly.                                   |
| `scripts/dwca/yazl.d.ts`              | TS type declaration for yazl                                             | VERIFIED            | 30 lines. Module declaration covering `yazl.ZipFile`, `addBuffer({mtime, compress})`, `end()`, `outputStream`.                                                                                                 |
| `scripts/dwca/*.test.ts` (6 files)    | Vitest coverage for fields, meta-xml, eml, assertions, zip, build        | VERIFIED            | 5 unit suites (fields/meta-xml/eml/assertions/zip — 75 tests) + `build.test.ts` (10 DSN-gated integration tests). `npx vitest run scripts/dwca/` = 85 passed, 10 skipped, 0 failed.                            |
| `package.json` `build:dwca` script    | `npm run build:dwca` invokes `tsx scripts/dwca/build.ts`                  | VERIFIED            | Confirmed via JSON read: `"build:dwca": "tsx scripts/dwca/build.ts"`. Deps `@duckdb/node-api@1.5.4-r.1`, `yazl@3.3.1`, `tsx@^4.22.4` all present.                                                               |
| `tsconfig.json` includes `scripts/`   | scripts/ dir typechecked by repo tsc                                     | VERIFIED            | `"include": ["src", "database.types.ts", "scripts"]`. `npx tsc -p . --noEmit` exits 0.                                                                                                                        |

### Key Link Verification

| From                    | To                                | Via                                                       | Status | Details                                                                                                                            |
| ----------------------- | --------------------------------- | --------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `build.ts`              | `fields.ts`                       | `import { OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS }`         | WIRED  | line 31; consumed in steps 6/7 (alignment guards), 9/10 (COPY select list), 11 (parquet projection), 17 (descriptor generation).   |
| `build.ts`              | `assertions.ts`                   | `import { assertFieldAlignment, assertNonZeroRows, ... }` | WIRED  | line 32-37; consumed in steps 6, 7 (alignment), 8 (row count), 14, 21 (zero-byte).                                                 |
| `build.ts`              | `meta-xml.ts`                     | `import { buildMetaXml }`                                  | WIRED  | line 38; consumed in step 17 (`buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS)`).                                                |
| `build.ts`              | `eml.ts`                          | `import { buildEml, type DatasetsRow }`                    | WIRED  | line 39; consumed in step 17 (`buildEml({datasets, temporalCoverage})`).                                                            |
| `build.ts`              | `zip.ts`                          | `import { writeZip }`                                      | WIRED  | line 40; consumed in step 20 (four-entry zip assembly).                                                                            |
| `build.ts`              | DuckDB `@duckdb/node-api`         | `DuckDBInstance.create(':memory:')` + ATTACH Postgres      | WIRED  | line 27 import, line 135 instance, line 145-147 ATTACH. spatial + postgres extensions loaded steps 4.                              |
| `build.ts`              | Postgres `dwc.occurrences` view   | DuckDB ATTACH → DESCRIBE + COPY + parquet                  | WIRED  | steps 6, 9, 11, 13, 15 reference `pgdb.dwc.occurrences`. View column shape asserted at runtime against TS array (F-02).            |
| `build.ts`              | Postgres `dwc.multimedia` view    | DuckDB ATTACH → DESCRIBE + COPY                            | WIRED  | steps 7, 10 reference `pgdb.dwc.multimedia`. Same F-02 alignment guard.                                                            |
| `build.ts`              | Postgres `dwc.datasets` view      | DuckDB ATTACH → SELECT * LIMIT 1                           | WIRED  | step 16 reads single dataset row for `buildEml` input.                                                                             |
| `package.json` script   | `build.ts` entry point             | `tsx scripts/dwca/build.ts`                                | WIRED  | `build:dwca` script + main() entry-point conditional at build.ts:379 fires on `tsx` invocation.                                    |
| `build.test.ts`         | `build.ts` (full pipeline)        | `execSync('npm run build:dwca', { env: { ...SUPABASE_DB_URL } })` in beforeAll | WIRED  | line 74-77; integration tests are gated by DSN presence, beforeAll runs the real pipeline.                                         |
| `build.test.ts`         | `fields.ts` (round-trip check)    | `import { OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS }`         | WIRED  | line 45; used in tests 3, 4, 8, 9 to compare TS-source-of-truth against produced meta.xml and CSV header.                          |

### Data-Flow Trace (Level 4)

| Artifact         | Data Variable                    | Source                                                                          | Produces Real Data | Status     |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------- | ------------------ | ---------- |
| `build.ts`       | `occCount` (BigInt row count)    | `assertNonZeroRows(conn, 'pgdb.dwc.occurrences')` → DuckDB COUNT(*) over Postgres | Yes (asserted >0)  | FLOWING    |
| `build.ts`       | occurrence.txt bytes             | DuckDB COPY (SELECT ... FROM pgdb.dwc.occurrences) TO ... CSV                    | Yes                | FLOWING    |
| `build.ts`       | multimedia.txt bytes             | DuckDB COPY (SELECT ... FROM pgdb.dwc.multimedia) TO ... CSV                    | Yes (header-only when empty seed) | FLOWING |
| `build.ts`       | parquet bytes + geo metadata     | DuckDB COPY with `ST_Point(...) AS geometry` → parquet_kv_metadata verified      | Yes                | FLOWING    |
| `build.ts`       | `datasetsRow` (EML input)        | `SELECT * FROM pgdb.dwc.datasets LIMIT 1` (19-col view)                          | Yes (LIMIT 1 row from view-over-VALUES) | FLOWING |
| `build.ts`       | `temporalCoverage.begin/end`     | `SELECT MIN("eventDate"), MAX("eventDate") FROM pgdb.dwc.occurrences`             | Yes                | FLOWING    |
| `meta-xml.ts`    | descriptor indices               | Pure function over `OCCURRENCE_FIELDS` / `MULTIMEDIA_FIELDS` array index         | Yes (deterministic) | FLOWING    |
| `eml.ts`         | EML body                         | Pure function over `DatasetsRow` + `temporalCoverage`                            | Yes                | FLOWING    |
| `zip.ts`         | zip bytes                        | `yazl.ZipFile.addBuffer()` over input entries with FIXED_MTIME                   | Yes (deterministic) | FLOWING    |

No HOLLOW_PROP / DISCONNECTED / STATIC patterns found. The pipeline reads from Postgres → projects via DuckDB → derives both CSV and parquet from the same source view → drives the descriptor from the same TS arrays as the COPY column list. End-to-end real-data flow confirmed by the 2026-06-18 live integration test pass.

### Behavioral Spot-Checks

| Behavior                                                       | Command                                                | Result                                          | Status |
| -------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- | ------ |
| TypeScript compiles cleanly across scripts/                    | `npx tsc -p . --noEmit`                                | exit 0                                          | PASS   |
| Unit test suite passes (no DSN)                                | `npx vitest run scripts/dwca/`                         | 85 passed, 10 skipped, 0 failed, exit 0         | PASS   |
| Integration tests skip cleanly when DSN absent                 | `npx vitest run scripts/dwca/`                         | 10 tests in `describe('build:dwca integration...')` reported as skipped (not silently passing) | PASS |
| Integration tests pass against live Supabase (DSN present)     | `npx vitest run scripts/dwca/build.test.ts` w/ DSN     | All 10 tests passed (2026-06-18 user-executed; per 06-06-SUMMARY.md) | PASS |
| `npm run build:dwca` script wiring exists                      | grep `build:dwca` in package.json                      | `"build:dwca": "tsx scripts/dwca/build.ts"`     | PASS   |
| Module imports load all required deps                          | tsc + vitest both succeed (covers import resolution)   | exit 0 from both                                | PASS   |
| Pipeline runs end-to-end against live DB                       | (covered by integration `beforeAll` 2026-06-18)        | dist/dwca/{zip,parquet,occurrence.txt,multimedia.txt} produced; all 10 assertions green | PASS |

### Probe Execution

Phase 6 does not declare conventional `scripts/*/tests/probe-*.sh` probes. The probe-equivalent is the vitest integration suite (`scripts/dwca/build.test.ts`) which is gated on `SUPABASE_DB_URL`:

| Probe                                                | Command                                | Result                                                                          | Status |
| ---------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| `scripts/dwca/build.test.ts` (DSN-gated integration) | `npx vitest run scripts/dwca/`         | 85 passed + 10 skipped (no DSN this run); user-executed pass 2026-06-18 with DSN | PASS (when DSN present); SKIP (gated) without DSN — both expected |

No structural `scripts/dwca/tests/probe-*.sh` files exist. The integration test fulfills the same role at the vitest layer. (`find scripts -path '*/tests/probe-*.sh' -type f` returns no results.)

### Requirements Coverage

| Requirement | Source Plan(s)              | Description                                                                            | Status               | Evidence                                                                                                                                                                  |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DWCA-01     | 06-04, 06-05, 06-06         | Valid DwC-A zip with `meta.xml`, `eml.xml`, Occurrence core, Multimedia extension       | SATISFIED            | build.ts step 20 writes four entries; build.test.ts test 1 round-trips via `unzip -l`. Live run 2026-06-18 produced 14503-byte zip.                                       |
| DWCA-02     | 06-01, 06-02, 06-03, 06-04, 06-06 | `meta.xml` + data files from one ordered field list; indices cannot drift              | SATISFIED            | fields.ts is single source; meta-xml.ts and build.ts both import the arrays; F-02 runtime guard in assertions.ts compares to PG view; build.test.ts tests 3, 4, 9 round-trip end-to-end. |
| DWCA-03     | 06-05, 06-06                | Multimedia rows join via byte-stable `coreId`; anti-join is empty                       | SATISFIED            | build.test.ts test 5 asserts every multimedia.coreId ∈ occurrenceID set. Inherited from Phase 5 `dwc.multimedia` shape.                                                    |
| DWCA-04     | 06-05, 06-06                | UTF-8 no BOM; quoting/escaping; HTML stripped                                          | SATISFIED            | build.ts step 19 BOM defense-in-depth; build.ts step 9-10 use `QUOTE '', ESCAPE '', NULLSTR ''` + regexp_replace; build.test.ts tests 6-8 assert no BOM + exact 25-col splits. |
| DWCA-05     | 06-06                       | Passes GBIF DwC-A validator with no blocking structural errors                          | NEEDS HUMAN (deferred via override) | GBIF validator service offline upstream 2026-06-18. Deterministic zip preserved; follow-up queued in 06-06-SUMMARY.md. Override accepted in frontmatter.                   |
| DWCA-06     | 06-05, 06-06                | GeoParquet 1.0.0 sidecar with WKB Point + retained lat/lon; round-trippable             | SATISFIED            | build.ts step 11 emits 26 cols via `ST_Point(...) AS geometry`; step 12 asserts geo metadata shape; build.test.ts test 10 re-asserts version/encoding/primary_column + row-count parity + ST_AsText POINT round-trip. R1 empirically confirmed 2026-06-18. |

No orphaned requirements. All DWCA-* IDs are claimed by at least one plan and verified above.

### Anti-Patterns Found

| File                          | Line | Pattern  | Severity | Impact                                                                                                                                                                                                                       |
| ----------------------------- | ---- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/dwca/eml.ts`         | 117  | `TODO`   | Info     | `TODO: link Acartia cooperative boundary doc once published URL is confirmed`. The Acartia bbox literal values (36–54°N, -136 to -120°W) are already embedded; this TODO is a docstring polish noted for when Acartia publishes the boundary URL. Not a code stub; bbox values are in the emitted EML. |

No `TBD` / `FIXME` / `XXX` debt markers found (BLOCKER gate clean). No empty-implementation, console-log-only, or placeholder-return patterns found. The single `TODO` is a documentation reference deferral, not a code stub — the data it documents is already concrete in the file.

### Human Verification Required

None blocking Phase 6 closeout. The one outstanding human-checkable item is DWCA-05 (GBIF validator upload), which is accepted via override pending upstream service return. Phase 7 does not depend on DWCA-05 — it depends on `npm run build:dwca` producing a deterministic, structurally-correct zip + parquet, which is independently verified by tests 1-10 of the integration suite.

When the GBIF validator service returns online:
1. Run `npm run build:dwca` against a populated DSN.
2. Upload `dist/dwca/salishsea-occurrences-v1.zip` to https://www.gbif.org/tools/data-validator.
3. Confirm "Successfully validated" / zero blocking structural errors.
4. Update `.planning/REQUIREMENTS.md` to mark DWCA-05 Complete and append the verdict link/screenshot to 06-06-SUMMARY.md.
5. Optionally remove the override from this file (or leave it as audit trail).

### Gaps Summary

No gaps blocking Phase 6 closeout. Goal-backward analysis:

- **Goal:** "DwC-A export pipeline that produces a deterministic, GBIF-shape-conformant archive of `dwc.occurrences` + `dwc.multimedia`."
- **Pipeline exists end-to-end:** `npm run build:dwca` (package.json) → `tsx scripts/dwca/build.ts` → DuckDB ATTACH Postgres → F-02 alignment guards → COPY × 3 (occurrence.txt, multimedia.txt, parquet) → R1 GeoParquet metadata verification → buildMetaXml + buildEml → writeZip → four-entry deterministic zip + sidecar parquet.
- **Determinism:** FIXED_MTIME = 2000-01-01 pins every zip entry header; meta-xml.ts and eml.ts are pure functions; ST_Point geometry derives from the same lat/lon as the CSV; single source of truth in fields.ts drives both descriptor and projection.
- **Shape conformance:** 4 truth tables of structural assertions pass against live artifacts; 25-col Occurrence core + 6-col Multimedia extension + 25+1 col GeoParquet 1.0.0 sidecar; literal `\t` / `\n` per GBIF text guidelines; UTF-8 no BOM; tab-collapse on five freetext columns prevents column-boundary corruption.
- **GBIF validator corroboration:** DEFERRED via override — service offline upstream 2026-06-18. Structural gates 1-4, 6 satisfied; gate 5 (the validator stamp) is downstream of these and is reproducible from the deterministic zip when the service returns.

**Verdict: Phase 6 PASSES with one deferred follow-up (DWCA-05 GBIF validator re-upload).** Phase 7 (nightly workflow + hosting) is unblocked; the integration test is the regression net Phase 7 needs.

---

_Verified: 2026-06-18T08:42:00Z_
_Verifier: Claude (gsd-verifier)_
