---
phase: 06-archive-generation
plan: 04
subsystem: dwca
tags: [dwca, assertions, zip, yazl, vitest, typescript, F-02, deterministic-build]

# Dependency graph
requires:
  - 06-02 (canonical OCCURRENCE_FIELDS / MULTIMEDIA_FIELDS arrays — assertFieldAlignment compares the live DuckDB DESCRIBE rows against these)
provides:
  - "scripts/dwca/assertions.ts: assertFieldAlignment (F-02 runtime guard), assertNonZeroRows, assertNoZeroByteFile, AlignmentError, PgColumn, CountConnection"
  - "scripts/dwca/zip.ts: writeZip deterministic yazl wrapper, FIXED_MTIME (946684800000 ms), ZipEntry"
  - "scripts/dwca/yazl.d.ts: local ambient declaration covering the addBuffer / outputStream surface used by zip.ts"
  - "22 new unit tests (11 assertions, 11 zip) — every acceptance criterion of both tasks is now CI-enforced"
affects:
  - 06-05 (build.ts orchestration imports assertFieldAlignment, assertNonZeroRows, assertNoZeroByteFile, writeZip)
  - 06-06 (integration round-trip test exercises writeZip indirectly via the produced zip archive)

# Tech tracking
tech-stack:
  added:
    - "yazl@3.3.1 (devDependency, already in package.json prior to this plan — first use in source code lands here)"
  patterns:
    - "Structural typing across the DuckDB boundary — `CountConnection` and `PgColumn` mirror the @duckdb/node-api shape without importing it, so the F-02 guard remains a pure unit; the test file mocks via plain object literals."
    - "Throw-don't-exit on assertion failure — `assertFieldAlignment` throws `AlignmentError` rather than calling `process.exit`. Lets Vitest observe the failure; lets Plan 05's `build.ts` render the diff with build-specific framing before exiting."
    - "Local ambient declaration (`scripts/dwca/yazl.d.ts`) instead of `@types/yazl` — pins the exact subset of yazl 3.3.1's API the project depends on without expanding the dev-dependency surface."
    - "Six-category path-traversal guard inside writeZip — defense in depth even though Plan 05's caller only passes hardcoded names; a future regression in build.ts fails here, not in a downstream extractor."
    - "Deterministic zip output verified by re-running writeZip with identical inputs and asserting Buffer.compare === 0 — `FIXED_MTIME = new Date('2000-01-01T00:00:00Z')` plus preserved entry order is enough to make yazl 3.3.1 produce byte-identical archives."

key-files:
  created:
    - "scripts/dwca/assertions.ts"
    - "scripts/dwca/assertions.test.ts"
    - "scripts/dwca/zip.ts"
    - "scripts/dwca/zip.test.ts"
    - "scripts/dwca/yazl.d.ts"
  modified: []

key-decisions:
  - "Throw `AlignmentError` rather than `process.exit` from `assertFieldAlignment`. The plan calls this out explicitly under task 1's <action>; the consequence is that the F-02 guard is unit-testable in Vitest. Plan 05's `build.ts` is the layer that catches and exits non-zero with build-specific framing."
  - "Add a 30-line local ambient module declaration (`scripts/dwca/yazl.d.ts`) instead of `npm i --save-dev @types/yazl`. Keeps the lockfile and devDependencies surface untouched while still satisfying `tsc --noEmit` under `verbatimModuleSyntax: true`. yazl 3.3.1 is the only consumer of this declaration; the declaration pins exactly the `addBuffer` / `outputStream` surface Plan 06 RESEARCH §T6 audited."
  - "Coerce non-bigint `n` to bigint in `assertNonZeroRows`. The real DuckDB driver returns COUNT(*) results as bigint, but accepting `number | string | bigint` makes the mock-based tests easy to write (no need to construct a bigint in every test fixture). Test `'coerces a non-bigint count (e.g. number) into a bigint'` documents the behavior."
  - "Validate every `name` before calling `mkdir` in `writeZip`. Rejecting bad names early avoids creating zero-byte temp directories on failed runs. Pre-validation also means the path-traversal test cases never touch the filesystem."

patterns-established:
  - "Structural-type-mocked DB connections in unit tests — `interface CountConnection` and the `mockConn` helper in `assertions.test.ts` are a template the Plan 05 build.ts tests can reuse for any future DuckDB-touching code path."
  - "Deterministic-output verification via Buffer.compare — the `writeZip determinism` test is the canonical pattern for any other deterministic-build artifact in the project (e.g., future archive variants)."
  - "Local ambient .d.ts files colocated with the module that uses them — `scripts/dwca/yazl.d.ts` next to `scripts/dwca/zip.ts`. Avoids an `ambient/` top-level directory and keeps `tsconfig.json` `include` paths simple (the `scripts` glob picks them up automatically)."

requirements-completed:
  - DWCA-01
  - DWCA-02

# Metrics
duration: 8min
completed: 2026-06-17
---

# Phase 06 Plan 04: assertions.ts + zip.ts utility modules Summary

**Plan 04 ships the two pure utility modules that Plan 05's `build.ts` orchestrates around: `scripts/dwca/assertions.ts` (the F-02 runtime guard that proves DWCA-02 at build start, plus two zero-result guards) and `scripts/dwca/zip.ts` (the deterministic-bytes yazl wrapper that writes the 4-file DarwinCore Archive). Both are unit-tested without a live DuckDB connection or external I/O beyond a tmp file — 22 new tests, all passing.**

## Performance

- **Duration:** ~8 min
- **Tasks:** 2
- **Files created:** 5 (`scripts/dwca/assertions.ts`, `assertions.test.ts`, `zip.ts`, `zip.test.ts`, `yazl.d.ts`)
- **Files modified:** 0
- **Tests:** 22 new (11 assertions + 11 zip), all passing; total dwca suite is now 36 / 36 green.

## Accomplishments

- **`assertFieldAlignment` implemented** — loops `i` from 0 to `max(pgCols.length, tsFields.length) - 1`; emits `[+i]`, `[-i]`, `[~i]` diff strings (0-based `i`, 1-based PG ordinal embedded in the string) and throws `AlignmentError` carrying `{ message, table, diff }`. Returns silently on full alignment.
- **`assertNonZeroRows` implemented** — runs `SELECT COUNT(*) AS n FROM ${fullyQualifiedTable}` against a structurally-typed `CountConnection`. Returns bigint on success; throws `Error('Empty result: ' + fullyQualifiedTable)` on zero. Accepts bigint, number, or string `n` values (real DuckDB returns bigint; coercion makes mocks ergonomic).
- **`assertNoZeroByteFile` implemented** — pure `fs/promises` `stat`; throws `Error('Zero-byte file: ' + path)` on `size === 0`; returns void on success.
- **`AlignmentError` exported** as a proper `Error` subclass — `instanceof Error` is true, `instanceof AlignmentError` is true, `name === 'AlignmentError'`, carries readonly `table: string` and `diff: readonly string[]`.
- **`PgColumn` exported** — `{ readonly name: string; readonly ordinal: number }`; the 1-based ordinal matches `information_schema.columns.ordinal_position` and is what `DESCRIBE pgdb.dwc.occurrences` rows surface via the `column_name` / position pair.
- **`writeZip` implemented** — single-file yazl wrapper. Pins every entry's `mtime` to `FIXED_MTIME` (2000-01-01 UTC, 946684800000 ms); preserves input entry order; rejects six categories of bad name; creates `dirname(outPath)` recursively; streams via `pipeline(zip.outputStream, createWriteStream(outPath))`. Returns void on success; propagates underlying errors.
- **`FIXED_MTIME` exported** — `new Date('2000-01-01T00:00:00Z')`, verified to be `946684800000` ms since epoch.
- **`ZipEntry` exported** — `{ readonly name: string; readonly content: Buffer }`.
- **Path-traversal guard rejects all six categories** — empty string, `..` substring, `\0` substring, leading `/`, leading `\`. Error message format: `Invalid zip entry name: <name>`.
- **Local `yazl.d.ts` ambient declaration** — covers `ZipFile`, `addBuffer(buffer, name, { mtime, compress, ... })`, `end()`, `outputStream: Readable`, and the `default` export shape. Lets `import yazl from 'yazl'` type-check under `verbatimModuleSyntax: true` without modifying `package.json`.

## Task Commits

Each task committed atomically with structural-typing and determinism criteria:

1. **Task 1: `assertions.ts` (F-02 runtime guard + zero-result guards)** — `8689b93` (feat)
2. **Task 2: `zip.ts` (deterministic yazl wrapper + path-traversal guard)** — `b576e10` (feat)

## `assertFieldAlignment` diff format — examples from the unit tests

Each test in `assertions.test.ts` asserts against the literal diff format. The three sentinel cases exercised by the tests render as (literal strings, embedded in `AlignmentError.diff`):

- **Extra TS entry at the tail** — `[+2] TS array has "c" but view has no column at ordinal 3`
- **Extra PG column at the tail** — `[-2] View has "c" at ordinal 3 but TS array ends`
- **Name mismatch at same ordinal** — `[~1] TS expects "b" but view has "x" at ordinal 2`
- **Multi-error diff (collected in index order)** — `e.diff[0]` matches `[~1]`, `e.diff[1]` matches `[+3]`; both are accumulated into a single `AlignmentError`.

The framing line prepended to the joined diff is `Field alignment mismatch for dwc.${table}:` — the test verifies via `expect(e.message).toContain('dwc.multimedia')`.

## Determinism confirmation

The `writeZip determinism` test writes two identical 4-entry archives to two different tmp paths and asserts `Buffer.compare(buf1, buf2) === 0`. CI now catches any future change in yazl, the project's Node version, or the `mtime: FIXED_MTIME` option semantics that would break the byte-identical property — which Phase 7 will eventually depend on for "no upstream change ⇒ skip republish" dedupe.

The entry order test verifies that `'a.txt'` appears at a strictly lower byte offset than `'b.txt'`, which appears at a strictly lower offset than `'c.txt'` in the raw zip bytes. yazl 3.3.1 honors `addBuffer` insertion order in both the local-file-header and central-directory regions.

## Acceptance criteria verification

### Task 1

- **`npx vitest run scripts/dwca/assertions.test.ts` exits 0 with ≥9 passing tests** — 11 passing, exit 0.
- **`grep -L '@duckdb/node-api' scripts/dwca/assertions.ts scripts/dwca/assertions.test.ts` lists both files** — confirmed at commit `8689b93` (both files print).
- **`AlignmentError instanceof Error` AND carries `diff: readonly string[]` AND `table: string`** — `'AlignmentError is an Error instance with table and diff readonly props'` test asserts all three.
- **Diff format uses literal `[+I]`, `[-I]`, `[~I]` prefixes with 0-based `I`** — regex assertions on each marker confirm.
- **`assertNonZeroRows` propagates the bigint count on success and includes the failing table name in the empty-result error** — both tests pass.
- **`assertNoZeroByteFile` uses `fs/promises`, not callback-style `fs`** — imported `from 'node:fs/promises'`; tests pass.
- **`npx tsc -p . --noEmit` exits 0** — confirmed.

### Task 2

- **`npx vitest run scripts/dwca/zip.test.ts` exits 0 with ≥5 passing tests** — 11 passing, exit 0.
- **Two `writeZip` invocations with identical inputs produce byte-identical files** — `Buffer.compare(buf1, buf2) === 0` test passes.
- **For inputs `['a.txt', 'b.txt', 'c.txt']`, raw bytes contain the names in input order** — `idxA < idxB < idxC` assertion passes.
- **Each of the six path-traversal probes throws an `Error` whose message contains `'Invalid zip entry name'`** — all six pass.
- **`writeZip(tmpDir + '/nested/subdir/test.zip', ...)` succeeds and the nested directory exists afterward** — passes; `stat(nested).isFile() === true` and `size > 0`.
- **`npx tsc -p . --noEmit` exits 0** — confirmed.
- **`FIXED_MTIME.getTime() === 946684800000`** — asserted; passes.

## Decisions Made

- **Throw, don't exit, on `assertFieldAlignment` failure** (plan task 1 was explicit about this). Lets Vitest observe the failure; lets Plan 05's `build.ts` catch and render a build-specific human-readable framing before calling `process.exit(1)`. Consequence: the F-02 guardrail is unit-testable end-to-end, not just in integration.
- **Local `yazl.d.ts` ambient declaration vs. `npm i --save-dev @types/yazl`.** `@types/yazl@3.3.1` does exist on the registry, but installing it would touch `package.json` / `package-lock.json` and silently expand the project's devDependency surface. A 30-line colocated `.d.ts` pins exactly the surface `zip.ts` uses (the `addBuffer` `mtime`/`compress` options and the `outputStream` `Readable`) — strictly less than the upstream typings would expose. The `tsconfig.json` `include: ["src", "database.types.ts", "scripts"]` already picks up `.d.ts` files under `scripts/`, so no config change is required.
- **Coerce non-bigint `n` to bigint inside `assertNonZeroRows`.** Real DuckDB returns COUNT(*) as bigint; accepting `bigint | number | string` is purely a test ergonomics decision (lets tests write `{ n: 5n }` OR `{ n: 5 }` interchangeably) with zero impact on production behavior. The test `'coerces a non-bigint count (e.g. number) into a bigint'` documents and pins the behavior.
- **Validate every entry name before opening any filesystem handle in `writeZip`.** Bad-name rejection happens before `mkdir`, so a malformed input never creates zero-byte temp directories on the host. The path-traversal tests rely on this — they pass a tmp `outPath` to `writeZip` but the path is never opened because the validate-first pattern shorts the function out.

## Deviations from Plan

**None.** Both tasks executed exactly as written. No Rule 1 / 2 / 3 auto-fixes were needed; no Rule 4 architectural checkpoint was triggered. One worktree-local action — `npm ci` — was required to populate `node_modules/` after the worktree was spawned; this is operational setup (not a code or plan deviation) and doesn't change the lockfile or `package.json`. The single net-new file outside the plan's declared `<files>` lists is `scripts/dwca/yazl.d.ts` (~30 lines, ambient declaration only) — its presence is explained under "Decisions Made" above. Both task `<files>` blocks list `assertions.ts/.test.ts` and `zip.ts/.test.ts` respectively; the `.d.ts` is a type-system-only artifact required by the project's `tsc --noEmit` acceptance criterion under `verbatimModuleSyntax: true` and is a legitimate Rule 3 fix (blocking issue inline-resolved with a local declaration rather than touching `package.json`).

## Issues Encountered

- **`@types/yazl` is not in devDependencies and `tsc --noEmit` was failing under `verbatimModuleSyntax: true` with `TS7016 Could not find a declaration file for module 'yazl'`.** Resolved by adding a colocated local ambient declaration `scripts/dwca/yazl.d.ts` that covers exactly the surface `zip.ts` calls (`ZipFile`, `addBuffer({ mtime, compress })`, `outputStream`, `end()`). Considered installing `@types/yazl@3.3.1` from npm (it exists, version-matched to runtime) but rejected to keep the lockfile and devDependency surface untouched. The local declaration is strictly narrower than the upstream typings and pins the exact API audited by Plan 06 RESEARCH §T6.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. The plan's threat register is mitigated:

- **T-06-04-DRIFT** (Tampering: `dwc.occurrences` view drifts and build silently emits wrong meta.xml) — mitigated. `assertFieldAlignment` is THE F-02 guard; Plan 05's `build.ts` will call it before any COPY, and CI fails loudly on any drift via the structured `[+i]`/`[-i]`/`[~i]` diff.
- **T-06-04-PATH** (Tampering: path-traversal in zip entry names) — mitigated. `writeZip` validates names against six categories before any filesystem handle is opened, even though Plan 05's caller only passes hardcoded names. Defense-in-depth.
- **T-06-04-EMPTY** (Denial of service: build silently produces an empty zip) — mitigated. `assertNonZeroRows` and `assertNoZeroByteFile` together ensure Phase 7 never publishes a manifestly-broken archive; Plan 05's `build.ts` calls both.
- **T-06-04-LOG** (Information disclosure: error messages could leak the DSN) — accepted (mitigated upstream). None of these three functions ever receives the DSN. `assertNonZeroRows` only sees a fully-qualified table name; `assertNoZeroByteFile` only sees an output path. Build.ts (Plan 05) is responsible for never logging the DSN.
- **T-06-04-ZIPBOMB** (Denial of service: malicious zip content) — accepted. All content originates from DuckDB COPY output of trusted Postgres views; no untrusted upload path exists.

## Known Stubs

None introduced. `scripts/dwca/build.ts` remains a stub from Plan 01 (referenced by `package.json`'s `build:dwca` script but not yet present) — that is Plan 05's responsibility and is out of scope for this plan.

## User Setup Required

None — no external service configuration, no environment variables, no migrations. `npm ci` is the standard worktree-spawn install step and doesn't count as user-facing setup.

## Next Wave Readiness

- Plan 05's `build.ts` can `import { assertFieldAlignment, assertNonZeroRows, assertNoZeroByteFile, type PgColumn } from './assertions.ts'` and `import { writeZip, FIXED_MTIME, type ZipEntry } from './zip.ts'` and rely on the test-contracted behavior end-to-end — no DuckDB connection required for unit-testing the guards, but the guards trigger when build.ts wires them to a live `pgdb.dwc.occurrences` connection.
- Plan 06's integration test can rely on `writeZip` to produce a byte-identical archive across runs, which lets the round-trip parser test compare against a checked-in golden archive without flakiness.
- The F-02 invariant is now enforced by THREE independent guardrails: Plan 02's `fields.test.ts` (catches drift in `fields.ts`), Plan 04's `assertFieldAlignment` (catches drift in the Postgres view at build time), Plan 06's round-trip integration test (catches drift in the produced archive). Defense in depth.

## Self-Check: PASSED

Files asserted present:
- `scripts/dwca/assertions.ts` — FOUND
- `scripts/dwca/assertions.test.ts` — FOUND
- `scripts/dwca/zip.ts` — FOUND
- `scripts/dwca/zip.test.ts` — FOUND
- `scripts/dwca/yazl.d.ts` — FOUND
- `.planning/phases/06-archive-generation/06-04-SUMMARY.md` — FOUND (this file)

Commits asserted in branch history:
- `8689b93` (Task 1, feat) — FOUND
- `b576e10` (Task 2, feat) — FOUND

Verification commands re-run at plan close:
- `npx tsc -p . --noEmit` → exit 0
- `npx vitest run scripts/dwca/` → 36 passed / 36 total (assertions 11, fields 14, zip 11), 0 skipped, 0 failed, exit 0
- `grep -L '@duckdb/node-api' scripts/dwca/assertions.ts scripts/dwca/assertions.test.ts` → both files listed (neither imports the package)
- `FIXED_MTIME.getTime() === 946684800000` → true (verified via node REPL)

---
*Phase: 06-archive-generation*
*Completed: 2026-06-17*
