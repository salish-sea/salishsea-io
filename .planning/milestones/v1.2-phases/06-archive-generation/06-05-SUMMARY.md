---
phase: 06-archive-generation
plan: 05
subsystem: dwca
tags: [dwca, build-orchestrator, duckdb, postgres-attach, geoparquet, st_point, R1-resolved, deterministic-build, F-02]

# Dependency graph
requires:
  - 06-02 (canonical OCCURRENCE_FIELDS / MULTIMEDIA_FIELDS in scripts/dwca/fields.ts)
  - 06-03 (buildMetaXml, buildEml + DatasetsRow / EmlInput types)
  - 06-04 (assertFieldAlignment, assertNonZeroRows, assertNoZeroByteFile, writeZip + FIXED_MTIME)
provides:
  - "scripts/dwca/build.ts: `main()` orchestrator — DSN guard → DuckDB ATTACH (postgres + spatial, read-only) → F-02 assertions on both views → CSV COPY (occurrence.txt, multimedia.txt) → ST_Point GEOMETRY parquet COPY → R1 empirical kv-metadata verification → row-count parity → MIN/MAX(eventDate) → buildMetaXml + buildEml → deterministic writeZip → zero-byte guards"
  - "Live-confirmed R1 resolution: DuckDB 1.5.4-r.1's `COPY (... ST_Point(lon,lat) AS geometry) TO ... (FORMAT parquet)` auto-emits GeoParquet 1.0.0 metadata with `primary_column=geometry`, `encoding=WKB`, and a populated `bbox`. CONTEXT.md G-01's `ST_AsWKB` wording is now empirically overridden."
  - "Two output artifacts produced on every successful run: `dist/dwca/salishsea-occurrences-v1.zip` (DwC-A: meta.xml + eml.xml + occurrence.txt + multimedia.txt, in that order, mtime=FIXED_MTIME) and `dist/dwca/salishsea-occurrences-v1.parquet` (25 dwc columns + geometry, snappy)"
affects:
  - 06-06 (integration round-trip test invokes `npm run build:dwca` and introspects the produced artifacts)
  - Phase 7 (publish workflow wraps `npm run build:dwca` and relies on non-zero exit on any failure)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Verify-then-decide for the R1 question — build.ts runs the empirical `parquet_kv_metadata('geo')` query against its own just-produced parquet file before declaring success. No silent fallback; if the metadata is absent, the build exits non-zero with explicit escalation guidance (RESEARCH §R1 Option B / KV_METADATA injection). The check is a permanent safety net against any future DuckDB regression."
    - "DSN-by-identifier-only — `process.env.SUPABASE_DB_URL` is read into a local `dsn` const and passed only to `conn.run(\\`ATTACH '${dsn}' AS pgdb ...\\`)`. The only error path that could reflect the DSN (attach failure) is wrapped in `maskDsn()`, which returns `'<redacted>'` for any string containing `'://'`. Static grep `console\\.(log|error).*\\bdsn\\b` returns zero matches in build.ts; the live run grep for `postgresql://` returned zero stdout/stderr lines."
    - "Runtime SELECT-list construction over the canonical `fields.ts` arrays — `buildSelectList(fields, tabCollapse)` emits `regexp_replace(\"col\", E'[\\\\t\\\\n\\\\r]+', ' ', 'g') AS \"col\"` for the five user-content columns (occurrenceRemarks, dynamicProperties, recordedBy, rightsHolder, datasetName) and plain `\"col\"` for the rest. Means a future addition to OCCURRENCE_FIELDS automatically flows into both the F-02 alignment check and the COPY projection — no second source of truth."
    - "F-02 fail-loud-and-early — `assertFieldAlignment` is called for BOTH dwc.occurrences AND dwc.multimedia before any COPY runs. Drift in either view exits non-zero with the structured `[+i]`/`[-i]`/`[~i]` diff, and zero output files are written. The static-check `node -e` in the plan's `<verify>` block confirms textual ordering of `assertFieldAlignment` before `COPY`."
    - "decode(BLOB) → VARCHAR for parquet_kv_metadata — DuckDB stores parquet kv-metadata as BLOB; `BLOB::text` yields the hex-escaped representation (`\\x7b\\x22version...`) which is unparseable as JSON. `decode(value)` is the documented UTF-8 decode and yields the literal JSON string. Caught at first live run; fix landed in commit bf6032f."

key-files:
  created:
    - "scripts/dwca/build.ts (391 lines)"
  modified: []

key-decisions:
  - "**ST_Point GEOMETRY (NOT ST_AsWKB BLOB)** — CONTEXT.md G-01 originally specified `ST_AsWKB(ST_Point(...))`; RESEARCH §R1 analyzed the question and recommended `ST_Point` directly because DuckDB PR #12503 auto-emits GeoParquet metadata only when the column type is GEOMETRY. Plan 05 implemented the recommendation and verified it empirically at the live run (Task 2). The kv-metadata check in step 12 of main() is the permanent safety net against any future DuckDB version that would regress this auto-emit behavior. Net result: no Option B KV_METADATA injection needed."
  - "**Two ENCODING / decode fixes landed mid-build at Task 2 checkpoint** — see Deviations section below. Neither was anticipated by RESEARCH §T2 (which lifted the `ENCODING 'UTF-8'` syntax from older DuckDB docs) nor by RESEARCH §T11 (which suggested `::text` casts for kv-metadata inspection). Both were caught at the first live invocation and fixed inline; both are minor syntactic adjustments to DuckDB's actual current behavior, not architectural changes."
  - "**Exports `main` and uses script-conditional invocation** — the bottom of build.ts has `if (import.meta.url === \\`file://${process.argv[1]}\\`) { main().catch(...); }` so the file is importable from Plan 06's integration test without auto-running, but `npm run build:dwca` (which runs `tsx scripts/dwca/build.ts`) still triggers `main()`. The conditional handles the `import.meta.url`/`file://` shape correctly under `tsx` because `process.argv[1]` is the script path."
  - "**`assertNonZeroRows` is called on `dwc.occurrences` only, NOT `dwc.multimedia`** — multimedia may legitimately be empty (no photos attached to any observation) and the header-only multimedia.txt is still a valid DwC-A extension file. The plan called this out explicitly; the live run confirmed multimedia.txt with N data rows but the logic for the empty case is in place."
  - "**Slice eventDate to 10 chars for calendarDate** — `String(tempRow.begin).slice(0, 10)` truncates `2026-06-17T12:34:56Z` → `2026-06-17` so EML carries the `<calendarDate>` form per POLICY §6.5. This is a parser-friendly form that GBIF validator accepts; the full ISO-8601 timestamp would also validate but the calendarDate slice matches the convention in the GBIF EML profile examples."

patterns-established:
  - "Verify-then-decide for any 'undocumented auto-emit' library behavior — runs the assertion immediately after the producing operation, in the same process. The R1 check is reusable as a template for any future build-time assumption about a third-party library's auto-behavior."
  - "`maskDsn(s)` regex-on-presence-of-`://` as a defense-in-depth secret-scrub helper. Any string containing a URL scheme is redacted regardless of variable name. Reusable for any future build script that handles credentials."
  - "Runtime SELECT-list construction parameterized by the canonical TS array → eliminates the second source of truth and forces drift to surface at the F-02 assertion, not deep inside a CSV parser."

requirements-completed:
  - DWCA-01
  - DWCA-02
  - DWCA-04
  - DWCA-06

# Metrics
duration: ~25min (Task 1 atomic landing + Task 2 live verification with two inline fixes)
completed: 2026-06-18
---

# Phase 06 Plan 05: build.ts Orchestrator Summary

**Plan 05 lands `scripts/dwca/build.ts` — the single entry point invoked by `npm run build:dwca`. It composes the leaf modules from Plans 02-04 into a working end-to-end pipeline: SUPABASE_DB_URL guard → DuckDB ATTACH → F-02 assertions on both dwc views → tab-delimited CSV COPY → ST_Point GEOMETRY parquet COPY → empirical R1 verification of GeoParquet `geo` metadata → row-count parity → MIN/MAX(eventDate) → buildMetaXml + buildEml → deterministic writeZip. The live local run produced both artifacts (zip + parquet), exit 0, no DSN leak, and CONFIRMED R1 — DuckDB auto-emits GeoParquet 1.0.0 metadata when the column is typed GEOMETRY.**

## Performance

- **Duration:** ~25 min wall time across two work sessions (Task 1 atomic landing, then resumed for Task 2 live verification with two inline fixes)
- **Tasks:** 2 (Task 1 = `build.ts` source; Task 2 = live local run = `checkpoint:human-verify`, approved)
- **Files created:** 1 (`scripts/dwca/build.ts`, 391 lines)
- **Files modified:** 0
- **Tests:** 71/71 pre-existing dwca tests still pass; no new unit tests in this plan (the live run is the verification surface and Plan 06's integration test is the regression net)
- **`npx tsc -p . --noEmit`:** exit 0 (re-confirmed at plan close)

## Accomplishments

- **`main()` orchestrator implemented end-to-end.** The 22-step pipeline from the plan landed verbatim with three localized fixes (ENCODING removal, decode() for BLOB, plus the original Task 1 source). Process exits non-zero on any failure: missing env var, attach error, F-02 drift, empty view, COPY error, missing geo metadata, row count mismatch, zero-byte output. Process exits 0 on success with a `[build:dwca] OK — N occurrence rows, ...` line on stdout.
- **DSN safety wired end-to-end.** `dsn` is read from `process.env.SUPABASE_DB_URL` into a local const; the only error path that could reflect it (attach failure) is wrapped by `maskDsn()`. The live run check `npm run build:dwca 2>&1 | grep -F 'postgresql://'` returned zero matches. Static grep on the source for any `console.(log|error)` interpolating `dsn` by name also returns zero.
- **F-02 runtime assertion fully wired.** `assertFieldAlignment` is called for `dwc.occurrences` (against `OCCURRENCE_FIELDS`) AND `dwc.multimedia` (against `MULTIMEDIA_FIELDS`) BEFORE any COPY. Both calls source their PG-side column list from `DESCRIBE pgdb.dwc.<view>` via the runtime DuckDB Postgres ATTACH (the only way to learn the live view's actual column projection without leaving the build script). The live run confirmed both assertions return silently.
- **R1 empirically resolved.** The plan's verify-then-decide step ran against the live build's own parquet output and confirmed DuckDB 1.5.4-r.1 auto-emits the full GeoParquet 1.0.0 metadata block when the column is typed GEOMETRY. The captured metadata (see below) carries the populated `bbox` — DuckDB even computes the bounding box itself, which Phase 7's catalog metadata can reuse for free.
- **Two CSV COPY statements and one parquet COPY all succeed.** Tab-collapsing regexp_replace is applied per-column (per RESEARCH §R5) on the five free-text columns; the rest are plain `"col"`. Plain occurrence column list + `ST_Point("decimalLongitude", "decimalLatitude") AS geometry` for parquet.
- **Deterministic zip emitted.** All four entries (meta.xml, eml.xml, occurrence.txt, multimedia.txt) are written via Plan 04's `writeZip` with the entry order preserved and `mtime = FIXED_MTIME = 2000-01-01T00:00:00Z` (the y2k anchor — intentional, the determinism property requires a fixed mtime). The live `unzip -l` confirmed the four-entry list in the correct order. Zip mtimes show `2000-01-01` — this is by design, not a bug; Phase 7's "no upstream change ⇒ skip republish" dedupe will depend on byte-identical archives across runs.
- **Defense-in-depth invariants all green.** `assertNonZeroRows` on `dwc.occurrences`, `assertNoZeroByteFile` on all four outputs (3 CSV/parquet + 1 zip), UTF-8 BOM sanity check on the CSVs, row-count parity between `dwc.occurrences` and the produced parquet, and the final success log line — all passed in the live run.

## Empirical R1 Result — CONFIRMED

**The R1 hypothesis stated in the plan and RESEARCH §R1 is empirically confirmed by the live run.** The build script's own kv-metadata query against `dist/dwca/salishsea-occurrences-v1.parquet` returned a single row whose decoded `value` parses as:

```json
{
  "version": "1.0.0",
  "primary_column": "geometry",
  "columns": {
    "geometry": {
      "encoding": "WKB",
      "geometry_types": ["Point"],
      "bbox": [-133.00118, 37.65647, -122.27515, 53.11916]
    }
  }
}
```

This proves three things:

1. **DuckDB 1.5.4-r.1's `COPY (... ST_Point(lon,lat) AS geometry) TO ... (FORMAT parquet)` auto-emits the full GeoParquet 1.0.0 metadata block** when the column is typed GEOMETRY (as it is via `ST_Point`, NOT via `ST_AsWKB(ST_Point(...))` which would produce a BLOB column). The CONTEXT.md G-01 wording is now empirically overridden — `ST_Point` is the correct call and Option B (KV_METADATA injection from RESEARCH §R1) is not needed.
2. **The bounding box is computed by DuckDB at write time** (`[-133.00118, 37.65647, -122.27515, 53.11916]` — Salish Sea + adjacent Pacific waters, consistent with the project's geographic coverage). Phase 7's catalog metadata can reuse this bbox for free without re-scanning the parquet.
3. **The empirical safety net is permanent.** Future DuckDB versions that might regress the auto-emit behavior would surface immediately in CI as a non-zero exit with the explicit escalation message naming RESEARCH §R1 Option B. We do NOT silently emit a parquet without `geo` metadata.

## Task Commits

Task 1 landed atomically; Task 2 surfaced two minor DuckDB-syntax mismatches that were fixed inline during the live run:

1. **Task 1: build.ts — DwC-A build orchestrator** — `5cf07b0` (feat, 391 lines added)
2. **Fix 1 (Task 2 inline): drop `ENCODING 'UTF-8'` from COPY** — `556fe16` (fix, 2 lines changed in 2 places). RESEARCH §T2 included `ENCODING 'UTF-8'` in the COPY option list, but DuckDB's current CSV writer doesn't accept this option (UTF-8 is the default and the only supported encoding for CSV writes; the option is parser-side only). Both occurrence and multimedia COPY statements had the option removed. Runtime behavior unchanged (UTF-8 was already what we got); only the syntactic error path is closed.
3. **Fix 2 (Task 2 inline): `decode(key)` / `decode(value)` instead of `::text`** — `bf6032f` (fix, 1 line changed). RESEARCH §T11 suggested `key::text` / `value::text` for inspecting `parquet_kv_metadata`. In practice DuckDB casts BLOB to a hex-escaped representation (`\x7b\x22version...`) which is unparseable as JSON. `decode(value)` is the correct UTF-8 decode. The fix replaces the WHERE clause and projection accordingly. R1 verification works correctly after this fix.

## Outputs Produced (live run)

After `supabase db reset` + fixture load + `npm run build:dwca`:

```
dist/dwca/
├── salishsea-occurrences-v1.zip       # 4 entries, byte-deterministic, mtime=FIXED_MTIME
├── salishsea-occurrences-v1.parquet   # 25 dwc columns + geometry, snappy, with geo kv-metadata
├── occurrence.txt                      # tab-delimited, UTF-8 no BOM, headers + N data rows
└── multimedia.txt                      # tab-delimited, UTF-8 no BOM, headers + N data rows
```

Zip entries (verified via `unzip -l`):

| # | Name           | Source                              | mtime      |
|---|----------------|--------------------------------------|------------|
| 1 | meta.xml       | buildMetaXml(OCCURRENCE_FIELDS, MM)  | 2000-01-01 |
| 2 | eml.xml        | buildEml({datasets, temporalCoverage})| 2000-01-01 |
| 3 | occurrence.txt | DuckDB CSV COPY                      | 2000-01-01 |
| 4 | multimedia.txt | DuckDB CSV COPY                      | 2000-01-01 |

The `2000-01-01` mtime across all four entries is `FIXED_MTIME = new Date('2000-01-01T00:00:00Z')` from Plan 04's `zip.ts` — the y2k anchor that makes the archive byte-deterministic across runs. **This is by design, not a bug.** Phase 7's "no upstream change ⇒ skip republish" dedupe (later in the roadmap) relies on this byte-identical property.

The intermediate `occurrence.txt` and `multimedia.txt` files are NOT cleaned up after zipping; the plan explicitly leaves them in `dist/dwca/` for inspection. Phase 7 publishes the zip + parquet only; the intermediate CSVs are local artifacts.

## Deviations from Plan

Two inline fixes during the live run (both Rule 1 — fixing actual bugs in the planned syntax):

1. **`[Rule 1 — Bug] Drop ENCODING 'UTF-8' from CSV COPY options`** (commit `556fe16`)
   - **Found during:** Task 2 live run (`npm run build:dwca` first invocation)
   - **Issue:** DuckDB's CSV writer rejects the `ENCODING` option with a parser error. UTF-8 is the default and only supported encoding for CSV writes; the option only applies to the parser/reader side.
   - **Fix:** Removed `, ENCODING 'UTF-8'` from both COPY statements (occurrence.txt and multimedia.txt). UTF-8 output is still what we get (DuckDB's default), confirmed by the no-BOM sanity check.
   - **Files modified:** scripts/dwca/build.ts (2 places, 4 lines net)
   - **Commit:** `556fe16`

2. **`[Rule 1 — Bug] Use decode() instead of ::text cast for parquet_kv_metadata`** (commit `bf6032f`)
   - **Found during:** Task 2 live run (R1 verification step)
   - **Issue:** DuckDB casts BLOB to text as a hex-escaped representation (`\x7b\x22version\x22...`) — unparseable as JSON and the WHERE clause `key='geo'::blob` already gave the correct row, but the value column needed UTF-8 decoding to be useful.
   - **Fix:** Changed the projection from `key::text AS k, value::text AS v` to use `decode(key)` and `decode(value)`. The R1 check then parses the decoded UTF-8 JSON correctly and confirms the metadata block.
   - **Files modified:** scripts/dwca/build.ts (1 line)
   - **Commit:** `bf6032f`

Neither fix is architectural; both are minor adjustments to DuckDB syntax that the research didn't catch. The research had lifted `ENCODING 'UTF-8'` from older DuckDB docs and `::text` for BLOB inspection from a non-parquet context. The plan's `<read_first>` includes both references; future plans touching DuckDB output should treat these two as known footguns.

No Rule 2 (missing critical functionality), Rule 3 (other blocking issues), or Rule 4 (architectural checkpoint) deviations occurred. The R1 question itself was anticipated by the plan as a verify-then-decide checkpoint, and the verification passed — not a deviation, but the plan's success path.

## Issues Encountered

The two ENCODING / decode bugs above. Both surfaced at the first live invocation, were diagnosed within a single iteration each (DuckDB error message → docs lookup → fix), and were committed atomically with fix commit type. The R1 verification then ran cleanly and confirmed the GeoParquet auto-emit.

No issues with: the DuckDB postgres ATTACH (worked first try), the F-02 assertions (both views matched their canonical arrays), the row-count parity (matched exactly), the zip determinism (entries in correct order, mtimes pinned to FIXED_MTIME), the DSN safety (zero leaks in stdout/stderr).

## Threat Surface Scan

The plan's threat register is mitigated as designed:

- **T-06-05-DSN** (Information disclosure: DSN leak via log) — mitigated. `maskDsn()` wraps the only error path that could reflect the attach error. Live run `grep -F 'postgresql://'` of stdout+stderr returned zero matches. Static grep on the source for `console.(log|error).*\bdsn\b` returns zero.
- **T-06-05-DRIFT** (Tampering: view drift) — mitigated. `assertFieldAlignment` runs BEFORE any COPY for both views; AlignmentError exits 1 with structured diff. Verified textually in source (`assertFieldAlignment` precedes `COPY` in the file).
- **T-06-05-TAB** (Injection: embedded tab/newline in freetext breaks CSV boundary) — mitigated. `regexp_replace("col", E'[\\t\\n\\r]+', ' ', 'g') AS "col"` for the five user-content columns (occurrenceRemarks, dynamicProperties, recordedBy, rightsHolder, datasetName). Plan 06's integration test will round-trip the produced occurrence.txt to confirm.
- **T-06-05-XML** (Injection: XML metacharacters in EML) — mitigated by Plan 03's `xmlEsc` (already in eml.ts). build.ts does not bypass it.
- **T-06-05-R1** (Tampering: parquet without geo metadata) — **empirically resolved.** The verify-then-decide step ran against the live parquet and confirmed the full GeoParquet 1.0.0 block. The hard-fail check stays in place permanently as a regression net.
- **T-06-05-EMPTY** (Denial of service: empty archive) — mitigated. `assertNonZeroRows` on occurrences exits 1 if count is 0; `assertNoZeroByteFile` on all four outputs as belt-and-suspenders.
- **T-06-05-PATH** (zip path traversal) — mitigated upstream by Plan 04's `writeZip`. build.ts uses hardcoded names so the guard never trips in practice.
- **T-06-05-ATTACH** (DSN spoofing via CLI) — accepted (env-only contract).
- **T-06-05-RO** (DuckDB writes back to Postgres) — mitigated. `ATTACH ... (TYPE postgres, READ_ONLY)` enforces read-only at the engine level.
- **T-06-05-SC** (supply chain) — mitigated upstream (Plan 01 pinning).

No new threat surface introduced beyond what the plan's `<threat_model>` already enumerated.

## Known Stubs

None introduced. `scripts/dwca/build.ts` is now fully implemented (the Plan 01 stub is replaced). All downstream consumers (Plan 06's integration test, Phase 7's publish workflow) have a working entry point.

## User Setup Required

For local development:

1. `supabase start` — local Postgres on port 54322
2. `supabase db reset` — applies the dwc schema migration
3. Fixture data: at least one row in `public.observations`; the build asserts `assertNonZeroRows` on `dwc.occurrences`. (multimedia may be empty.)
4. `export SUPABASE_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'`
5. `npm run build:dwca`

For production: Phase 7's GH Actions workflow injects `SUPABASE_DB_URL` from the `production` environment secret.

## Next Wave Readiness

- **Plan 06 (integration round-trip test)** can now invoke `npm run build:dwca` against a populated local DB and introspect the produced `dist/dwca/salishsea-occurrences-v1.zip` and `salishsea-occurrences-v1.parquet`. The round-trip parser (DuckDB `read_csv` on the extracted occurrence.txt, `read_parquet` on the sidecar) will validate field count = 25, geometry round-trip via `ST_AsText`, and row-count parity.
- **Phase 7 (publish)** can wrap `npm run build:dwca` in its nightly workflow and rely on non-zero exit on any failure: missing DSN, view drift, empty occurrences, missing geo metadata, zero-byte output. The deterministic zip + parquet enable the dedupe pattern ("no upstream change ⇒ skip republish") via cheap byte-comparison.
- **The empirical R1 confirmation** means CONTEXT.md G-01's `ST_AsWKB` wording can be permanently retired in any future regeneration of the phase context. `ST_Point` GEOMETRY is the canonical encoding path for this codebase.

## Self-Check: PASSED

Files asserted present:
- `scripts/dwca/build.ts` — FOUND (391 lines)
- `.planning/phases/06-archive-generation/06-05-SUMMARY.md` — FOUND (this file)

Commits asserted in branch history (`git log --oneline main..HEAD`):
- `5cf07b0` (Task 1, feat — build.ts orchestrator) — FOUND
- `556fe16` (fix — drop ENCODING from COPY) — FOUND
- `bf6032f` (fix — decode() for parquet_kv_metadata) — FOUND

Verification commands re-run at plan close:
- `npx tsc -p . --noEmit` → exit 0
- `npx vitest run scripts/dwca/` → 71/71 passing (5 test files, 237ms), 0 skipped, 0 failed, exit 0
- Live local `npm run build:dwca` (user-executed at Task 2 checkpoint) → exit 0; 4 output files in `dist/dwca/`; zip entries in correct order; FIXED_MTIME on every zip entry; GeoParquet `geo` metadata present and parsed correctly; no DSN leak in stdout/stderr.

---
*Phase: 06-archive-generation*
*Completed: 2026-06-18*
