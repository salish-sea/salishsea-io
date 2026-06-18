---
phase: 06-archive-generation
plan: 01
subsystem: infra
tags: [duckdb, yazl, tsx, vitest, typescript, dwca]

# Dependency graph
requires: []
provides:
  - "scripts/dwca/ directory wired into tsconfig include"
  - "@duckdb/node-api@1.5.4-r.1 + yazl@3.3.1 + tsx as devDependencies"
  - "npm run build:dwca script entry resolving to scripts/dwca/build.ts"
  - "scripts/dwca/fields.ts placeholder exporting OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS, OccurrenceField, MultimediaField"
  - "scripts/dwca/fields.test.ts Vitest scaffold (1 passed + 7 skipped DWCA-02 assertions)"
affects:
  - 06-02 (populates OCCURRENCE_FIELDS / MULTIMEDIA_FIELDS and unskips DWCA-02 assertions)
  - 06-03 (consumes scripts/dwca tsconfig include)
  - 06-04 (uses @duckdb/node-api for DuckDB-side COPYs)
  - 06-05 (uses yazl for TS-side zip; populates build.ts)

# Tech tracking
tech-stack:
  added:
    - "@duckdb/node-api@1.5.4-r.1 (devDep, exact pin)"
    - "yazl@3.3.1 (devDep, exact pin)"
    - "tsx@^4.20.0 (devDep, resolved to 4.22.4)"
  patterns:
    - "scripts/ tree is type-checked under the same strict tsconfig as src/ (single include array, no separate tsconfig)"
    - "Wave-0 scaffolding pattern: empty `as const satisfies readonly Field[]` placeholders + Vitest test.skip(...) TODOs let downstream waves unskip without retyping"

key-files:
  created:
    - "scripts/dwca/fields.ts"
    - "scripts/dwca/fields.test.ts"
  modified:
    - "package.json"
    - "package-lock.json"
    - "tsconfig.json"

key-decisions:
  - "Add `scripts` to tsconfig.json include (rather than a separate tsconfig) so all Phase 6 script files inherit strict, noUncheckedIndexedAccess, verbatimModuleSyntax, allowImportingTsExtensions"
  - "Use tsx (4.22.4) as the build:dwca runner rather than `node --experimental-strip-types`, since the latter does not honor verbatimModuleSyntax consistently for this project's import style"
  - "Widen the imported `as const` tuples to `readonly Field[]` inside fields.test.ts so the Plan 02 test.skip(...) assertions type-check today against the empty placeholders — Plan 02 just unskips, no type churn"

patterns-established:
  - "Wave-0 placeholder + scaffold pattern: exports use `as const satisfies readonly T[]` for the populated case; tests cast/widen to `readonly T[]` so future-shape assertions are written once and unskipped, not re-written"
  - "Plan 6 conventional commit scope: `chore(06-01)`, `feat(06-01)`, etc. — phase-plan compound scope"

requirements-completed:
  - DWCA-02

# Metrics
duration: 3min
completed: 2026-06-17
---

# Phase 06 Plan 01: Wave-0 DWCA Bootstrap Summary

**`scripts/dwca/` is now type-checked, dep-resolved, Vitest-discoverable, and exports placeholder `OCCURRENCE_FIELDS`/`MULTIMEDIA_FIELDS` arrays — Wave 1 can begin populating without environment setup overhead.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-17T23:44:37Z
- **Completed:** 2026-06-17T23:47:37Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Installed exact-pinned `@duckdb/node-api@1.5.4-r.1` and `yazl@3.3.1`, plus `tsx@^4.20.0` (resolved to 4.22.4), as devDependencies. No `npm update` was invoked — exact pins per project memory.
- Extended `tsconfig.json` `include` with `"scripts"` so `scripts/dwca/*.ts` is now under the same strict / `noUncheckedIndexedAccess` / `verbatimModuleSyntax` regime as `src/`.
- Wired `npm run build:dwca` → `tsx scripts/dwca/build.ts` (build.ts itself lands in Plan 05).
- Created `scripts/dwca/fields.ts` exporting `OCCURRENCE_FIELDS`, `MULTIMEDIA_FIELDS`, `OccurrenceField`, `MultimediaField` as Wave-0 empty placeholders with a JSDoc header marking the file as source-of-truth and pointing at `06-CONTEXT.md` F-01.
- Created `scripts/dwca/fields.test.ts` Vitest scaffold: 1 passing smoke test + 7 `test.skip(...)` assertions wired to RESEARCH §T8 DWCA-02 unit surface with `TODO(Plan 02)` tags.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install deps, wire script, extend tsconfig include** — `1e265c7` (chore)
2. **Task 2: Placeholder fields.ts + skipped fields.test.ts scaffold** — `66dc848` (feat)

## Files Created/Modified

- `scripts/dwca/fields.ts` *(created)* — placeholder field-definition module; exports `OCCURRENCE_FIELDS`, `MULTIMEDIA_FIELDS` (both empty `as const satisfies readonly Field[]`), `OccurrenceField`, `MultimediaField`. JSDoc declares source-of-truth role and links F-01.
- `scripts/dwca/fields.test.ts` *(created)* — Vitest scaffold. 1 non-skipped smoke test (imports resolve, arrays are arrays), 7 `test.skip(...)` entries covering DWCA-02 unit surface: occurrence count == 25, occurrence every-entry non-empty, occurrence dcterms pair at indices 19/22, occurrence name uniqueness, multimedia count == 6, multimedia indices 1..5 use dcterms URIs, dcterms-prefix-implies-name-match invariant. Each skipped test carries a `TODO(Plan 02)` comment.
- `package.json` *(modified)* — added 3 devDeps (`@duckdb/node-api`, `yazl`, `tsx`) and the `build:dwca` script entry.
- `package-lock.json` *(modified)* — 4635 → 5342 lines (+724/-17 lines).
- `tsconfig.json` *(modified)* — `include` extended from `["src", "database.types.ts"]` to `["src", "database.types.ts", "scripts"]`.

### Installed Versions (read from `node_modules/{pkg}/package.json`)

| Package | Pin (package.json) | Resolved Version |
|---|---|---|
| `@duckdb/node-api` | `1.5.4-r.1` (exact) | `1.5.4-r.1` |
| `yazl` | `3.3.1` (exact) | `3.3.1` |
| `tsx` | `^4.20.0` | `4.22.4` |

### `package-lock.json` diff summary

- Lines before: 4,635
- Lines after: 5,342
- Lines added: 724
- Lines removed: 17

(Diff computed with `diff before after | grep '^[<>]'` then counted by leading marker.)

## Decisions Made
- **Single tsconfig, not a separate `tsconfig.scripts.json`:** Phase 6 scripts benefit from the same strictness profile as `src/`. The plan called this out explicitly; adopted as-is.
- **`tsx` over `node --experimental-strip-types`:** Plan rationale (verbatimModuleSyntax compatibility) accepted without contention.
- **Widen imported tuples in the test file:** The plan instructed Wave 0 to keep the placeholder arrays empty AND keep the DWCA-02 assertions visible (skipped). With `as const satisfies readonly Field[]` the imported type narrows to `readonly []`, which makes the Plan-02 assertions ill-typed under `noUncheckedIndexedAccess` (e.g., `OCCURRENCE_FIELDS[19]`). Casting/widening the imports to `readonly OccurrenceField[]` / `readonly MultimediaField[]` at the top of the test file lets the assertions type-check today; once Plan 02 populates the arrays, the widened view still matches and unskipping the tests requires zero type churn. See Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Widen imported tuples in `fields.test.ts` so skipped DWCA-02 assertions type-check**
- **Found during:** Task 2 (Placeholder fields.ts + skipped fields.test.ts scaffold)
- **Issue:** With `OCCURRENCE_FIELDS` exported as `[] as const satisfies readonly OccurrenceField[]`, the inferred type is the literal `readonly []` tuple. The skipped Plan-02 assertions index that tuple (`OCCURRENCE_FIELDS[19]?.name`), which `tsc` (with `noUncheckedIndexedAccess`) reports as `TS2493: Tuple type 'readonly []' of length '0' has no element at index '19'` and `TS2339: Property 'name' does not exist on type 'never'`. The plan's `<verify>` block requires `npx tsc -p . --noEmit` to exit 0; that fails as written.
- **Fix:** Inside `fields.test.ts` only, alias the raw imports to widened `readonly OccurrenceField[]` / `readonly MultimediaField[]` constants. Production code (`fields.ts`) keeps the tight `as const satisfies` pin, which still gives Plan 02 the strongest available compile-time check when populating the arrays. The widening lives entirely in the test file and a JSDoc comment explains why.
- **Files modified:** `scripts/dwca/fields.test.ts`
- **Verification:** `npx tsc -p . --noEmit` now exits 0 across `src/` and `scripts/`; `npx vitest run scripts/dwca/fields.test.ts` reports 1 passed + 7 skipped in 1 test file (identical runtime behavior to pre-fix).
- **Committed in:** `66dc848` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope creep. The fix is confined to the test file and preserves the plan's intent (keep arrays empty, keep Plan-02 assertions visible/skipped, keep `tsc --noEmit` green). Plan 02 still simply populates `OCCURRENCE_FIELDS` / `MULTIMEDIA_FIELDS` and unskips the tests.

## Issues Encountered
- None. `npm audit` reports 3 pre-existing vulnerabilities (1 moderate, 2 high) in unrelated transitive deps — out of scope per the scope-boundary rule; logged here only for visibility, not fixed.

## Threat Surface Scan

No new network endpoints, auth paths, or trust-boundary changes introduced. Plan-declared supply-chain threats (T-06-01-SC, T-06-01-NPM) mitigated as written: exact pins used (`--save-exact`), `npm update` not invoked, `tsx` accepted as approved per the threat-model disposition. T-06-01-LOG (info disclosure) remains `accept` — no secrets touched.

## Known Stubs

| File | Symbol | Reason | Future plan to resolve |
|---|---|---|---|
| `scripts/dwca/fields.ts` | `OCCURRENCE_FIELDS` | Wave-0 placeholder empty array — populated in Plan 02 | 06-02 |
| `scripts/dwca/fields.ts` | `MULTIMEDIA_FIELDS` | Wave-0 placeholder empty array — populated in Plan 02 | 06-02 |
| `scripts/dwca/build.ts` | (referenced but absent) | `package.json` script `build:dwca` points here; Plan 05 creates the file. `npm run build:dwca` will fail until then — intentional, documented in plan §`<artifacts_produced>`. | 06-05 |

These stubs are intentional and documented in the plan as Wave-0 placeholders. They are tracked here so a verifier or downstream plan can confirm resolution.

## User Setup Required

None — no external service configuration or environment variables introduced by this plan.

## Next Phase Readiness

- `scripts/dwca/*.ts` is type-checked by `tsc -p . --noEmit` (proven green).
- `scripts/dwca/*.test.ts` is auto-discovered by Vitest (no `include` overrides needed; default glob covers it).
- `@duckdb/node-api`, `yazl`, and `tsx` resolve from Node from the project root.
- `npm run build:dwca` resolves syntactically (file missing until Plan 05 is expected; intentional).
- Plan 02 (Wave 1) can begin immediately: populate `OCCURRENCE_FIELDS` (25 entries) and `MULTIMEDIA_FIELDS` (6 entries), then unskip the 7 `test.skip(...)` blocks in `fields.test.ts`.

## Self-Check: PASSED

Files asserted present:
- `scripts/dwca/fields.ts` — FOUND
- `scripts/dwca/fields.test.ts` — FOUND

Commits asserted in branch history:
- `1e265c7` (Task 1, chore) — FOUND
- `66dc848` (Task 2, feat) — FOUND

Verification commands re-run at plan close:
- `npx tsc -p . --noEmit` → exit 0
- `npx vitest run scripts/dwca/fields.test.ts` → 1 passed + 7 skipped, exit 0

---
*Phase: 06-archive-generation*
*Completed: 2026-06-17*
