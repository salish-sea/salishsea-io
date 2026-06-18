---
phase: 06-archive-generation
plan: 02
subsystem: dwca
tags: [dwca, fields, dwc, dcterms, gbif-extension, vitest, typescript]

# Dependency graph
requires:
  - 06-01 (placeholder fields.ts + skipped test scaffold)
provides:
  - "scripts/dwca/fields.ts canonical 25-entry OCCURRENCE_FIELDS array (dcterms pair at indices 19, 22)"
  - "scripts/dwca/fields.ts canonical 6-entry MULTIMEDIA_FIELDS array (GBIF coreid URI at index 0; dcterms 1..5)"
  - "scripts/dwca/fields.test.ts DWCA-02 unit guardrail: 14 passing tests, 0 skipped, including two ordering assertions via toEqual"
affects:
  - 06-03 (consumes OCCURRENCE_FIELDS / MULTIMEDIA_FIELDS for meta.xml field list and assertions.ts runtime DESCRIBE)
  - 06-04 (consumes OCCURRENCE_FIELDS for the DuckDB COPY column list)
  - 06-05 (consumes OCCURRENCE_FIELDS / MULTIMEDIA_FIELDS via build.ts orchestration)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "`as const satisfies readonly T[]` literal-tuple arrays remain the source-of-truth shape; tests assert via toEqual against a sibling literal name list, so any drift in either fields.ts or the test expectations fails CI"
    - "Per-entry term URI carried literally (F-03) — no name → URI helper. Inline comments on the three namespace-divergent entries (occurrence 19, 22; multimedia 0) explain why."

key-files:
  created: []
  modified:
    - "scripts/dwca/fields.ts"
    - "scripts/dwca/fields.test.ts"

key-decisions:
  - "Drop the Plan-01 test-file widening (`const OCCURRENCE_FIELDS: readonly OccurrenceField[] = RAW_OCCURRENCE_FIELDS;`) — once the arrays are populated, the `as const satisfies readonly Field[]` source type is what every production downstream consumer sees, so the tests should observe the same type. `tsc --noEmit` stays green either way; removing the widening makes the test surface honest."
  - "Express the ordering invariant via a sibling `EXPECTED_OCCURRENCE_NAMES` literal-tuple constant + `toEqual([...EXPECTED_OCCURRENCE_NAMES])`. Plan 02 §`<action>` calls for `toEqual` on the literal 25-name list; keeping the expected list as a named constant near the top of the test file makes the canonical name set greppable and reorder-resistant."
  - "Reuse vitest's per-iteration message overload (`expect(predicate, message).toBe(true)`) inside the 'every non-dcterms index uses dwc/terms' loop so a regression points at the failing index/name pair directly, not a generic 'expected true'."

patterns-established:
  - "Field-array invariants encoded as `toEqual` against a literal-tuple name list — one per array. Cheaper to read than a per-index assertion and forces the entire ordering at once."
  - "Inline JSDoc-style annotation in fields.ts on the three namespace-divergent entries (`// dcterms — NOT dwc/terms; per F-03 the URI is carried literally per entry.`) — discourages well-meaning 'normalisation' by a future contributor."

requirements-completed:
  - DWCA-02

# Metrics
duration: 6min
completed: 2026-06-17
---

# Phase 06 Plan 02: Canonical Field Arrays + DWCA-02 Unit Guardrail Summary

**`OCCURRENCE_FIELDS` (25) and `MULTIMEDIA_FIELDS` (6) are populated with their canonical name → term-URI mappings, and the DWCA-02 unit surface in `fields.test.ts` is now a live 14-test guardrail (0 skipped, 0 failed). The Wave-1 source of truth for column order and term URIs is in place.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 2
- **Files modified:** 2 (`scripts/dwca/fields.ts`, `scripts/dwca/fields.test.ts`)
- **Tests:** 14 passing, 0 skipped, 0 failed

## Accomplishments

- **`OCCURRENCE_FIELDS` populated with 25 entries** in column-order parity with `dwc._native_occurrences` in `supabase/migrations/20260617203900_dwc_schema.sql`. Three namespace-divergent entries are explicitly annotated with inline comments per F-03:
  - index 19 `rightsHolder` → `http://purl.org/dc/terms/rightsHolder` (Dublin Core, not Darwin Core)
  - index 22 `license` → `http://purl.org/dc/terms/license` (Dublin Core, not Darwin Core)
- **`MULTIMEDIA_FIELDS` populated with 6 entries** in column-order parity with `dwc.multimedia` in the same migration:
  - index 0 `coreId` → `http://rs.gbif.org/terms/1.0/coreid` (GBIF Simple Multimedia extension, not dwc/terms and not dcterms)
  - indices 1..5 → `http://purl.org/dc/terms/{type,identifier,license,rightsHolder,creator}` (Dublin Core)
- **`fields.test.ts` rewritten** to unskip all 7 of Plan 01's DWCA-02 `test.skip(...)` placeholders and add three new structural tests (occurrence ordering, multimedia ordering, dcterms invariant). Net result: 14 tests, 0 skipped, 0 failed.
- **Cross-referenced every name** against the migration's quoted-identifier aliases — every one of the 25 occurrence and 6 multimedia names appears verbatim as a quoted identifier in the migration, confirming column-order parity by name (the ordinal-level parity is enforced by Plan 03's runtime DESCRIBE).

## Task Commits

Each task was committed atomically:

1. **Task 1: Populate OCCURRENCE_FIELDS and MULTIMEDIA_FIELDS** — `d917777` (feat)
2. **Task 2: Unskip and complete fields.test.ts DWCA-02 assertions** — `07811fa` (test)

## Files Modified

- `scripts/dwca/fields.ts` *(modified)* — placeholder empty arrays replaced with the 25-entry `OCCURRENCE_FIELDS` and 6-entry `MULTIMEDIA_FIELDS`. JSDoc header expanded to call out the three namespace-divergent indices. Each divergent entry carries a single-line inline comment so a future editor doesn't "normalise" it.
- `scripts/dwca/fields.test.ts` *(modified)* — 7 `test.skip(...)` blocks unskipped + 3 new tests added (one each for: occurrence ordering by `toEqual`, multimedia ordering by `toEqual`, multimedia name-uniqueness). Plan 01's widening cast removed; the tests now observe the same populated literal-tuple type that downstream consumers will see. Total: 14 passing tests.

## Canonical 25-entry OCCURRENCE_FIELDS table

| idx | name | termUri | namespace |
|---:|---|---|---|
| 0 | occurrenceID | http://rs.tdwg.org/dwc/terms/occurrenceID | dwc/terms |
| 1 | basisOfRecord | http://rs.tdwg.org/dwc/terms/basisOfRecord | dwc/terms |
| 2 | eventDate | http://rs.tdwg.org/dwc/terms/eventDate | dwc/terms |
| 3 | scientificName | http://rs.tdwg.org/dwc/terms/scientificName | dwc/terms |
| 4 | taxonRank | http://rs.tdwg.org/dwc/terms/taxonRank | dwc/terms |
| 5 | kingdom | http://rs.tdwg.org/dwc/terms/kingdom | dwc/terms |
| 6 | phylum | http://rs.tdwg.org/dwc/terms/phylum | dwc/terms |
| 7 | class | http://rs.tdwg.org/dwc/terms/class | dwc/terms |
| 8 | order | http://rs.tdwg.org/dwc/terms/order | dwc/terms |
| 9 | family | http://rs.tdwg.org/dwc/terms/family | dwc/terms |
| 10 | genus | http://rs.tdwg.org/dwc/terms/genus | dwc/terms |
| 11 | decimalLatitude | http://rs.tdwg.org/dwc/terms/decimalLatitude | dwc/terms |
| 12 | decimalLongitude | http://rs.tdwg.org/dwc/terms/decimalLongitude | dwc/terms |
| 13 | geodeticDatum | http://rs.tdwg.org/dwc/terms/geodeticDatum | dwc/terms |
| 14 | coordinateUncertaintyInMeters | http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters | dwc/terms |
| 15 | individualCount | http://rs.tdwg.org/dwc/terms/individualCount | dwc/terms |
| 16 | occurrenceStatus | http://rs.tdwg.org/dwc/terms/occurrenceStatus | dwc/terms |
| 17 | occurrenceRemarks | http://rs.tdwg.org/dwc/terms/occurrenceRemarks | dwc/terms |
| 18 | recordedBy | http://rs.tdwg.org/dwc/terms/recordedBy | dwc/terms |
| **19** | **rightsHolder** | **http://purl.org/dc/terms/rightsHolder** | **dcterms** |
| 20 | datasetName | http://rs.tdwg.org/dwc/terms/datasetName | dwc/terms |
| 21 | datasetID | http://rs.tdwg.org/dwc/terms/datasetID | dwc/terms |
| **22** | **license** | **http://purl.org/dc/terms/license** | **dcterms** |
| 23 | dynamicProperties | http://rs.tdwg.org/dwc/terms/dynamicProperties | dwc/terms |
| 24 | informationWithheld | http://rs.tdwg.org/dwc/terms/informationWithheld | dwc/terms |

## Canonical 6-entry MULTIMEDIA_FIELDS table

| idx | name | termUri | namespace |
|---:|---|---|---|
| **0** | **coreId** | **http://rs.gbif.org/terms/1.0/coreid** | **GBIF Simple Multimedia extension** |
| 1 | type | http://purl.org/dc/terms/type | dcterms |
| 2 | identifier | http://purl.org/dc/terms/identifier | dcterms |
| 3 | license | http://purl.org/dc/terms/license | dcterms |
| 4 | rightsHolder | http://purl.org/dc/terms/rightsHolder | dcterms |
| 5 | creator | http://purl.org/dc/terms/creator | dcterms |

## Cross-validation against migration (DWCA-02 grep proof)

Every name from both arrays appears as a quoted identifier inside the relevant view body in `supabase/migrations/20260617203900_dwc_schema.sql`:

- `dwc._native_occurrences` (lines 219..305) aliases all 25 occurrence names verbatim (`"occurrenceID"`, `"basisOfRecord"`, …, `"informationWithheld"`).
- `dwc.multimedia` (lines 663..697) aliases all 6 multimedia names verbatim (`"coreId"`, `"type"`, `"identifier"`, `"license"`, `"rightsHolder"`, `"creator"`).
- The reserved SQL word `order` is intentionally re-quoted as `"order"` in the SELECT alias (sourced from the `tc.order_` helper-view column) — matched on the TS side as `'order'` (no underscore). Plan called this out in §Task 1; no anomaly to flag.

## Cross-validation against RESEARCH §T4

- The two occurrence dcterms exceptions (19 `rightsHolder`, 22 `license`) match RESEARCH §T4's authoritative URI per ordinal.
- The multimedia GBIF coreid extension URI at index 0 matches RESEARCH §T4's multimedia table.

No anomalies surfaced during cross-validation. All 31 (25 + 6) name → URI mappings landed exactly as planned.

## Decisions Made

- **Drop the test-file widening cast from Plan 01.** Plan 01 widened the imports inside `fields.test.ts` (`const OCCURRENCE_FIELDS: readonly OccurrenceField[] = RAW_OCCURRENCE_FIELDS;`) so the skipped Plan-02 assertions could type-check against the empty placeholder. Now that the arrays are populated, the `as const satisfies readonly Field[]` source type is the same shape every downstream production consumer will observe — there is no benefit to having the tests look at a widened view. Removing the cast makes the test surface a faithful witness of what `meta-xml.ts` and `assertions.ts` will see, and `tsc --noEmit` stays green.
- **Express ordering invariants via `toEqual` on a sibling literal-tuple constant.** The plan called for `toEqual` against the canonical name list (one per array). Defining `EXPECTED_OCCURRENCE_NAMES` and `EXPECTED_MULTIMEDIA_NAMES` as named constants near the top of the test file (rather than inline) makes the canonical name set greppable, makes review diffs against a future fields.ts edit trivial, and gives the same drift-resistance the plan asked for.
- **Per-iteration failure messages on the dwc/terms loop.** The 'every non-dcterms index uses dwc/terms' assertion uses vitest's `expect(predicate, message).toBe(true)` overload so a regression on, say, index 12 will report `index 12 (decimalLongitude) should use dwc/terms but is "..."` instead of a generic `expected false to be true`. This is a tiny ergonomics win for the next maintainer.

## Deviations from Plan

**None.** Both tasks executed exactly as written. No Rule 1/2/3 auto-fixes were needed; no Rule 4 (architectural) checkpoint was triggered. The verification script in Task 2's `<verify><automated>` block contains a regex that matches `1 passed` (from vitest's `Test Files  1 passed (1)` line) before reaching the `Tests  14 passed (14)` line, which makes the inline assertion script fail despite all 14 tests actually passing. This is a verification-script ambiguity, not a plan deviation or a failure of the code under test — confirmed by re-running the count check with a more specific regex that matches `Tests\s+(\d+)\s+passed`. All `<acceptance_criteria>` from Task 2 are satisfied:

- `npx vitest run scripts/dwca/fields.test.ts` exits 0.
- 14 passing tests, 0 skipped.
- Two ordering tests compare via `toEqual` against the literal expected name list.
- Tests import only `vitest` and `./fields.ts`.
- `noUnusedLocals` / `noUnusedParameters` strict checks pass (`tsc --noEmit` green; no leftover Plan-01 widening imports).

## Issues Encountered

- **Task 2 verification script regex ambiguity** (already discussed under Deviations). Not a code or plan issue; the underlying test run is green. Logged here for the next plan author who may want to write the count assertion as `Tests\s+(\d+)\s+passed\s+\((\d+)\)` rather than `(\d+) passed`.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced by this plan. The plan's threat register is mitigated:

- **T-06-02-DRIFT** (Tampering: accidental rename / reorder by a future editor) — mitigated. The two `toEqual` ordering tests against the literal canonical name lists make any reorder a CI failure.
- **T-06-02-URI** (Tampering: dcterms / GBIF URI typo at indices 19, 22, or multimedia 0) — mitigated. Tests assert the literal URI string at the three sentinel indices; the `startsWith` loop catches accidental drift to the dwc/terms base on the dcterms pair.
- **T-06-02-XML** (Injection via unescaped URIs) — accepted per the plan. URIs come from constant TS source; Plan 03's meta-xml.ts will still XML-escape them for defense in depth.

## Known Stubs

None introduced or remaining from this plan. The Wave-0 placeholder stubs from Plan 01 (`OCCURRENCE_FIELDS` and `MULTIMEDIA_FIELDS` empty arrays) are now resolved.

`scripts/dwca/build.ts` remains a stub from Plan 01 (referenced by `package.json`'s `build:dwca` script but not yet present) — that is Plan 05's responsibility and is out of scope for this plan.

## User Setup Required

None — no external service configuration or environment variables introduced.

## Next Wave Readiness

- `OCCURRENCE_FIELDS` and `MULTIMEDIA_FIELDS` are populated, frozen, and statically typed — Plan 03 can import them directly to build `meta.xml` and the runtime `assertions.ts` DESCRIBE check against the live `dwc._native_occurrences` / `dwc.multimedia` views.
- `OCCURRENCE_FIELDS.map(f => f.name)` is also the canonical column list for Plan 04's DuckDB `COPY (SELECT ...)` projection.
- DWCA-02's TS-side guardrail (this plan) and Plan 03's runtime guardrail (next wave) form the defense-in-depth pair: drift in either direction surfaces immediately as a CI failure or a build-time assertion failure.

## Self-Check: PASSED

Files asserted present:
- `scripts/dwca/fields.ts` — FOUND
- `scripts/dwca/fields.test.ts` — FOUND
- `.planning/phases/06-archive-generation/06-02-SUMMARY.md` — FOUND (this file)

Commits asserted in branch history:
- `d917777` (Task 1, feat) — FOUND
- `07811fa` (Task 2, test) — FOUND

Verification commands re-run at plan close:
- `npx tsc -p . --noEmit` → exit 0
- `npx vitest run scripts/dwca/fields.test.ts` → 14 passed, 0 skipped, 0 failed, exit 0
- `grep -c '"occurrenceID"' supabase/migrations/20260617203900_dwc_schema.sql` ≥ 1 — confirmed.

---
*Phase: 06-archive-generation*
*Completed: 2026-06-17*
