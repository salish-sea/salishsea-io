---
phase: 11-resolution-backfill
plan: "01"
subsystem: ingest/resolver
tags: [typescript, vitest, tdd, pure-function, resolver]
dependency_graph:
  requires: []
  provides: [RESOLVE-01]
  affects: [11-04]
tech_stack:
  added: []
  patterns: [pure-module, vitest-pure-function-test]
key_files:
  created:
    - scripts/ingest/resolve-provider.ts
    - scripts/ingest/resolve-provider.test.ts
  modified: []
decisions:
  - "D-06: resolveProvider is a pure function for one-time backfill and future extension, NOT on Maplify path and NOT the ongoing single-collection mechanism"
  - "salishsea.io hostname match covers native observations regardless of URL path (url column is user-entered)"
  - "iNaturalist matched on both www.inaturalist.org and inaturalist.org hostnames"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-19"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 0
---

# Phase 11 Plan 01: Pure URL-Pattern Resolver Summary

**One-liner:** Pure TypeScript URL resolver mapping iNaturalist and salishsea.io host names to Phase-9 provider/collection slug pairs via built-in URL constructor, with vitest suite.

## What Was Built

`scripts/ingest/resolve-provider.ts` — exports `resolveProvider(sourceUrl: string): ProviderResolution` and type `ProviderResolution = { readonly provider: string; readonly collection: string } | null`. Implemented with the built-in `URL` constructor in try/catch (returns null on parse failure), then exact hostname matching. No external npm dependencies.

`scripts/ingest/resolve-provider.test.ts` — 9 vitest tests covering: iNat with www, iNat without www, iNat non-observation path, salishsea.io with query param, salishsea.io root, example.com (null), empty string (null), non-URL string (null), unrecognized host (null).

## TDD Gate Compliance

- RED commit: `cbed852` — test(11-01): add failing vitest suite for resolveProvider
- GREEN commit: `8312c0e` — feat(11-01): implement resolveProvider pure URL-pattern resolver

Both gates satisfied. REFACTOR not needed (implementation is already minimal and clean).

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Add failing vitest suite | cbed852 | scripts/ingest/resolve-provider.test.ts |
| 1 (GREEN) | Implement resolveProvider | 8312c0e | scripts/ingest/resolve-provider.ts |

## Verification Results

- `npm test -- resolve-provider`: 9/9 tests pass, exit 0
- Full suite: pre-existing 2 failures (`obs-map.test.ts`, `salish-sea.test.ts`) due to OpenLayers CSS import issue in test environment — unrelated to this plan's changes; 14 other suites pass
- No package.json or package-lock.json changes
- `export function resolveProvider` present at line 50
- `export type ProviderResolution` present at line 34
- Slug literals `'inaturalist'` and `'salishsea-direct'` present (Phase 9 join contract)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — both files are complete implementations with no placeholder values.

## Threat Flags

None — the resolver is a pure function with no network access, no DB writes, no eval, and no external imports. Trust boundary (ingest URL string → resolver) is addressed by try/catch around URL() and null return on unrecognized input, per T-11-01-01 mitigation.

## Self-Check: PASSED

- [x] `scripts/ingest/resolve-provider.ts` exists
- [x] `scripts/ingest/resolve-provider.test.ts` exists
- [x] Commit `cbed852` exists (RED)
- [x] Commit `8312c0e` exists (GREEN)
- [x] All 9 tests pass
