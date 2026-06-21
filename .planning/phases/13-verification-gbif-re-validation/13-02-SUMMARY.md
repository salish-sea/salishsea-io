---
phase: 13-verification-gbif-re-validation
plan: "02"
subsystem: dwca
tags: [gbif, validation, rest-api, tdd]
dependency_graph:
  requires: []
  provides: [validate-gbif.ts, validate-gbif.test.ts]
  affects: [scripts/dwca/]
tech_stack:
  added: []
  patterns:
    - Node global fetch with FormData for multipart file upload
    - HTTP Basic Auth via Authorization header (credentials from env vars only)
    - Polling loop with interval + timeout cap
    - TDD RED/GREEN cycle — fixture-driven pure-function gate tests
key_files:
  created:
    - scripts/dwca/validate-gbif.ts
    - scripts/dwca/validate-gbif.test.ts
  modified: []
decisions:
  - "assertIndexeable uses strict === true (not truthy) per T-13-02-VAL"
  - "Unknown issue categories treated as non-blocking warnings (don't crash on new categories)"
  - "Authorization header and GBIF_PASS never logged (T-13-02-CRED)"
  - "Pre-existing obs-map.test.ts / salish-sea.test.ts failures are out-of-scope (CSS import issue in ol module)"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-21T21:54:00Z"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 0
---

# Phase 13 Plan 02: GBIF Validator REST Client Summary

**One-liner:** GBIF REST API client with multipart submit + poll + strict `indexeable`/blocking-category gate, unit-tested via fixture JSON with no network.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Create validate-gbif.ts — GBIF REST submit + poll + assertIndexeable gate | ca6aa6f (RED), 1b6fdf7 (GREEN) | Done |

## What Was Built

### `scripts/dwca/validate-gbif.ts`

Exports four functions per the plan spec:

- **`assertIndexeable(result)`** — pure gate over a parsed `GbifValidationResult`. Throws `"GBIF validator: not indexeable"` if `result.indexeable !== true` (strict boolean). Collects all issues across `result.results[].issues`; throws if any have `issueCategory` in `{RESOURCE_INTEGRITY, RESOURCE_STRUCTURE}` (the blocking set). Returns `{ warnings: GbifIssue[] }` — all non-blocking issues — so `main()` can report them without failing.

- **`submitValidation(zipPath, creds)`** — POSTs multipart/form-data with the zip as the `file` field to `https://api.gbif.org/v1/validation`. HTTP Basic Auth from `creds`. Returns the validation key UUID. Throws on non-2xx, printing the manual fallback URL.

- **`pollValidation(key, creds)`** — GETs `/v1/validation/{key}` in a loop. 7-second poll interval; 5-minute timeout cap. Returns the final result when state is no longer `RUNNING` or `QUEUED`. Throws on timeout or non-2xx with the fallback URL.

- **`main()`** — CLI entry point. Reads `GBIF_USER`/`GBIF_PASS` from env (exits with clear message + manual fallback URL if absent). Checks zip exists. Submits → polls → calls `assertIndexeable`. Prints `PASS` + warning summary on success, or `FAIL` + blocking issues on failure, then exits non-zero. The `Authorization` header and `GBIF_PASS` are never logged anywhere (T-13-02-CRED).

### `scripts/dwca/validate-gbif.test.ts`

Three fixture-driven unit tests for `assertIndexeable` — no network calls:

- **(a)** `indexeable:true` + `METADATA_CONTENT`/`OCC_INTERPRETATION_BASED` warnings → passes, returns 2 warnings
- **(b)** `indexeable:false` → throws `"GBIF validator: not indexeable"`
- **(c)** `indexeable:true` + `RESOURCE_STRUCTURE` issue → throws containing `"RESOURCE_STRUCTURE"`

## Verification

```
npm test -- scripts/dwca/validate-gbif.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

Full suite: 16 test files passing, 1 skipped, 3 new tests added. Two pre-existing failing suites (`obs-map.test.ts`, `salish-sea.test.ts`) are unrelated CSS import failures in the OpenLayers module — out of scope.

## Acceptance Criteria

- [x] `scripts/dwca/validate-gbif.ts` exists, exports `assertIndexeable`, `submitValidation`, `pollValidation`, `main`
- [x] `RESOURCE_INTEGRITY` and `RESOURCE_STRUCTURE` both referenced in blocking-category set (3× each)
- [x] `api.gbif.org/v1/validation` endpoint present (6×)
- [x] No `console.log` line references `Authorization` or `Basic ` — credentials never logged
- [x] `https://www.gbif.org/tools/data-validator` manual fallback URL present
- [x] `npm test -- scripts/dwca/validate-gbif.test.ts` green (3/3 tests pass)

## TDD Gate Compliance

- RED commit: `ca6aa6f` — `test(13-02): add failing tests for assertIndexeable gate`
- GREEN commit: `1b6fdf7` — `feat(13-02): implement GBIF validator REST client with assertIndexeable gate`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The script is complete and functional. The actual network run against a freshly-built archive happens in Plan 13-03 (Wave 2), which requires both GBIF credentials and a built zip.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes beyond those already covered in the plan's threat model (T-13-02-CRED, T-13-02-VAL, T-13-02-TLS, T-13-SC).

## Self-Check: PASSED

- [x] `scripts/dwca/validate-gbif.ts` — FOUND
- [x] `scripts/dwca/validate-gbif.test.ts` — FOUND
- [x] Commit `ca6aa6f` — FOUND (RED: test)
- [x] Commit `1b6fdf7` — FOUND (GREEN: feat)
