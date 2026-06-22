---
phase: 14-dwc-a-build-pre-prod-gate-seeded-local-db
plan: "02"
subsystem: ci-gate
tags:
  - ci
  - build-yml
  - dwc-a
  - fixture
  - guard
dependency_graph:
  requires:
    - "supabase/ci-seed.sql (Plan 01 artifact — applied by this plan's build.yml step)"
    - ".github/workflows/build.yml (pre-existing Build job)"
    - "scripts/dwca/build.test.ts (HAS_DSN gate — not modified)"
    - "scripts/dwca/guard.test.ts (broken DSN-gated test — fixed in this plan)"
  provides:
    - "DWCA-GATE-03: build.yml applies fixture + step-scoped SUPABASE_DB_URL; suite un-skips on every PR"
    - "DWCA-GATE-04: guard.ts/ROW_FLOOR untouched — gate runs build.test.ts only"
    - "DWCA-GATE-05: no-DSN npm test still passes with build.test.ts skipped"
    - "DWCA-GATE-07: deliberate bare-schema-ref regression makes seeded suite exit non-zero (red-test)"
  affects:
    - ".github/workflows/build.yml"
    - "scripts/dwca/guard.test.ts"
tech_stack:
  added: []
  patterns:
    - "psql -f for multi-statement CI seed fixture (supabase db query --local --file unsupported)"
    - "vi.importActual for restoring real module implementation in a vi.mock() test"
    - "Step-scoped env: block in GitHub Actions YAML for DSN injection"
key_files:
  created: []
  modified:
    - ".github/workflows/build.yml"
    - "scripts/dwca/guard.test.ts"
decisions:
  - "psql used for fixture apply in build.yml (supabase db query --local --file errors on multi-statement SQL — SQLSTATE 42601)"
  - "vi.importActual used in guard.test.ts DSN-gated test to restore real DuckDB after vi.mock() — mockRestore() only valid on vi.spyOn() spies"
  - "guard.ts / ROW_FLOOR left untouched — gate runs build.test.ts only (DWCA-GATE-04)"
  - "No permanent negative test committed — red-test is throwaway scratch mutation restored via git checkout"
metrics:
  duration: "2min"
  completed: "2026-06-22"
  tasks_completed: 3
  files_created: 0
  files_modified: 2
---

# Phase 14 Plan 02: CI Gate Activation (build.yml + guard.test.ts fix) Summary

**One-liner:** Extended build.yml with a psql CI seed step + step-scoped SUPABASE_DB_URL on the npm test step; repaired the broken DSN-gated guard.test.ts mockRestore; red-test confirmed the gate catches bare-schema-ref regressions with Catalog Error exit non-zero.

## What Was Built

### Task 1: build.yml — Apply CI seed fixture + step-scoped SUPABASE_DB_URL

Two additive changes to `.github/workflows/build.yml`:

**Change 1 — `Apply CI seed fixture` step** (inserted after `supabase db start`, before `Verify generated types match Postgres schema`):

```yaml
- name: Apply CI seed fixture
  run: psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/ci-seed.sql
```

**Change 2 — `Run tests` step** (converted from bare `- run: npm test`, added step-scoped env):

```yaml
- name: Run tests
  run: npm test
  env:
    SUPABASE_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

`SUPABASE_DB_URL` appears exactly once in build.yml (step-scoped on the root test step, not job-wide). The `working-directory: infra` test step remains unchanged and receives no DSN.

### guard.test.ts Fix (scope addition — user-approved)

Fixed the broken DSN-gated test (`guard trips when dwc.occurrences row count <= ROW_FLOOR`):

**Root cause:** `vi.mocked(duckdbModule.DuckDBInstance.create).mockRestore()` was called on a `vi.fn()` mock (not a `vi.spyOn()` spy). `mockRestore()` is only valid on spies — on a plain `vi.fn()`, it silently leaves `.create` returning `undefined`. The guard then called `(undefined).connect()` and threw `TypeError: Cannot read properties of undefined (reading 'connect')`.

**Fix:** Replaced `mockRestore()` with `vi.importActual` + `mockImplementation`:

```typescript
const { DuckDBInstance: RealDuckDBInstance } =
    await vi.importActual<typeof import('@duckdb/node-api')>('@duckdb/node-api');
vi.mocked(duckdbModule.DuckDBInstance.create).mockImplementation(
    RealDuckDBInstance.create.bind(RealDuckDBInstance),
);
```

This wires the real DuckDB implementation for the DSN-gated test, letting `guard.ts` connect to the seeded Postgres. `afterEach` → `vi.restoreAllMocks()` resets the mock. All 7 guard tests pass.

## Task 2: No-DSN Skip Path (DWCA-GATE-05)

`env -u SUPABASE_DB_URL npm test -- run` output:

```
Test Files  19 passed | 1 skipped (20)
Tests  186 passed | 11 skipped (197)
```

Exit code: 0. The `build:dwca integration (DWCA-01..04/06 ...)` describe block is skipped when no DSN is set — fresh-checkout contributors still get a green `npm test` without a database.

## Task 3: Red-Test — Gate Proven Load-Bearing (DWCA-GATE-07)

**Mutation injected:** In `scripts/dwca/build.ts` Step 15.5 (the associated-parties query), changed:

```sql
FROM pgdb.maplify.sightings s
```
to:
```sql
FROM maplify.sightings s
```

(Dropped the `pgdb.` prefix — reproduces the aad63dd bare-schema-ref regression.)

**Seeded suite result:**

```
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test -- run
```

Exit code: **1** (non-zero). Two failures caught:

1. **Static check (`build-queries.test.ts`):** `build.ts has unqualified Postgres refs (must be pgdb.-prefixed): FROM maplify.`
2. **Runtime check (`build.test.ts`):** `Command failed: npm run build:dwca` — build pipeline exited non-zero with:
   ```
   [build:dwca] FAILED: Catalog Error: Table with name "maplify.sightings" does not exist
   because schema "maplify" does not exist.
   LINE 3:             FROM maplify.sightings s
   ```

**Restore:** `git checkout -- scripts/dwca/build.ts`

**Post-restore `git status`:** Clean — no modification to `scripts/dwca/build.ts`. No permanent negative test committed. No `*.fails` / regression test file created.

**Post-restore seeded suite:**

```
Test Files  20 passed (20)
Tests  197 passed (197)
Exit code: 0
```

Gate is load-bearing AND the green state is restored cleanly.

## Full Seeded Suite Results (final state)

`SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test -- run`:

- 20 test files pass (0 skipped, 0 failed)
- 197 tests pass
- Exit code: 0
- build.test.ts ACTIVATED (not skipped), all DWCA-01..04/06 assertions passing
- guard.test.ts DSN-gated Test 4 PASSING (row floor tripped correctly)

## Deviations from Plan

### Deviation 1: psql used instead of `supabase db query --local --file` (Rule 1 - Bug carried from Plan 01)

**Found during:** Task 1 implementation (inherited as a known issue from Plan 01 SUMMARY Deviation #2)

**Issue:** Plan 14-02 Task 1 specified `supabase db query --local --file supabase/ci-seed.sql` in both the action text and acceptance criteria. This command errors with `SQLSTATE 42601: cannot insert multiple commands into a prepared statement` because the fixture has 5 top-level SQL statements (auth.users INSERT, DO block, 3 Maplify INSERTs) and `--file` pipes the whole file as a single prepared statement.

**Fix:** Used `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/ci-seed.sql` instead. `psql` is preinstalled on ubuntu-latest GitHub Actions runners. The `-v ON_ERROR_STOP=1` flag ensures CI fails fast if any statement in the fixture errors.

**Acceptance criteria adjusted:** Grep for `supabase db query --local --file supabase/ci-seed.sql` would have failed; success criteria updated to verify the actual psql invocation. YAML validation and SUPABASE_DB_URL count checks unchanged.

**Files modified:** `.github/workflows/build.yml`
**Commit:** 2753c9c

### Deviation 2: guard.test.ts scope addition (user-approved expansion)

**Found during:** Pre-implementation analysis (handoff from Plan 01 SUMMARY "Pre-existing Out-of-Scope Issue")

**Issue:** `guard.test.ts` Test 4 (`guard trips when dwc.occurrences row count <= ROW_FLOOR`) fails when `SUPABASE_DB_URL` is set because `vi.mocked(duckdbModule.DuckDBInstance.create).mockRestore()` is called on a `vi.fn()` (not a spy). The test un-skips when DSN is set, causing `npm test` to exit non-zero on correct code.

**Fix:** Replaced `mockRestore()` with `vi.importActual('@duckdb/node-api')` + `mockImplementation()` to wire the real DuckDB. All 7 guard tests pass. `guard.ts` production logic and `ROW_FLOOR` untouched (DWCA-GATE-04).

**Authorization:** Explicitly approved in the execution handoff context ("The user has explicitly APPROVED expanding this plan's scope to fix scripts/dwca/guard.test.ts").

**Files modified:** `scripts/dwca/guard.test.ts`
**Commit:** b99587e

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. `SUPABASE_DB_URL` in build.yml is the well-known local-dev DSN (not a secret; both acceptance criteria and T-14-04 threat register disposition confirm accept). Step-scoped on the test step only — T-14-04 mitigation verified. T-14-05 (guard.ts/nightly.yml untouched) and T-14-06 (build.ts clean after red-test) both confirmed.

## Commits

| Commit | Description | Files |
|--------|-------------|-------|
| 2753c9c | feat(14-02): extend build.yml — psql fixture apply + step-scoped SUPABASE_DB_URL | .github/workflows/build.yml |
| b99587e | fix(14-02): repair guard.test.ts DSN-gated mock so seeded npm test is green | scripts/dwca/guard.test.ts |

## Notes on ROADMAP.md / Todo Closure

- **DWCA-GATE-01..07 backfilled into ROADMAP.md Phase 14 Requirements** (listed as `DWCA-GATE-01, DWCA-GATE-02, DWCA-GATE-03, DWCA-GATE-04, DWCA-GATE-05, DWCA-GATE-06, DWCA-GATE-07`) — this plan marks DWCA-GATE-03, 04, 05, 07 complete.
- **Origin todo `2026-06-21-seeded-local-db-gate-for-dwca-build.md` can be closed** — the gate is now wired into CI. All requirements (DWCA-GATE-01..07) are satisfied between Plans 01 and 02.

## Self-Check: PASSED

- [x] `.github/workflows/build.yml` modified: `Apply CI seed fixture` step exists after `supabase db start`, before gen-types
- [x] `SUPABASE_DB_URL` appears exactly once in build.yml (step-scoped)
- [x] `infra` test step has no SUPABASE_DB_URL
- [x] YAML parses valid (js-yaml confirmed)
- [x] `scripts/dwca/guard.test.ts` fixed: all 7 tests pass with DSN set
- [x] No-DSN `npm test -- run`: exit 0, build.test.ts skipped (DWCA-GATE-05)
- [x] Seeded `SUPABASE_DB_URL=... npm test -- run`: exit 0, 20 files / 197 tests pass (DWCA-GATE-03)
- [x] Red-test: bare-schema-ref exits non-zero with Catalog Error (DWCA-GATE-07)
- [x] build.ts clean after restore: git status shows no modification
- [x] No permanent negative test committed
- [x] Commit 2753c9c exists
- [x] Commit b99587e exists
- [x] guard.ts / ROW_FLOOR untouched (DWCA-GATE-04)
- [x] dwca-nightly.yml untouched
