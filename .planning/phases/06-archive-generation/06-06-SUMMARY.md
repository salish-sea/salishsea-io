---
phase: 06-archive-generation
plan: 06
subsystem: dwca
tags: [dwca, integration-test, vitest, dsn-gated, gbif-validator-deferred, phase-closeout, F-02-roundtrip]

# Dependency graph
requires:
  - 06-02 (OCCURRENCE_FIELDS / MULTIMEDIA_FIELDS — single source of truth imported by the test)
  - 06-03 (buildMetaXml — round-tripped via regex extraction in DWCA-02)
  - 06-04 (writeZip — produces the four-entry archive whose contents are introspected)
  - 06-05 (build.ts — the orchestrator the test invokes end-to-end via `npm run build:dwca`)
provides:
  - "scripts/dwca/build.test.ts: 10 integration tests inside `describe('build:dwca integration (DWCA-01..04/06; requires SUPABASE_DB_URL)', ...)`. Gated on `process.env.SUPABASE_DB_URL`. With DSN absent: every integration test skips cleanly (vitest still exits 0). With DSN present: `beforeAll` invokes `npm run build:dwca` against the live local DB, then 10 tests introspect `dist/dwca/salishsea-occurrences-v1.{zip,parquet}` + `occurrence.txt` + `multimedia.txt` to prove DWCA-01..04/06 by machine assertion."
  - "Phase 6 structural close-out: DWCA-01, DWCA-02, DWCA-03, DWCA-04, DWCA-06 are demonstrably satisfied by the integration test against the live local DB (run 2026-06-18 — all 10 tests passed)."
  - "DWCA-05 (GBIF DwC-A validator pass) is DEFERRED — the gbif.org validator service was offline 2026-06-18 due to an upstream bug. The deterministic zip is in hand and ready to re-upload once the validator returns."
affects:
  - Phase 7 (publish workflow — can wrap `npm run build:dwca` with confidence that the artifacts have a working regression net; the integration test gates Phase 7's pre-publish CI step against view drift / BOM regressions / GeoParquet metadata loss)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DSN-gated integration tests inside the same vitest suite — `const HAS_DSN = !!process.env.SUPABASE_DB_URL;` and `(HAS_DSN ? test : test.skip)(...)` lets the unit suite stay green on a fresh checkout (no local Supabase needed) while still running the full pipeline whenever DSN is present. Pattern is reusable for any future test that requires a live DB / external service."
    - "Round-trip the canonical TS arrays through the produced XML/CSV — `OCCURRENCE_FIELDS` / `MULTIMEDIA_FIELDS` are imported by the test, regex-extracted from meta.xml, split from occurrence.txt's header row, and compared as `(index, term)` / `(index, name)` vectors. F-02 alignment is verified end-to-end (TS → meta.xml descriptor + CSV header → reparsed), not just at the build-time `assertFieldAlignment` boundary."
    - "Shell out to `unzip -l` and `unzip -p` for zip introspection — avoids pulling in a zip library at test time. Available on macOS + ubuntu GH runners by default. The four-entry order assertion uses the literal `unzip -l` output line filter."
    - "Borrow build.ts's R1 verification pattern in the test — same `decode(value)` BLOB→VARCHAR trick for `parquet_kv_metadata('geo')`, same DuckDB Postgres ATTACH for row-count parity. The test re-proves the GeoParquet 1.0.0 metadata is present from outside the build process."
    - "DSN never logged in tests — passed only through `execSync(... env: { ...process.env, SUPABASE_DB_URL: DSN })` to the child build (which is itself DSN-safe per Plan 05) and through an interpolated `ATTACH '${DSN}' AS pgdb (TYPE postgres, READ_ONLY)` to DuckDB. No `console.log(DSN)`, no error message that reflects the DSN."

key-files:
  created:
    - "scripts/dwca/build.test.ts (289 lines, 10 integration tests)"
  modified: []

key-decisions:
  - "**Approve with DWCA-05 deferred** — the GBIF data validator (https://www.gbif.org/tools/data-validator) was offline 2026-06-18 due to an upstream bug. Per plan owner adjudication: the local integration tests are the deterministic structural gate (DWCA-01..04/06 covered), and external GBIF corroboration is desirable but not blocking for Phase 6 closeout. The deterministic zip is in hand at `dist/dwca/salishsea-occurrences-v1.zip` and can be re-uploaded once the validator service returns."
  - "**`(HAS_DSN ? test : test.skip)` over body-early-return** — both patterns work but `test.skip` reports a clear 'skipped' line in vitest output instead of a silently-passing empty test. Makes the gating intent explicit to anyone reading CI output. (The plan offered both options; we picked the more readable one.)"
  - "**Row-count parity uses the same DSN as the build** — the test re-attaches Postgres inside the DuckDB instance used for the parquet introspection, so `SELECT COUNT(*) FROM pgdb.dwc.occurrences` vs `SELECT COUNT(*) FROM read_parquet('${PARQUET}')` is a single-process comparison. Both numbers come from the same instant in time (the build's COPY ran a few seconds earlier in the same `beforeAll`); if a future Phase 7 publish workflow runs the build and integration test sequentially, the parity check stays meaningful."

patterns-established:
  - "Round-trip-the-canonical-array — anywhere a Phase emits a generated artifact (XML, CSV, JSON-Schema), the integration test should reparse it and assert deep equality with the TS source of truth. The drift detector lives at the end of the pipeline, not just inside the producer."
  - "Service-availability-deferred — when an external validator / verifier is offline at plan close, document the deferral in SUMMARY with the exact deterministic artifact path, the expected verdict, and a follow-up action. Do not block phase closeout on an external service when the structural gates have all passed locally."

requirements-completed:
  - DWCA-01
  - DWCA-02
  - DWCA-03
  - DWCA-04
  - DWCA-06

requirements-deferred:
  - DWCA-05  # gbif.org/tools/data-validator was offline 2026-06-18 — re-upload `dist/dwca/salishsea-occurrences-v1.zip` once the service returns

# Metrics
duration: ~30min (Task 1 atomic landing + Task 2 live integration run + GBIF validator attempt + SUMMARY)
completed: 2026-06-18
---

# Phase 06 Plan 06: Integration Test + Phase Closeout Summary

**Plan 06 lands `scripts/dwca/build.test.ts` — 10 vitest integration tests gated on `SUPABASE_DB_URL` that exercise Plan 05's full `build.ts` pipeline end-to-end (`beforeAll` runs `npm run build:dwca`) and then introspect the produced zip + parquet + CSVs to prove DWCA-01..04 and DWCA-06 by machine assertion. The user ran the integration suite locally against a populated Supabase on 2026-06-18 — all 10 tests passed. DWCA-05 (GBIF DwC-A validator) is DEFERRED: gbif.org's validator service was offline due to an upstream bug; the deterministic zip is in hand at `dist/dwca/salishsea-occurrences-v1.zip` and ready to re-upload once the service returns. Plan owner adjudicated: approve with DWCA-05 deferred. Phase 6 closes.**

## Performance

- **Duration:** ~30 min wall time (Task 1 atomic landing + Task 2 live run + GBIF validator attempt + SUMMARY)
- **Tasks:** 2 (Task 1 = `build.test.ts` source; Task 2 = `checkpoint:human-verify` = approved-with-deferral)
- **Files created:** 1 (`scripts/dwca/build.test.ts`, 289 lines)
- **Files modified:** 0
- **Tests:** 10 new integration tests (DSN-gated); 71 pre-existing dwca tests still pass; full dwca suite is now 81 tests across 6 files (10 skipped without DSN, 0 failed)
- **`npx tsc -p . --noEmit`:** exit 0 at plan close
- **`npx vitest run scripts/dwca/` (no DSN):** 71 passed + 10 skipped (= 81 total), 0 failed, exit 0 — confirms the integration tests skip cleanly on a fresh checkout

## Verification

### Local integration test — PASSED (2026-06-18, user-executed)

User ran in the worktree:
```
cd /Users/rainhead/dev/salishsea-io/.claude/worktrees/agent-3d0241c8e38f6a05
npx vitest run scripts/dwca/build.test.ts
```
Result: **PASSED** — all tests inside `describe('build:dwca integration (DWCA-01..04/06; requires SUPABASE_DB_URL)', ...)` green (≥6 tests / actually 10). DSN was never logged (the user reported the suite output had no `postgresql://` lines).

The 10 integration tests prove (machine assertion against the live-built artifacts):

| # | Test name | Requirement | What it proves |
|---|-----------|-------------|----------------|
| 1 | `DWCA-01: zip exists with four entries in the documented order` | DWCA-01 | Zip is present, non-empty, `unzip -l` reports `meta.xml`, `eml.xml`, `occurrence.txt`, `multimedia.txt` in that order |
| 2 | `DWCA-01 secondary: parquet sidecar exists and is non-empty` | DWCA-01 / DWCA-06 | `.parquet` file exists, size > 0 |
| 3 | `DWCA-02: meta.xml core field indices round-trip with OCCURRENCE_FIELDS` | DWCA-02 | `<field index="N" term="URI"/>` block parsed and the (index, term) vector equals `OCCURRENCE_FIELDS.map((f, i) => [String(i), f.termUri])` — single-source-of-truth invariant verified end-to-end |
| 4 | `DWCA-02: meta.xml extension field indices round-trip with MULTIMEDIA_FIELDS` | DWCA-02 | Same round-trip for the `<extension>` block against `MULTIMEDIA_FIELDS` |
| 5 | `DWCA-03: every multimedia.coreId is present in occurrence.occurrenceID` | DWCA-03 | Build `occIds = new Set(...)` from occurrence.txt; assert every multimedia row's column-0 is in `occIds`. Empty multimedia.txt passes trivially (per T-06-06-EMPTY-MM threat-register acceptance) |
| 6 | `DWCA-04: occurrence.txt has no UTF-8 BOM` | DWCA-04 | First 3 bytes ≠ `EF BB BF` |
| 7 | `DWCA-04: multimedia.txt has no UTF-8 BOM` | DWCA-04 | Same for multimedia.txt |
| 8 | `DWCA-04: every occurrence row has exactly 25 tab-delimited columns (no leaked tabs)` | DWCA-04 | Every post-header row splits on `\t` into exactly `OCCURRENCE_FIELDS.length` (25) fields — proves §R5 tab-collapse is in effect on the five freetext columns |
| 9 | `DWCA-02 round-trip (concrete): first data row has 25 fields and rightsHolder/license reachable` | DWCA-02 | First data row carries an interpretable rightsHolder name (index 19) and license URI (index 22) |
| 10 | `DWCA-06: parquet GeoParquet 1.0.0 metadata + 26 cols + row count parity + POINT round-trip` | DWCA-06 | `parquet_kv_metadata('geo')` parses as `{version: '1.0.0', primary_column: 'geometry', columns.geometry.encoding: 'WKB'}`; `DESCRIBE` reports 26 columns; `COUNT(*) FROM read_parquet(...) == COUNT(*) FROM pgdb.dwc.occurrences`; `ST_AsText(geometry)` rows start with `POINT(` |

### Static check at plan close (no DSN, re-run inside worktree)

```
$ npx tsc -p . --noEmit          → exit 0
$ npx vitest run scripts/dwca/    → 71 passed + 10 skipped, exit 0
```

### DWCA-05 — DEFERRED (GBIF validator service offline)

The user attempted the manual GBIF validator step (https://www.gbif.org/tools/data-validator) and reports: **the validator is offline due to an upstream bug on gbif.org**. This is not a defect in our archive — the validator service itself is unavailable.

**Plan owner adjudication (2026-06-18):** approve with DWCA-05 deferred. The local integration tests are the deterministic structural gate for DWCA-01..04/06; external GBIF corroboration is desirable but not blocking for Phase 6 closeout.

**Follow-up action (queued, not blocking):**
1. Wait for gbif.org/tools/data-validator to come back online (check periodically — no SLA known).
2. Run `npm run build:dwca` against the production DSN (or the same local DSN that produced the test run).
3. Upload `dist/dwca/salishsea-occurrences-v1.zip` to the validator.
4. Confirm "Successfully validated" / zero blocking structural errors.
5. Update `.planning/REQUIREMENTS.md` to mark DWCA-05 complete and append the verdict (screenshot link or copy-pasted result text) to this SUMMARY.

The artifact to upload is byte-deterministic (per Plan 04 / 05: FIXED_MTIME on every zip entry), so the verdict is reproducible — re-running the build now and re-running it after the validator returns will produce the same zip bytes given the same input data.

## Artifacts Produced

By the integration test's `beforeAll` (which invokes `npm run build:dwca` against the live local DB), under `dist/dwca/` in the worktree:

```
dist/dwca/
├── salishsea-occurrences-v1.zip       # 14503 bytes, 4 entries, deterministic
├── salishsea-occurrences-v1.parquet   # 27515 bytes, 25 dwc cols + geometry
├── occurrence.txt                      # 181001 bytes, tab-delimited, no BOM
└── multimedia.txt                      # 52 bytes, header-only (no photos in local seed; this is the T-06-06-EMPTY-MM accepted case)
```

These are local development artifacts produced by the test; they are NOT committed (`dist/` is gitignored, and Phase 6 publishes nothing — that's Phase 7's job). The integration test re-produces them on every run.

The multimedia.txt being header-only (no data rows) means the DWCA-03 anti-join passes trivially (empty set is a subset of any set). Per the plan's threat-register acceptance T-06-06-EMPTY-MM, this is the correct behavior when the local seed has no photos — not a test gap. A meaningful DWCA-03 test of orphan rejection would require seeding at least one `observation_photos` row with a `license_code` other than `'none'`; left for a future test refinement if/when local seed data evolves.

## Task Commits

1. **Task 1: build.test.ts — integration test exercising the full pipeline** — `af6a759` (test, 289 lines added)
2. **Task 2: SUMMARY for plan close** — this commit (`docs(06-06): integration test passes; GBIF validator step deferred (upstream offline 2026-06-18)`)
3. **Planning state update (if separate commit)** — see `git log main..HEAD` in this worktree branch (`worktree-agent-3d0241c8e38f6a05`)

## Accepted Warnings

None observed. (The local integration tests surfaced no warnings; the GBIF validator was unreachable so we have no validator-side yellow flags to track. If/when DWCA-05 is closed and the validator surfaces optional-element warnings, they should be appended here.)

## Deviations from Plan

**Implementation: none.** Task 1 landed verbatim from the plan — same 10 test names, same DSN-gating mechanism, same `execSync('npm run build:dwca')` in `beforeAll`, same `decode(value)` BLOB trick for `parquet_kv_metadata`, same `unzip -l` / `unzip -p` shell-out for zip introspection. The test file is 289 lines (the plan estimated 150-200; we landed slightly over because the inline test-block comments explicitly reference each DWCA-01..04/06 ID per the acceptance criteria).

**Validation: one deferral.** DWCA-05 (manual GBIF validator upload) is deferred due to the gbif.org validator service being offline 2026-06-18. This is not a code deviation and not a plan-execution failure — the external dependency was unavailable. The deterministic zip exists and is ready to upload as soon as the validator returns. Plan owner explicitly chose to proceed with Phase 6 closeout on the strength of the local integration test (which covers DWCA-01..04/06 structurally) rather than block on an external service. Documented above under "DWCA-05 — DEFERRED".

No Rule 1 (bug fixes), Rule 2 (missing critical functionality), Rule 3 (other blocking issues), or Rule 4 (architectural checkpoint) deviations.

## Issues Encountered

The only issue was external: the GBIF data validator at https://www.gbif.org/tools/data-validator was offline due to an upstream bug. We have no visibility into the gbif.org outage timeline. Implementation work itself was clean — Task 1 landed atomically and the live integration run passed every assertion on the first try.

## Threat Surface Scan

The plan's threat register is mitigated as designed; no new threat surface introduced:

- **T-06-06-DSN** (Information disclosure: DSN leaked via test output) — mitigated. DSN passed only through `execSync` child env (build.ts is itself DSN-safe per Plan 05's `maskDsn()`) and via an interpolated `ATTACH '${DSN}'` to DuckDB (no test-side `console.log`). User confirmed the test run output had no `postgresql://` lines.
- **T-06-06-EXEC** (Tampering: `execSync('npm run build:dwca')` from inside a test) — accepted as designed. Tests run only in dev/CI environments where running the build is the explicit purpose; no untrusted input flows to the shell.
- **T-06-06-GBIF** (Information disclosure: uploading the zip to a third-party validator) — N/A (validator was offline, no upload occurred). When DWCA-05 is closed in the follow-up, the disposition remains "accept" per the plan — the zip is intended public-domain output.
- **T-06-06-EMPTY-MM** (Tampering: empty multimedia.txt; DWCA-03 anti-join trivially passes) — accepted as documented. The local seed has no `observation_photos` rows so multimedia.txt is header-only; the test passes trivially and is documented as the T-06-06-EMPTY-MM accepted case.

## Known Stubs

None introduced. The integration test exercises real artifacts produced by Plan 05's `build.ts` against a real local Postgres. No mocks, no fixtures, no placeholders. The one open item — DWCA-05 — is a deferred external verification, not a stub.

## Self-Check: PASSED

Files asserted present (in the worktree):
- `scripts/dwca/build.test.ts` — FOUND (289 lines)
- `.planning/phases/06-archive-generation/06-06-SUMMARY.md` — FOUND (this file)

Commits asserted in branch history (`git log --oneline main..HEAD` from inside the worktree):
- `af6a759` (test, Task 1 — build.test.ts) — FOUND
- This SUMMARY commit — created by the closing `git commit` below

Verification commands re-run at plan close (inside the worktree):
- `npx tsc -p . --noEmit` → exit 0
- `npx vitest run scripts/dwca/` (no DSN) → 71 passed + 10 skipped, 0 failed, exit 0 — confirms the integration tests gate correctly on DSN absence

Verification command run by the user under DSN (2026-06-18):
- `npx vitest run scripts/dwca/build.test.ts` (with `SUPABASE_DB_URL` set) → all 10 integration tests passed; DSN never logged

## Phase 6 Closeout

Phase 6 is now structurally complete:

| Requirement | Status | Evidence |
|---|---|---|
| DWCA-01 | Complete (06-06) | Tests 1+2: zip with 4 entries in order + parquet sidecar non-empty |
| DWCA-02 | Complete (06-06) | Tests 3+4+9: meta.xml descriptor indices round-trip against canonical TS arrays end-to-end |
| DWCA-03 | Complete (06-06) | Test 5: every multimedia.coreId ∈ occurrence.occurrenceID set |
| DWCA-04 | Complete (06-06) | Tests 6+7+8: no BOM on either CSV; every row splits into exactly 25 columns |
| DWCA-05 | **Deferred** | GBIF validator service offline 2026-06-18; deterministic zip in hand and ready to re-upload |
| DWCA-06 | Complete (06-06) | Test 10: GeoParquet 1.0.0 metadata + 26 cols + row-count parity + ST_AsText round-trip |

**Phase 7 can proceed.** The integration test is the regression net that Phase 7's nightly publish workflow needs: any view drift, BOM regression, descriptor-index drift, or GeoParquet metadata loss will surface immediately in CI as a non-zero exit. The deterministic zip + parquet enable Phase 7's "no upstream change ⇒ skip republish" dedupe pattern. The one open follow-up — re-upload the zip to the GBIF validator when it returns — is independent of Phase 7's hosting/scheduling work.

---
*Phase: 06-archive-generation*
*Completed (structural): 2026-06-18*
*Follow-up: re-run DWCA-05 against gbif.org/tools/data-validator when the service returns*
