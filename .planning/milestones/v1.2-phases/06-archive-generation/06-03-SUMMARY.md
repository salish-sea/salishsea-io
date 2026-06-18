---
phase: 06-archive-generation
plan: 03
subsystem: dwca
tags: [dwca, meta-xml, eml, gbif, vitest, typescript, xml-escape]

# Dependency graph
requires:
  - 06-02 (canonical OCCURRENCE_FIELDS / MULTIMEDIA_FIELDS in scripts/dwca/fields.ts)
provides:
  - "scripts/dwca/meta-xml.ts exporting `buildMetaXml(occFields, mmFields) -> string` (pure DwC-A descriptor generator)"
  - "scripts/dwca/eml.ts exporting `buildEml(input) -> string`, type `DatasetsRow` (19-column mirror of dwc.datasets), type `EmlInput`"
  - "35 passing unit tests guarding ordinal alignment, dcterms invariants, GBIF coreid URI, methods two-paragraph invariant, XML escaping, determinism, and parameter routing"
affects:
  - 06-05 (build.ts orchestration imports buildMetaXml + buildEml and writes their outputs into the zip)
  - 06-06 (manual GBIF DwC-A validator run consumes the generated meta.xml + eml.xml)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function XML generation via tagged template literals — no XML builder library, no I/O, no ambient state (no Date.now()); takes its dependencies as parameters so the same arrays / row can be tested in isolation"
    - "Internal `xmlEsc` helper applied to every free-text DB value before interpolation (T-06-03-XML mitigation); tests round-trip all four XML-significant characters"
    - "Ordinal-alignment guard via regex extraction (`<field index=\"(\\d+)\" term=\"([^\"]+)\"/>`) and `toEqual` against `OCCURRENCE_FIELDS.map((f, i) => [String(i), f.termUri])` — drift in either fields.ts or the generator surfaces here, not later in the integration test"

key-files:
  created:
    - "scripts/dwca/meta-xml.ts"
    - "scripts/dwca/meta-xml.test.ts"
    - "scripts/dwca/eml.ts"
    - "scripts/dwca/eml.test.ts"
  modified: []

key-decisions:
  - "Backslash-t / backslash-n escapes are written in the TS source as `\"\\\\t\"` / `\"\\\\n\"` so the runtime output bytes are the literal two-character sequences `\\t` and `\\n` — the GBIF DwC Text Guidelines convention. A negative assertion (`expect(xml).not.toContain('fieldsTerminatedBy=\"\\t\"')` where `\\t` here is an actual tab byte) guards against future 'helpful' double-unescaping."
  - "`DatasetsRow.geographic_coverage`, `temporal_coverage`, and `methods` are typed nullable because the migration's VALUES row sets them to `NULL::text`; eml.ts uses its own internal authored text (E-01 / E-03) regardless of the row value. This keeps the type honest about what the view actually exposes today and leaves room for the migration to populate them later without breaking the generator."
  - "Temporal coverage is plumbed through `EmlInput.temporalCoverage` rather than `DatasetsRow.temporal_coverage`. Rationale: build.ts is the right place to compute `MIN(eventDate)` / `MAX(eventDate)` from `dwc.occurrences`, and threading the value as a separate parameter makes the source of truth obvious in the test fixtures. A dedicated test asserts the routing."
  - "TODO marker for the Acartia cooperative boundary doc URL is committed as a code comment in eml.ts (next to the bbox literals) per the CONTEXT.md `<canonical_refs>` flag; the bbox values themselves are the source of truth and match E-02."
  - "buildMetaXml accepts `readonly OccurrenceField[]` / `readonly MultimediaField[]` — not the concrete tuple types from `fields.ts`. This lets the empty-arrays pure-function test exist (one of the acceptance criteria), and decouples the generator from any future shape evolution of `fields.ts` that keeps the element shape."

patterns-established:
  - "Two-axis test structure for XML generators: structural attribute presence (`.includes(...)` checks) + ordinal alignment (regex extraction + `toEqual` against expected pairs). Cheaper than full DOM parsing and surfaces drift at the element level."
  - "Threat-flagged free-text always passes through `xmlEsc` at the call site; a single hostile-input test (`& < > \"` in title) round-trips all four characters in one assertion."

requirements-completed:
  - DWCA-01
  - DWCA-02

# Metrics
duration: 9min
completed: 2026-06-17
---

# Phase 06 Plan 03: meta.xml + EML Generators Summary

**`buildMetaXml` and `buildEml` are populated, pure, and unit-tested — 35 passing assertions in two files guard ordinal/term alignment with `fields.ts`, the GBIF structural attributes the validator looks for, XML escaping on every free-text DB value, the E-03 two-paragraph methods invariant, and determinism. Plan 05's `build.ts` can now import both and obtain the two XML strings to zip.**

## Performance

- **Duration:** ~9 min
- **Tasks:** 2
- **Files created:** 4 (`scripts/dwca/meta-xml.ts`, `scripts/dwca/meta-xml.test.ts`, `scripts/dwca/eml.ts`, `scripts/dwca/eml.test.ts`)
- **Tests:** 35 passing (15 meta-xml + 20 eml), 0 skipped, 0 failed
- **`npx tsc -p . --noEmit`:** exit 0

## Accomplishments

- **`buildMetaXml(occFields, mmFields) -> string`** generates the full DwC-A descriptor from the `fields.ts` arrays via two `.map()` iterations (one per block). The function is pure: no I/O, no module side-effects, no ambient state. Both `<core>` (Occurrence) and `<extension>` (Simple Multimedia) blocks carry their `rowType`, `encoding`, `fieldsTerminatedBy="\t"`, `linesTerminatedBy="\n"`, `fieldsEnclosedBy=""`, `ignoreHeaderLines="1"` attributes per RESEARCH §T4; the literal `\t`/`\n` two-character escapes are written as `"\\t"` / `"\\n"` in the TS source. `<id index="0"/>` is in core and `<coreid index="0"/>` is in extension. `<archive metadata="eml.xml" ...>` and the three xmlns / xsi attributes are present.
- **`buildEml(input) -> string`** generates the EML 2.1.1 metadata document with all elements RESEARCH §T5 / the GBIF EML profile require: `<title>`, `<creator>`, `<metadataProvider>`, `<pubDate>`, `<language>`, `<abstract>` (`<para>`-wrapped), `<keywordSet>` (four hardcoded keywords + `n/a` thesaurus), `<intellectualRights>` (license URI via `<ulink>` + the per-record license disclosure), `<coverage>` (geographic bbox + description, temporal `<rangeOfDates>`, taxonomic `Cetacea (Order)`), `<contact>` (hardcoded `<givenName>Peter</givenName><surName>Abrahamsen</surName>` per POLICY §6.4 D-18), `<methods>` (two `<para>` blocks reproduced verbatim from RESEARCH §T5).
- **Exported types `DatasetsRow` and `EmlInput`.** `DatasetsRow` mirrors the 19-column `dwc.datasets` view exactly in snake_case alias order. Three columns (`geographic_coverage`, `temporal_coverage`, `methods`) are typed `string | null` because the migration's VALUES literal sets them to NULL today — eml.ts owns the authored content.
- **35 passing tests across 9 `describe` blocks** anchored to the migration's literal mock row, including: a single hostile-input test (`& < > "` in title) that round-trips all four XML-significant characters; a methods-block scan that counts exactly 2 `<para>` tags (T-06-03-METHODS-DRIFT mitigation); a determinism test (two calls byte-identical); a parameter-routing test that proves `EmlInput.temporalCoverage` (not `datasets.temporal_coverage`) drives the `<calendarDate>` values.

## Task Commits

Each task was committed atomically:

1. **Task 1: meta-xml.ts — pure descriptor generator + unit tests** — `6415ec1` (feat)
2. **Task 2: eml.ts — EML 2.1.1 generator + DatasetsRow type + unit tests** — `b0a51c7` (feat)

## Files Modified

- `scripts/dwca/meta-xml.ts` *(created)* — `buildMetaXml(occFields, mmFields)` and supporting JSDoc. Imports only the `OccurrenceField` / `MultimediaField` *types* (not the arrays) from `./fields.ts`.
- `scripts/dwca/meta-xml.test.ts` *(created)* — 15 tests: smoke (XML prolog), field count (= 31), ordinal alignment (both blocks via regex extraction + `toEqual`), dcterms invariants at occurrence indices 19/22 and GBIF coreid at multimedia index 0, structural-attribute presence (archive namespace + `metadata="eml.xml"`, both `rowType` URIs, `<location>` filenames, `<id>`/`<coreid>`, literal `\t`/`\n` escapes), determinism (two calls byte-identical), empty-arrays pure-function behavior.
- `scripts/dwca/eml.ts` *(created)* — `buildEml(input)`, `DatasetsRow`, `EmlInput`, internal `xmlEsc`, and the E-02 geographic description + E-03 two-paragraph methods constants. A TODO comment marks the Acartia cooperative boundary doc URL.
- `scripts/dwca/eml.test.ts` *(created)* — 20 tests in 5 `describe` blocks: required elements (prolog, packageId/system/scope/xml:lang, schemaLocation, title/language/pubDate, creator/metadataProvider/contact, abstract `<para>`-wrapped, keywordSet, intellectualRights with `<ulink>`); coverage (E-02 bbox literals, geographicDescription, temporalCoverage `<rangeOfDates>`, taxonomic Cetacea Order); methods (exactly 2 `<para>`, Google Sign-In in para 1, WASEAK/Acartia in para 2); XML escaping (hostile title round-trips all four characters, NULL columns don't stringify); determinism + parameter routing (pubDate sourcing, temporalCoverage sourcing).

## `xmlEsc` cases tested

The hostile-input test (`describe('buildEml — XML escaping')`) feeds a `DatasetsRow` whose `title` contains all four XML-significant characters and asserts each round-trips to its entity reference:

| Input character | Expected entity ref | Asserted? |
|-----------------|--------------------|-----------|
| `&`             | `&amp;`            | yes       |
| `<`             | `&lt;`             | yes       |
| `>`             | `&gt;`             | yes       |
| `"`             | `&quot;`           | yes       |

The same test asserts the raw substring (`& cetaceans`, `<whales>`) does NOT appear inside `<title>` — ruling out accidental partial escaping. A separate test confirms NULL `geographic_coverage` / `temporal_coverage` / `methods` columns do not stringify as `"null"` in the output (`xmlEsc(null) === ''`).

## E-03 two-paragraph methods — committed wording (traceability)

Both paragraphs reproduced verbatim from RESEARCH §T5 (lines 532..549). The `<methods>` block carries exactly 2 `<para>` tags — asserted by `eml.test.ts`.

**Paragraph 1 (native ingestion):**

> Native observations are submitted directly through the SalishSea.io web application by authenticated contributors using Google Sign-In. Each record includes a species identification, geographic location (WGS84 coordinate pair), observation timestamp (full UTC precision), optional individual count, optional free-text body, and optional photographs. Contributors hold copyright over their observations and photos under CC-BY-NC 4.0 as a condition of the platform's data sharing policy.

**Paragraph 2 (Maplify / WASEAK ingestion):**

> Maplify/Whale Alert records are ingested from the WASEAK API operated by Conserve.IO on the Acartia data cooperative (acartia.io) platform. Records include species identification, geographic location, date (at date precision — the `created_at` timestamp reflects report receipt, not observed sighting time), individual count, source attribution, and optional comments. Sub-source organizations feeding into the Acartia cooperative include Orca Network and Cascadia Research Collective. Records are published under CC-BY 4.0 as asserted by contributors to the Acartia cooperative at registration.

## Decisions Made

- **Literal `\t` / `\n` escapes are written in TS as `"\\t"` / `"\\n"`** so the runtime output bytes match the GBIF DwC Text Guidelines convention. A negative `.not.toContain('fieldsTerminatedBy="\t"')` assertion (where `\t` is an actual tab byte) guards against accidental double-unescaping in a future refactor.
- **`DatasetsRow.geographic_coverage`, `temporal_coverage`, `methods` typed `string | null`** to reflect the migration's literal VALUES tuple, even though eml.ts uses internal authored text for all three regardless of the row value. Keeps the type honest about what the view exposes today.
- **`EmlInput` carries `temporalCoverage` separately from `DatasetsRow.temporal_coverage`.** build.ts (Plan 05) is the right place to compute MIN/MAX eventDate from `dwc.occurrences`; threading the value as its own parameter makes the source obvious in fixtures and a dedicated test asserts the routing.
- **`buildMetaXml` accepts the broad `readonly OccurrenceField[]` / `readonly MultimediaField[]` types** rather than the concrete `as const satisfies …` tuple types from `fields.ts`. This enables the empty-arrays pure-function test (per the plan's acceptance criteria) and decouples the generator from any future shape evolution that preserves the element shape.
- **TODO comment for the Acartia cooperative boundary doc URL** lives next to the bbox literals in eml.ts — the CONTEXT.md `<canonical_refs>` flag asked the planner to add the URL once confirmed; the bbox values themselves are the source of truth and match E-02.

## Deviations from Plan

**None.** Both tasks executed as written; no Rule 1 / 2 / 3 auto-fixes were needed, no Rule 4 checkpoint was triggered. Both tasks landed 1 extra test above the plan's `≥6` and `≥8` minimums (15 vs ≥6 for meta-xml; 20 vs ≥8 for eml) — the extra tests cover the empty-arrays case, the literal-escape negative assertion, and per-paragraph methods substring scans. These extras are below the threshold for being noteworthy as deviations.

## Issues Encountered

None. The `verbatimModuleSyntax` + `erasableSyntaxOnly` tsconfig flags required `import type { OccurrenceField, MultimediaField } from './fields.ts'` in `meta-xml.ts` and the test file (rather than a value import). Caught at the first `tsc --noEmit` run; trivial fix.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced by this plan. The plan's threat register is mitigated:

- **T-06-03-XML** (Injection: XML-significant characters in free text) — mitigated. `xmlEsc` is applied to every interpolated `DatasetsRow` value (title, abstract, license URI, pub_date, language, contact email, organization names, taxonomic_coverage, and the internal geographicDescription / methods constants). The hostile-input test asserts `&`, `<`, `>`, `"` round-trip to entity refs.
- **T-06-03-METHODS-DRIFT** (Tampering: drift from POLICY § text in the methods paragraphs) — mitigated. `eml.test.ts` asserts the `<methods>` block carries exactly 2 `<para>` tags; any one-paragraph collapse or three-paragraph split fails the test. The prose is reproduced verbatim from RESEARCH §T5; a reviewer cross-checks at PR time.
- **T-06-03-NONDET** (Tampering: non-deterministic output) — mitigated. A determinism test asserts two consecutive calls return byte-identical strings. `pub_date` is sourced from `datasets.pub_date` (not `Date.now()`); the `<calendarDate>` values come from `EmlInput.temporalCoverage`. No `Date.now()`, no `Math.random()`, no environment reads.
- **T-06-03-LOG** (Information disclosure: personal email in public archive) — accepted by Phase 4 POLICY §6.4 D-18. eml.ts merely reflects `datasets.contact_email`.

## Known Stubs

None introduced. The TODO marker for the Acartia cooperative boundary doc URL is a documentation pointer, not a functional stub — the bbox literals and geographicDescription prose are the source of truth for the archive.

`scripts/dwca/build.ts` remains a stub from Plan 01 (referenced by `package.json`'s `build:dwca` script but not yet present) — that is Plan 05's responsibility and is out of scope for this plan.

## User Setup Required

None — no external service configuration or environment variables introduced.

## Next Wave Readiness

- Plan 05's `build.ts` can call `buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS)` and `buildEml({datasets, temporalCoverage})` to obtain the two XML strings the zip carries. Both functions are pure; their unit tests run in isolation under vitest.
- `DatasetsRow` is the type contract `build.ts` will use when reading a row from `dwc.datasets` via DuckDB ATTACH; the snake_case field names match the SQL column aliases verbatim.
- `EmlInput.temporalCoverage` is the integration seam where build.ts will plug in the `SELECT MIN(eventDate), MAX(eventDate) FROM dwc.occurrences` result.
- Wave 5's `assertions.ts` runtime DESCRIBE check (still in Plan 03 scope per plan frontmatter but landing in this same wave) cross-validates `fields.ts` against the live Postgres view ordinals — its output ordinals are now also the meta.xml `<field index="N">` ordinals via this generator.

## Self-Check: PASSED

Files asserted present:
- `scripts/dwca/meta-xml.ts` — FOUND
- `scripts/dwca/meta-xml.test.ts` — FOUND
- `scripts/dwca/eml.ts` — FOUND
- `scripts/dwca/eml.test.ts` — FOUND
- `.planning/phases/06-archive-generation/06-03-SUMMARY.md` — FOUND (this file)

Commits asserted in branch history:
- `6415ec1` (Task 1, feat) — FOUND
- `b0a51c7` (Task 2, feat) — FOUND

Verification commands re-run at plan close:
- `npx tsc -p . --noEmit` → exit 0
- `npx vitest run scripts/dwca/meta-xml.test.ts` → 15 passed, 0 skipped, 0 failed, exit 0
- `npx vitest run scripts/dwca/eml.test.ts` → 20 passed, 0 skipped, 0 failed, exit 0
- `grep -c '<para>' scripts/dwca/eml.ts` → 5 (≥ 2, the two methods paragraphs are literally present)
- `npx tsx --eval "...buildMetaXml().match(/<field index=\"/g).length === 31..."` → PASS

---
*Phase: 06-archive-generation*
*Completed: 2026-06-17*
