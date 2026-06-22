---
phase: 14-dwc-a-build-pre-prod-gate-seeded-local-db
verified: 2026-06-22T20:45:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification_resolved:
  - test: "Confirm CI run passes on an actual PR — the gate runs on ubuntu-latest GitHub Actions runners where psql availability was asserted but not CI-confirmed in this phase"
    expected: "Build job applies ci-seed.sql via psql, Run tests step passes with SUPABASE_DB_URL set, build.test.ts describe block reports as RUN (not skipped)"
    result: "CONFIRMED 2026-06-22 — PR #278 (salish-sea/salishsea-io), Build run 27929938027: green end-to-end on ubuntu-latest; supabase db start ✓, Apply CI seed fixture (psql) ✓, Run tests with build.test.ts ACTIVATED ✓. (A pre-existing stale database.types.ts from phases 9-10 blocked the gen-types step on the first attempt; regenerated on the PR branch.) See 14-HUMAN-UAT.md."
---

# Phase 14: DwC-A Build Pre-Prod Gate (Seeded Local DB) — Verification Report

**Phase Goal:** The DwC-A build (`npm run build:dwca` / `build.test.ts`) runs end-to-end against a seeded local Postgres in CI on every PR — turning the previously `describe.skip`'d, `SUPABASE_DB_URL`-gated integration suite into a true pre-merge gate, so build-time SQL/query/wiring bugs are caught before the nightly post-deploy run.
**Verified:** 2026-06-22T20:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Applying supabase/ci-seed.sql to a freshly-migrated local DB exits 0 with no FK/constraint/PK errors | VERIFIED | psql -f exits 0 locally; live seeded suite run exits 0 with 240 rows; commit 15931f7 |
| 2 | After fixture applied, dwc.occurrences has >= 1 row (trusted native + 2 trusted Maplify; untrusted Row B excluded) | VERIFIED | Live suite run: build:dwca logs "240 occurrence rows"; ci-seed.sql Row B has `trusted=FALSE` with ON CONFLICT guard |
| 3 | After fixture applied, dwc.multimedia has >= 1 row (the native observation photo) | VERIFIED | Photo inserted with `license_code='cc-by'` (not 'none'/NULL); SUMMARY confirms count=1 |
| 4 | The Step 15.5 associated-parties query returns >= 1 org (Orca Network via orca-network collection) | VERIFIED | Maplify Row A has `collection_id=1` (orca-network, org_id=1); build.ts Step 15.5 is pgdb-qualified; build:dwca exits 0 in live run |
| 5 | supabase db reset applies the full migration chain from scratch and exits 0 (RESEARCH A3 risk retired) | VERIFIED | SUMMARY records 43 migrations applied cleanly; nightly.yml untouched per git log |
| 6 | The fixture references existing provider/organization/collection IDs and does NOT re-insert reference rows | VERIFIED | `grep "INSERT INTO public.providers\|public.organizations\|public.collections" ci-seed.sql` returns empty |
| 7 | build.yml applies supabase/ci-seed.sql after `supabase db start` and before `npm test`; SUPABASE_DB_URL is step-scoped to the test step only; build.test.ts un-skips | VERIFIED | Line 30-31: Apply CI seed fixture (psql); Line 42-45: Run tests with step-scoped env; SUPABASE_DB_URL count=1; `npm test -- run` with DSN: 20 files / 197 tests PASS |
| 8 | A fresh checkout with NO SUPABASE_DB_URL passes `npm test` with build.test.ts reported skipped | VERIFIED | `env -u SUPABASE_DB_URL npm test -- run`: 19 passed / 1 skipped, exit 0 |
| 9 | guard.ts / ROW_FLOOR remain untouched | VERIFIED | `guard.ts` line 41: `BigInt(process.env['ROW_FLOOR'] ?? 1000)` unchanged; git log shows only guard.test.ts modified in b99587e |
| 10 | A deliberate bare-schema-ref regression makes the seeded suite go red (gate has teeth) | VERIFIED (human-approved during execution) | SUMMARY 14-02 Task 3: mutation `FROM maplify.sightings` → non-zero exit + "Catalog Error: Table with name 'maplify.sightings' does not exist because schema 'maplify' does not exist"; git status clean after restore; Task 3 is a `checkpoint:human-verify` gate |

**Score:** 7/7 core must-haves verified (10 observable truths, all passing)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/ci-seed.sql` | CI-only static fixture: maplify.sightings (3 rows), public.observations (1 row), public.observation_photos (1 row); references migration-seeded IDs | VERIFIED | 157 lines; all 5 INSERT types present; no providers/organizations/collections INSERTs; no prod creds/PII; commit 15931f7 |
| `.github/workflows/build.yml` | PR Build job extended with Apply CI seed fixture step + step-scoped SUPABASE_DB_URL on npm test | VERIFIED | Step at line 30-31 (psql, after db start line 29, before gen-types line 32); SUPABASE_DB_URL at line 44-45 (step-scoped); count=1; YAML readable; commit 2753c9c |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `.github/workflows/build.yml` (Apply CI seed fixture step) | `supabase/ci-seed.sql` | `psql -f supabase/ci-seed.sql` | WIRED | Line 31: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/ci-seed.sql`; deviation from plan's `supabase db query --local --file` is documented and accepted (SQLSTATE 42601 bug) |
| `.github/workflows/build.yml` (Run tests step env) | `scripts/dwca/build.test.ts` HAS_DSN gate | step-scoped `SUPABASE_DB_URL` | WIRED | `SUPABASE_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres` on the Run tests step; build.test.ts line 52: `const HAS_DSN = !!process.env['SUPABASE_DB_URL']`; live run confirms activation |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `scripts/dwca/build.test.ts` | DWCA suite output | `npm run build:dwca` child process → `dwc.occurrences` view → seeded Postgres | Yes — 240 rows confirmed in live run | FLOWING |
| `supabase/ci-seed.sql` | dwc.occurrences rows | maplify.sightings (3 rows) + public.observations (1 row) → DwC views | Yes — live suite run shows build:dwca passes assertNonZeroRows | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Seeded suite exits 0, 20 files / 197 tests pass | `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test -- run` | "Test Files  20 passed (20), Tests  197 passed (197)" | PASS |
| No-DSN npm test exits 0, build.test.ts skipped | `env -u SUPABASE_DB_URL npm test -- run` | "Test Files  19 passed \| 1 skipped (20), Tests  186 passed \| 11 skipped (197)" | PASS |
| SUPABASE_DB_URL appears exactly once (step-scoped) in build.yml | `grep -v '^[[:space:]]*#' .github/workflows/build.yml \| grep -c SUPABASE_DB_URL` | `1` | PASS |
| ci-seed.sql contains no reference table re-inserts | `grep "INSERT INTO public.providers\|public.organizations\|public.collections" ci-seed.sql` | empty | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DWCA-GATE-01 | 14-01 | CI-only static fixture `supabase/ci-seed.sql` applied after migrations | SATISFIED | File exists, 157 lines, all required INSERTs present; commit 15931f7 |
| DWCA-GATE-02 | 14-01 | Fixture is branch-covering minimal: trusted+untrusted, tagged+untagged, with/without collection_id, >=1 multimedia | SATISFIED | Row A (trusted, tagged, coll_id=1), Row B (untrusted), Row C (trusted, untagged, coll_id=NULL); observation_photos row with cc-by license |
| DWCA-GATE-03 | 14-02 | build.yml applies fixture + exports SUPABASE_DB_URL scoped to `npm test`; suite un-skips | SATISFIED | Lines 30-45 of build.yml; live run: 20 files / 197 tests pass |
| DWCA-GATE-04 | 14-02 | guard.ts/ROW_FLOOR untouched, nightly-only | SATISFIED | guard.ts line 41 unchanged (BigInt 1000 floor); only guard.test.ts was modified; dwca-nightly.yml untouched |
| DWCA-GATE-05 | 14-02 | No-DSN `npm test` still passes (skip path preserved) | SATISFIED | `env -u SUPABASE_DB_URL npm test -- run`: exit 0, 1 file skipped |
| DWCA-GATE-06 | 14-01 | `supabase db reset` applies the full migration chain cleanly from scratch | SATISFIED | SUMMARY records 43 migrations applied cleanly; A3 risk retired |
| DWCA-GATE-07 | 14-02 | Gate fails on a deliberate bare-schema-ref regression (manual red-test, SC#4) | SATISFIED (human-approved) | Task 3 checkpoint:human-verify; SUMMARY documents Catalog Error exit non-zero; no permanent negative test committed |

**Orphaned requirements check:** DWCA-GATE-01..07 are defined in ROADMAP.md Phase 14 (line 200) but are absent from REQUIREMENTS.md's traceability table. The PLAN's `<artifacts_produced>` section called for backfill into both ROADMAP.md and REQUIREMENTS.md. ROADMAP.md was updated; REQUIREMENTS.md was not updated with a traceability row. This is a documentation gap only — the REQUIREMENTS.md file covers v1.3 attribution requirements (ATTR-*, PROV-*, etc.); DWCA-GATE-* are CI/testing requirements minted within the phase itself. The functional gate works correctly. This is classified as WARNING (documentation debt), not a blocker.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `supabase/ci-seed.sql` | 17 | `-- Safe to re-run ONLY on a freshly-reset DB` | INFO | Documented limitation, not a code debt marker |
| `scripts/dwca/guard.test.ts` | 192 | Comment referencing old `mockRestore()` approach | INFO | Explanatory comment, not a debt marker — clarifies why `importActual` is used instead |

No TBD, FIXME, or XXX markers found in any file modified by this phase.

### Notable Deviation: psql vs. supabase db query --local --file

The plan specified `supabase db query --local --file supabase/ci-seed.sql` for both local testing and build.yml CI. The actual implementation uses `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/ci-seed.sql` because `supabase db query --local --file` pipes the entire file as a single prepared statement, which fails on multi-statement SQL with SQLSTATE 42601.

This deviation is:
- Documented in PLAN 14-01 Deviation #2 and SUMMARY 14-02 Deviation 1
- Functionally equivalent for CI purposes (psql is preinstalled on ubuntu-latest runners per RESEARCH)
- More robust (-v ON_ERROR_STOP=1 ensures CI fails fast on any fixture error)
- The `key_links` acceptance criterion in PLAN 14-02 (`grep -q 'supabase db query --local --file supabase/ci-seed.sql'`) technically fails, but the goal is met via a better mechanism

### Human Verification Required

#### 1. First real PR CI run with the new gate

**Test:** Open or push to a PR against main, observe the GitHub Actions Build job complete
**Expected:** The "Apply CI seed fixture" step applies psql successfully; the "Run tests" step runs 20 test files / 197 tests passing including build.test.ts (not skipped); overall Build check is green
**Why human:** psql availability on ubuntu-latest runners is researched (documented by GitHub as preinstalled) but has not been exercised by an actual CI run with this workflow configuration. The gate wiring is locally verified; CI execution is the only remaining confirmation.

---

## Gaps Summary

No functional gaps found. The phase goal is achieved: `build.test.ts` is a true pre-merge gate against a seeded local Postgres in CI. All 7 requirement IDs are satisfied. The one outstanding item is a first real PR CI run to confirm the psql fixture apply step works on ubuntu-latest — this is a confirmatory check, not a suspected failure.

Minor documentation gap: DWCA-GATE-01..07 were not added to REQUIREMENTS.md's traceability table. Since these IDs were minted within this phase (not pre-existing v1.3 requirements), this is informational only and does not affect gate functionality.

---

_Verified: 2026-06-22T20:45:00Z_
_Verifier: Claude (gsd-verifier)_
