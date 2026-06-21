# Phase 12: DwC View Rebuild - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Rebuild the three `dwc` occurrence views — `dwc._native_occurrences`,
`dwc._maplify_occurrences`, and `dwc.occurrences` (their UNION) — to emit **26
columns** (adding `institutionCode`) with **aggregator-pattern attribution**:
`institutionCode='SalishSea'`, `rightsHolder='SalishSea.io'`, and per-collection
`datasetName`, reading the FKs Phase 11 populated (`collection_id`,
`contributor_id`). Keep the field contract in lockstep across `scripts/dwca/fields.ts`
(25→26), `scripts/dwca/fields.test.ts`, `meta.xml` output, and the EML builder
(add `<associatedParty>`), and tighten the nightly row-count guard. SRC-01
exclusion of iNat/HappyWhale is preserved **by construction** (UNION of exactly
two branches), not by a WHERE filter. Single PR, `npm test` green before merge.

**In scope:**
- 26-column rebuild of the native + Maplify branch views + their UNION, with the
  constant-attribution flip (institutionCode / rightsHolder) and per-collection
  `datasetName` via FK joins.
- `fields.ts` (add `institutionCode`, 25→26) + `fields.test.ts` parity assertions;
  `meta.xml` 26-field ordinal output; EML `<associatedParty>` additions (ATTR-04).
- Maplify export `trusted = TRUE` filter; Whale Alert Global `datasetName` fallback;
  view-time `recordedBy` extraction from `comments`.
- Nightly row-count guard updated to the trusted-only Maplify baseline.

**Out of scope (deferred — see `<deferred>`):**
- GBIF DwC-A re-validation + full "Looks Done But Isn't" checklist (Phase 13, ATTR-05).
- Cross-provider `contributor_id` FK unification for Maplify (`contributor_links`).
- Purging untrusted rows from `maplify.sightings` at ingest (export-only exclusion here).

**Requirements:** ATTR-01, ATTR-02, ATTR-03, ATTR-04 (ATTR-05 is Phase 13).

</domain>

<decisions>
## Implementation Decisions

### Attribution constants (ATTR-01) — carried forward from v1.3 roadmap, locked
- **D-01 [carry/locked]:** `institutionCode='SalishSea'` and `rightsHolder='SalishSea.io'`
  are constants on **every** exported row (both branches). `institutionCode` is the
  **new 26th column** (the current views/`fields.ts` have 25, no `institutionCode`).
  Upstream org credit goes to EML `associatedParty` (D-09), never `institutionCode`.

### Maplify `recordedBy` (ATTR-01 / roadmap SC#3) — resolving the Phase 11 contradiction
- **D-02:** Maplify `contributor_id` is **NULL by Phase 11 lock** (D-13/D-14 there), so
  roadmap SC#3's "recordedBy via FK join" is drift — there is no contributor FK to join.
  Decision: **extract `recordedBy` at view-time as a STRING** (regex over `s.comments`)
  pulling the parenthetical observer name in the headline segment — e.g.
  `[Orca Network] Humpback southbound (Michelle Goll)…` → `recordedBy = 'Michelle Goll'`.
  When no parenthetical name is present (e.g. `…Submitted by a Whale Alert Global
  Trusted Observer Via App`), `recordedBy = NULL`. This is a **string**, NOT a
  `contributor_id` FK, so Phase 11's `contributor_id = NULL` lock is untouched.
- **D-03 [RESEARCH TASK — mandatory before regex is finalized]:** Census the
  parenthetical contents of prod `maplify.sightings.comments` (read-only, committed
  artifact, same discipline as Phase 11's bracket-tag census) BEFORE writing the
  extraction regex. Parens sometimes hold non-names (counts, travel direction); the
  regex must target the name-after-bracket-tag pattern and NULL-out the rest so we
  never write garbage into `recordedBy`.

### Maplify `datasetName` + trusted filter (ATTR-02 / roadmap SC#3, SC#5)
- **D-04:** `datasetName = 'SalishSea.io — ' || collection.name`, joined via the
  Phase-11-resolved `collection_id` FK (bracket tag → trailing attribution → source
  code precedence already implemented in `maplify.resolve_collection`). Native branch
  resolves to the `salishsea-direct` collection → `'SalishSea.io — SalishSea.io Direct'`.
- **D-05:** **Trusted filter lives in the EXPORT VIEW only** — add `AND s.trusted` to
  the `dwc._maplify_occurrences` WHERE clause. Untrusted (no-comments) rows stay in
  `maplify.sightings` (still available to the app/UI) but never reach the archive.
  Deliberately NOT an ingest purge (would reopen deployed Phase 11 ingest functions and
  drop rows the app may use). The SC#5 row-count baseline and the nightly guard both
  tighten to **trusted-only** Maplify.
- **D-06:** **Whale Alert Global fallback** for the rare trusted-but-`collection_id IS
  NULL` row: view-time `COALESCE(collection.name, 'Whale Alert (Global)')` so SC#3's
  "all `datasetName` prefixed `SalishSea.io — `" holds. Implemented as a **view-time
  COALESCE** (no data change / no Phase-11-style backfill — Phase 11 is deployed).
  Note: "Cascadia Whale Alert" is the **provider/"via" path** (→ `provider_id` →
  `dynamicProperties.aggregatorSource`), NOT a collection — it must not become a
  `datasetName`. (This supersedes an earlier discussion answer.)

### EML `associatedParty` (ATTR-04)
- **D-07:** Add structured `<associatedParty>` elements to the EML for upstream
  organizations (today they appear only as hardcoded prose in the abstract at
  `scripts/dwca/eml.ts:140`). Each carries `organizationName` (+ `onlineUrl` from
  `public.organizations.url`) and `<role>`.
- **D-08:** Credit **only organizations actually represented in the exported archive**
  — distinct `organization_id` across the collections that have exported rows
  (data-driven), NOT all 5 seeded orgs. Avoids crediting orgs with zero in-scope rows
  (e.g. MBARI/Orcasound if absent from the Salish Sea export). Implies a query/view at
  gen time (e.g. a `dwc.associated_parties`-style view, planner's call).
- **D-09:** `associatedParty` role = **`contentProvider`** (standard GBIF/EML role for
  orgs feeding an aggregated dataset; keeps the aggregator/source distinction clear vs
  SalishSea.io's `originator`/creator role).

### Field-list / meta.xml / UNION lockstep (ATTR-05 prep, locked by v1.3 roadmap)
- **D-10 [carry/locked]:** 26-column coordinated change is a **single PR** with
  `npm test` (incl. `fields.test.ts`) green before merge. `OCCURRENCE_FIELDS.length === 26`,
  `assertFieldAlignment` confirms view column order == TS array order, `meta.xml`
  declares 26 fields in correct ordinal order. Reordering an entry without the matching
  migration edit silently corrupts the archive — the test gate is the guardrail.
- **D-11 [carry/locked]:** SRC-01 (iNat/HappyWhale exclusion) preserved **by
  construction** — `dwc.occurrences` is the UNION of exactly the two branches, never a
  WHERE filter. The nightly row-count gate is the runtime guard.

### Claude's Discretion (defaulted — datasetName/ID shape area deselected)
- `datasetID` stays a **single constant URI** (not per-collection) — only `datasetName`
  is per-collection this milestone.
- Archive version string bumps **v1.2 → v1.3** across `datasetName`/`datasetID`/EML
  `<title>` (the EML `<title>` v1.3 reflection is verified in Phase 13 SC#4).
- `datasetName` uses `collection.name` verbatim; the seeded `"Whale Alert (Global)"`
  carries parens — planner (or a follow-up) may normalize the public display string.
- `dwc.datasets` stays effectively single-row for dataset-level EML metadata; the
  per-org `associatedParty` list is driven separately (D-08).
- Exact migration split, regex form, and whether the row-count gate is an in-migration
  check vs a `supabase/snippets/12_*` assertion — follow Phase 9/10/11 precedent.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone model & requirements (authoritative)
- `.planning/ROADMAP.md` § "Phase 12: DwC View Rebuild" — goal + 5 success criteria.
  **Note the SC#3 "recordedBy via FK join" drift resolved in D-02** (Maplify
  contributor_id is NULL; recordedBy is a view-time string, not an FK).
- `.planning/REQUIREMENTS.md` — locked **ATTR-01/02/03/04** (this phase); ATTR-05 (Phase 13).
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` — §"Net export change" table (lines ~148-158):
  the before/after attribution model for Maplify (per-collection datasetName,
  institutionCode/rightsHolder constants) and native (rightsHolder person→SalishSea.io).

### Prior-phase context this phase builds on
- `.planning/phases/11-resolution-backfill/11-CONTEXT.md` — the FKs this phase reads:
  Maplify `collection_id` (resolved via `maplify.resolve_collection`), `provider_id`,
  iNat `contributor_id`. **D-12/D-13/D-14 there lock `comments` immutable and Maplify
  `contributor_id` NULL** — D-02 here works within that (string extraction, no FK).
- `.planning/phases/10-source-table-fk-columns/10-CONTEXT.md` — FK columns + DEFAULTs.
- `.planning/phases/09-reference-table-foundation/09-CONTEXT.md` — `public.collections` /
  `public.organizations` schema, slugs, the 5 seeded orgs, acronym-stub collections.

### Schema / code this phase reads & alters (verify before writing SQL/TS)
- `supabase/migrations/20260617203900_dwc_schema.sql` — the **current 25-column**
  `dwc._native_occurrences` (JOINs `public.contributors`, `dwc.taxa_classification`),
  `dwc._maplify_occurrences` (the `s.source` 3-way CASE this phase REPLACES with FK
  joins; current WHERE = `NOT is_test AND number_sighted BETWEEN 1 AND 1000 AND source
  != 'rwsas'` — D-05 adds `AND s.trusted`), `dwc.occurrences` UNION, `dwc.datasets`,
  `dwc.multimedia`.
- `supabase/migrations/20260619184037_reference_tables.sql` — `public.organizations`
  (5 seeded: orca-network/cascadia/tmmc/mbari/orcasound, each name+url+rights_holder_text)
  and `public.collections` (named + acronym stubs) — the JOIN targets for D-04/D-08.
- `supabase/migrations/20260620000100_resolution_backfill.sql` +
  `20260620000000_resolution_schema.sql` — Phase 11 `collection_id` backfill +
  `maplify.resolve_collection` / `maplify.collection_rule` (the precedence D-04 reads).
- `supabase/migrations/20250903172708_initial_schema.sql:201` — `maplify.sightings`
  columns: `comments varchar(2000)`, `trusted boolean NOT NULL`, `usernm` (UI client,
  NOT the observer — do not use for recordedBy), `source`.
- `scripts/dwca/fields.ts` — the 25-entry `OCCURRENCE_FIELDS` (add `institutionCode`,
  pick correct ordinal + `termUri http://rs.tdwg.org/dwc/terms/institutionCode`) and
  `MULTIMEDIA_FIELDS`. F-03: URIs are carried literally per entry.
- `scripts/dwca/fields.test.ts` — `OCCURRENCE_FIELDS.length` + `assertFieldAlignment`
  (bump to 26, keep view↔array↔meta.xml parity).
- `scripts/dwca/meta-xml.ts` (+ `.test.ts`) — emits the 26-field ordinal `meta.xml`.
- `scripts/dwca/eml.ts` (+ `.test.ts`) — `buildEml` / `DatasetsRow` / `EmlInput`; add
  `<associatedParty>` (D-07/08/09); the hardcoded org prose at line ~140 to reconcile.
- `scripts/dwca/guard.ts` (+ `.test.ts`) — the nightly row-count gate; update the
  Maplify baseline to **trusted-only** (D-05).
- `scripts/dwca/build.ts`, `assertions.ts`, `verify-publish.ts` — archive assembly +
  runtime parity assertions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 11 `collection_id` / `provider_id` FKs** on `maplify.sightings` (and
  `salishsea-direct` default on native) — the view JOINs read these directly; no
  parsing in the view except the D-02 `recordedBy` extraction.
- **`maplify.resolve_collection` + `maplify.collection_rule`** — already encode the
  bracket→attribution→source precedence; the view does NOT re-resolve collections.
- **`public.organizations` (name/url/rights_holder_text)** — direct source for the
  EML `associatedParty` elements (D-07/08).
- **`assertFieldAlignment` (`assertions.ts`/`fields.test.ts`)** — the static
  view↔array↔meta.xml parity guard; extend, don't replace, for the 26th column.
- **`dwc.datasets` view-over-VALUES** — precedent for a small `dwc.associated_parties`
  view if the planner chooses the data-driven org list as a view.

### Established Patterns
- `dwc.occurrences` is a bare `SELECT * UNION ALL` of the two branches — Postgres
  enforces 26-column/type parity at `CREATE VIEW` time, so branch drift fails the
  migration loudly (the SRC-01-by-construction guarantee, D-11).
- Every output column in the branch views carries an explicit `::text`/type cast for
  UNION-ALL discipline — the new `institutionCode` and any new expressions must too.
- Assertion-snippet pattern (`supabase/snippets/05_*`, `09_*`, `10_*`, `11_*`) — reuse
  for the SC#1–SC#5 smoke checks and the row-count gate.

### Integration Points
- The rebuilt `dwc.occurrences` is read offline by the Phase 7 nightly job (DuckDB
  ATTACH + COPY) → `occurrence.txt`; `dwc.datasets` + `dwc.organizations` feed the EML
  builder. Phase 13 re-validates the regenerated archive against the GBIF validator.

</code_context>

<specifics>
## Specific Ideas

- Worked example of the Maplify `comments` model (drives D-02/D-04/D-05/D-06):
  - `[Orca Network] Humpback southbound (Michelle Goll)<br><br>Submitted by a Cascadia
    Trusted Observer Via Webmap` → collection = **Orca Network**, recordedBy =
    **Michelle Goll**, via/provider = **Cascadia Whale Alert** (→ aggregatorSource).
  - `…<br><br>Submitted by a Whale Alert Global Trusted Observer Via App` → collection
    = **Whale Alert Global**, recordedBy = **NULL**.
  - No `comments` ⇒ `trusted = FALSE` ⇒ **not exported** (D-05). A trusted row that
    somehow lacks comments ⇒ fallback collection **Whale Alert Global** (D-06).
- `institutionCode` `termUri` = `http://rs.tdwg.org/dwc/terms/institutionCode` (Darwin
  Core namespace, not dcterms).

</specifics>

<deferred>
## Deferred Ideas

- **Harder `recordedBy` extraction** for Maplify comment shapes beyond the
  `(Name)`-after-bracket-tag pattern — and eventually minting/linking real
  `contributor_id` FKs for Maplify (cross-provider unification via a future
  `contributor_links` table; Phase 11 already deferred this).
- **Purging untrusted rows at ingest** — this phase excludes them from the export view
  only; a true ingest-level purge is a separate, riskier change.
- **Normalizing public collection display names** (e.g. `"Whale Alert (Global)"` →
  `"Whale Alert Global"`) so `datasetName` reads cleanly in GBIF.
- **GBIF DwC-A re-validation + "Looks Done But Isn't" checklist** — Phase 13 (ATTR-05).

</deferred>

---

*Phase: 12-dwc-view-rebuild*
*Context gathered: 2026-06-21*
