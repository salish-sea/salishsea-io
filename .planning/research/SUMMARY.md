# Research Summary — v1.3 Providers, Collections & Contributors

**Project:** SalishSea.io
**Milestone:** v1.3 Providers, Collections & Contributors
**Domain:** Biodiversity data aggregation — provenance/attribution graph for a multi-source cetacean occurrence platform publishing to GBIF via DarwinCore Archive
**Researched:** 2026-06-19
**Confidence:** HIGH (all four researchers grounded findings directly in the production schema, migration files, and GBIF/TDWG documentation)

---

## Executive Summary

v1.3 is a data-modeling, backfill, and DwC-view-correction milestone — not a feature or UI milestone. Its purpose is to fix attribution in the existing ~5,968-row DarwinCore Archive export, where today all aggregated records collapse into a single "Whale Alert / Maplify" bucket with incorrect `rightsHolder` values and no `institutionCode`. The fix requires adding three new reference tables (`providers`, `organizations`, `collections`) to the public schema, wiring four FK columns (`provider_id`, `collection_id`, `contributor_id`, `source_url`) onto each of the four source tables, backfilling collection and contributor assignments for existing Maplify records via a human-eyeballed exact-match dictionary, then rebuilding the `dwc.occurrences` view to emit the correct aggregator pattern (`institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, per-collection `datasetName`). No new libraries or stack elements are needed — every capability required exists in the current codebase.

The four researchers converged on a single implementation option for all key design questions. FK columns go directly on each source table (Option a) — established by the existing `public.observations.contributor_id` and cross-schema FK precedents. One collection per external platform for iNat and HappyWhale (not per project). `aggregator_ingest` is dropped from the `collection_kind` enum. `parentCollectionIdentifier` is not relevant. Organizations surface in EML as `associatedParty`, never as `institutionCode`. The URL resolver is ingest-time TypeScript (pure function, ~20 lines), not a DB function. Cross-provider contributor unification is deferred; the single `public.contributors` table accommodates future `contributor_links` without schema surgery this milestone.

The dominant integration risk is the coordinated 26-column change to `dwc.occurrences`. Adding `institutionCode` as a new column requires dropping and recreating both branch views and the UNION view in a single migration, simultaneously updating `scripts/dwca/fields.ts` (the ordinal-stable field list), updating `meta.xml`, and confirming `assertFieldAlignment` passes. Any drift between the SQL and the TS artifact silently corrupts the archive. The SRC-01 export exclusion of iNat/HappyWhale must remain by construction (UNION of exactly two branches), not by a WHERE filter. The Maplify backfill dictionary must be built from a full `SELECT DISTINCT` of bracket tags against prod — not from a sample — before any UPDATE runs, and `comments` must never be modified during backfill.

---

## Key Findings

### Stack: No New Dependencies

v1.3 requires zero new npm packages. All capabilities exist:

- **URL-pattern resolver:** `new URL()` + a switch on `hostname`/`pathname` prefix — ~20 lines of TypeScript. No `path-to-regexp`, no `URLPattern` API, no regex library. Lives in `scripts/ingest/resolve-provider.ts` as a pure function callable from both backfill scripts and future ingest paths.
- **DwC/EML encoding:** extend `scripts/dwca/` in place (`eml.ts`, `meta-xml.ts`, `fields.ts`, `build.ts`). `fast-xml-parser@5.8.0` is already present if EML templating ever grows. The existing `xmlEsc` helper is sufficient.
- **Migrations:** plain SQL via `supabase migrations`. No ORM, no migration library, no `pg_trgm`. Backfill is a VALUES-list CASE mapping inside a migration file — the same pattern used for `dwc.datasets`.
- **Enum pattern:** `CREATE TYPE public.collection_kind AS ENUM (...)` follows the established pattern of `public.sex`, `public.travel_direction`, `happywhale.accuracy`.

See `STACK.md` for full rationale.

### Features: Must-Haves, Differentiators, and Explicit Deferrals

**Table stakes (required for attribution goals):**
- `providers`, `collections`, `organizations` tables with seed data (~4 providers, ~8 org rows, ~15 collections)
- `provider_id`, `collection_id`, `contributor_id`, `source_url` columns on all four source tables (nullable initially; constrain after backfill where appropriate)
- Maplify backfill: bracket-tag + trailing-attribution + `source` code to `collection_id` (human-verified exact-match dictionary, built from full `SELECT DISTINCT` audit of prod)
- `dwc._native_occurrences` updated: `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, `recordedBy=contributor.name`, `datasetName='SalishSea.io — Direct'`
- `dwc._maplify_occurrences` updated: LATERAL CASE replaced by collection JOIN, same aggregator-pattern fields, `datasetName='SalishSea.io — {collection.name}'`
- `meta.xml` updated for the 26th column (`institutionCode`); `fields.ts` updated in lockstep
- EML updated: channel URLs in `methods`/`abstract`; upstream orgs as `associatedParty` (never `institutionCode`)
- SRC-01 export exclusion preserved by construction (UNION of exactly two branches)
- SELECT grants on new reference tables at migration time (prevents silent RLS-zero-row failure)

**Differentiators (P2, add if scope allows):**
- Per-record `datasetName = "SalishSea.io — {collection}"` is a genuine GBIF-supported differentiator — no comparable cetacean aggregator does this; GBIF added per-record `datasetName` search specifically to support this pattern
- `contributor.orcid` nullable column — enables `recordedByID` with ORCID URI for Bionomia linkage for the 28 native contributors; add column now, populate manually as a follow-up
- `source_url` populated on iNat (`inaturalist.observations.uri`) and native (`public.observations.url`) rows
- Collection name visible on occurrence cards (low-cost label, not a full collection page)

**Deferred (future milestone):**
- Cross-provider contributor unification (`jmaughn` iNat = James Maughn native) — `contributor_links` table is the future extension point; single `public.contributors` table is sufficient for v1.3 per-provider model
- Organization/collection detail pages in UI
- `recordedByID` population (depends on `contributor.orcid` being populated)
- SRC-01 reconsideration (iNat/HappyWhale in the archive)

**Anti-features to avoid:**
- `institutionCode` = upstream org name (wrong aggregator pattern; confuses GBIF identity triplet)
- iNat or HappyWhale rows in `dwc.occurrences` (GBIF duplication — GBIF-BLOCKER)
- Fuzzy/alias matching at ingest time (exact-match only; typo variants go in the VALUES dictionary)
- `collectionCode` as an additional DwC field (stable prefixed `occurrenceID` already exists; `collectionCode` adds triplet-confusion noise)
- Per-row `bibliographicCitation` with channel URL (GBIF community explicitly discourages this)
- Auto-creating collections on unknown bracket tags (creates junk rows)

See `FEATURES.md` for the full dependency graph and MVP definition.

### Architecture: Option A (Direct FK Columns) Everywhere

All four researchers converged on the same option for all key design questions.

**FK placement:** Add `provider_id`, `collection_id`, `contributor_id`, `source_url` directly to each source table. Established by `public.observations.contributor_id` (already exists) and cross-schema FK precedent (`maplify.sightings.taxon_id REFERENCES inaturalist.taxa(id)`). Polymorphic provenance tables and per-source join tables are both rejected.

**New tables in `public` schema:**
- `public.providers` (4 seed rows) — how a record reached us; no DwC mapping; internal only
- `public.organizations` (~8 seed rows) — institution backing a collection; surfaces in EML as `associatedParty` only, never as `institutionCode`
- `public.collections` (~15 seed rows) — the observation channel; maps to per-row `datasetName`
- `public.collection_kind` enum: `facebook_group`, `research_dataset`, `acoustic_feed`, `detector`, `direct_app` (`aggregator_ingest` dropped — Maplify is the provider, not a collection kind)

**DwC view rebuild (the main integration risk):**
- Both branch views must be dropped and recreated (`CREATE OR REPLACE VIEW` cannot reorder columns; `institutionCode` inserts mid-list at position 21)
- Drop order: `dwc.occurrences CASCADE` → `dwc._maplify_occurrences` → `dwc._native_occurrences`
- Recreate with 26 columns: `institutionCode` at position 21 (after `rightsHolder`), shifting `datasetName` to 22 and later columns accordingly
- `fields.ts` `OCCURRENCE_FIELDS` updated to 26 entries in the same PR; `assertFieldAlignment` in `build.ts` must pass before merge
- `dynamicProperties.aggregatorChain` updated to use provider + collection names (value change only, no column-count impact)
- LATERAL `dn` cross-join in `_maplify_occurrences` removed; `datasetName` and `rightsHolder` now come from JOINs to `public.collections` and a fixed constant respectively

**URL resolver:** Pure TS function, not a DB function. Results stored as FKs on source rows at ingest/backfill time. Views read pre-resolved FKs; the resolver never runs at view-query time. Resolution order for Maplify rows: `source_url` pattern → leading bracket tag → trailing "Submitted by … Trusted Observer" (collection/org only, never contributor) → `maplify.sightings.source` code → NULL.

**One collection per external platform:** iNaturalist → one "iNaturalist" collection row; HappyWhale → one "HappyWhale" collection row. Per-project granularity adds complexity with no GBIF payoff.

See `ARCHITECTURE.md` for the full component map, dependency-aware build order, and system diagram.

### Critical Pitfalls

**GBIF-BLOCKERS:**

1. **SRC-01 violation — iNat/HappyWhale rows in the export.** The UNION must remain exactly two branches. Never add a third branch. After every migration touching `dwc.*`, assert: `SELECT COUNT(*) FROM dwc.occurrences` must not exceed the sum of native + Maplify row counts (with existing filters). Add this row-count gate to the nightly guard.

2. **`institutionCode`/`rightsHolder`/`datasetName` misuse.** `institutionCode` must be fixed `"SalishSea"` on every row — never the upstream org name. `rightsHolder` must be fixed `"SalishSea.io"` — never the contributor or org name. Add a migration assertion: `SELECT DISTINCT "institutionCode" FROM dwc.occurrences` must return exactly `{'SalishSea'}`.

**DATA-LOSS (before backfill):**

3. **Backfill dictionary must come from a full `SELECT DISTINCT` audit, not a sample.** Run the complete bracket-tag universe query against prod before writing any UPDATE. Post-backfill verification: `SELECT COUNT(*) FROM maplify.sightings WHERE comments ~ '^\[' AND collection_id IS NULL` must return 0.

4. **Trailing "Submitted by … Trusted Observer" is a collection/org signal only — never contributor.** It names a trust tier or org. Using it to set `contributor_id` is a category error and silently corrupts attribution for ~2,740 rows.

5. **`comments` column is immutable during backfill.** Bracket tags and attribution lines are the audit trail. Strip them at view time via `regexp_replace`, never as a backfill UPDATE.

**SCHEMA-BREAK:**

6. **26-column `dwc.occurrences` change requires all six sites in lockstep:** `dwc._native_occurrences`, `dwc._maplify_occurrences`, `dwc.occurrences` (one migration file), `scripts/dwca/fields.ts`, `scripts/dwca/fields.test.ts`, and `meta.xml` output. Must be a single coordinated PR with `npm test` gate before merge.

7. **`collection_id` must be nullable at column-creation time; constrain only after backfill completes.** Sequence: add nullable → backfill → verify zero-NULL counts → constrain in a subsequent migration.

8. **SELECT grants on new reference tables at migration time.** Supabase RLS defaults on new tables can cause the `dwc` views (which JOIN to `collections`) to return zero rows silently. Explicitly `GRANT SELECT` in the table-creation migration.

See `PITFALLS.md` for all 11 pitfalls with recovery strategies and the "Looks Done But Isn't" verification checklist.

---

## Implications for Roadmap

Research converged on a clear, dependency-ordered build sequence. Five phases are natural; Phases 1–2 can begin immediately.

### Phase 1: Reference Table Foundation

**Rationale:** Everything else depends on `providers`, `organizations`, and `collections` existing with seed data. This is the prerequisite for all FK additions and all backfill.

**Delivers:** Three new reference tables; `collection_kind` enum; ~4 provider rows, ~8 org rows, ~15 collection rows; SELECT grants wired at migration time. `aggregator_ingest` absent from the enum by construction.

**Addresses:** Provider/collection/org feature set; `aggregator_ingest` elimination; RLS pitfall prevention.

**Avoids:** Pitfall 10 (RLS/grants must be in the creation migration, not a follow-up).

**Research flag:** Standard patterns — no deeper research needed.

---

### Phase 2: Source Table FK Columns

**Rationale:** FK columns are a prerequisite for backfill (Phase 3) and for the DwC view JOIN (Phase 4). All columns are nullable at creation (Pitfall 6 prevention). Independent across the four source tables; can be one migration or four.

**Delivers:** `provider_id`, `collection_id`, `contributor_id`, `source_url` columns on all four source tables. Index `collection_id` on exported tables at creation time (prevents nightly job slowdown as rows grow).

**Addresses:** Per-sighting FK linkage; `source_url` as first-class column; FK architecture (Option a).

**Avoids:** Pitfall 6 (nullable → backfill → constrain sequence).

**Research flag:** Standard patterns — no research needed.

---

### Phase 3: Backfill and Provider/Collection/Contributor Population

**Rationale:** One-time DML pass filling FKs on existing rows. Cannot run until Phase 1 (seed data) and Phase 2 (FK columns) are complete. Signal-precedence rules must be specified before any SQL is written. Full `SELECT DISTINCT` typo census on prod is mandatory first.

**Delivers:**
- Maplify `collection_id` populated via bracket-tag + trailing-attribution + source-code dictionary
- Maplify `provider_id` mass-assigned (all rows came via Maplify / conserve.io)
- Native `public.observations`: `provider_id`, `collection_id`, `source_url` set (from `o.url`)
- iNat `inaturalist.observations`: `provider_id`, `collection_id`, `source_url` set (from `uri`)
- HappyWhale `happywhale.encounters`: `provider_id`, `collection_id`, `source_url` set (derivable from encounter id)
- URL-pattern resolver TypeScript module (`scripts/ingest/resolve-provider.ts`) — pure function, independently testable

**Addresses:** Maplify collection resolution; cross-provider FK population; URL-pattern registry.

**Avoids:** Pitfall 3 (full `SELECT DISTINCT` audit first), Pitfall 4 (bracket tag wins over trailing attribution; trailing attribution is collection signal only, never contributor), Pitfall 5 (comments immutable), Pitfall 9 (URL resolver exact domain+path-prefix matching, null fallthrough), Pitfall 11 (source code is lowest-priority signal).

**Research flag:** Needs careful design-first — run the full typo audit query before writing code. No new external research; all context is in the exec summary and `PITFALLS.md`.

---

### Phase 4: DwC View Rebuild (26-Column Coordinated Change)

**Rationale:** The milestone's primary external deliverable — the corrected DarwinCore Archive. Depends on collection FKs being populated (Phase 3) so JOINs return meaningful values. Six-site coordinated change; single PR with `npm test` gate.

**Delivers:**
- `dwc._native_occurrences` rebuilt: `institutionCode="SalishSea"` (new col 21), `rightsHolder="SalishSea.io"`, `datasetName='SalishSea.io — Direct'` via collection JOIN
- `dwc._maplify_occurrences` rebuilt: LATERAL `dn` cross-join removed; collection JOIN drives `datasetName`; contributor JOIN drives `recordedBy` (fallback to `usernm`); `dynamicProperties.aggregatorChain` updated
- `dwc.occurrences` UNION ALL of both 26-column branch views
- `fields.ts` updated to 26-entry `OCCURRENCE_FIELDS`; `assertFieldAlignment` passes
- `meta.xml` output updated for the 26th field
- EML updated: channel URLs in abstract/methods; upstream orgs as `associatedParty`
- Row-count assertion gate added to nightly job (SRC-01 guard)

**Addresses:** `institutionCode`, `rightsHolder`, `datasetName`, `recordedBy` corrections; per-collection `datasetName` differentiator; EML `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE` fix.

**Avoids:** Pitfall 1 (SRC-01 by construction; row-count gate), Pitfall 2 (correct aggregator-pattern values; `SELECT DISTINCT "institutionCode"` assertion), Pitfall 8 (coordinated SQL + TS in one PR; `npm test` gate).

**Research flag:** Highest-risk PR of the milestone. No external research needed; `ARCHITECTURE.md` §3 gives the exact drop-and-recreate sequence and column positions.

---

### Phase 5: Verification and Archive Validation

**Rationale:** The "Looks Done But Isn't" checklist from `PITFALLS.md` is extensive enough to warrant a dedicated verification pass before closing the milestone.

**Delivers:**
- All 12 "Looks Done But Isn't" checklist items passing
- Nightly archive regenerated with new schema; GBIF validator re-run
- `SELECT DISTINCT "institutionCode"` = `{'SalishSea'}` only
- `SELECT DISTINCT "rightsHolder"` = `{'SalishSea.io'}` only
- `SELECT DISTINCT "datasetName"` returns ~10+ values, all prefixed `'SalishSea.io — '`
- `dwc.occurrences` row count within bounds (SRC-01 gate passes)
- P2 differentiators (`contributor.orcid` column, collection label on occurrence cards) if scope allows

**Research flag:** No research needed — verification of implemented work.

---

### Phase Ordering Rationale

- Dependency chain is strict: reference tables → FK columns → backfill → DwC view rebuild. No step can be skipped or reordered.
- Backfill is one-time and irreversible for `comments`; design the dictionary first, run once, verify completeness before proceeding to view rebuild.
- DwC view rebuild is the highest-risk PR; it touches both the SQL schema and the TS pipeline in six places; a test gate is non-negotiable.
- EML updates are independent of the occurrence column list and can be developed in parallel with Phases 2–3, merged before the Phase 4 PR.
- URL-pattern resolver can be written and tested independently during Phase 3; it is a pure function with no DB dependency until wired into the backfill scripts.

### Research Flags

Phases needing careful design before execution:
- **Phase 3 (Backfill):** run the full `SELECT DISTINCT` typo census against prod and finalize the signal-precedence rules before writing any SQL.
- **Phase 4 (DwC View Rebuild):** highest-risk PR; treat as a locked coordinated change; verify locally before pushing.

Phases with standard patterns (no deeper research needed):
- **Phase 1 (Reference Tables):** raw SQL migrations + seed inserts + enum creation — established project patterns.
- **Phase 2 (FK Columns):** nullable column additions + index creation — standard migration work.
- **Phase 5 (Verification):** checklist execution against running system.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings grounded in the existing codebase; no new dependencies; unanimous verdict across all four researchers |
| Features | HIGH (DwC-A terms) / MEDIUM (collection granularity) | Attribution field conventions verified against TDWG/GBIF/OBIS documentation; collection granularity inferred from eBird/iNat/HappyWhale patterns — no explicit GBIF policy document found |
| Architecture | HIGH | Grounded directly in migration files, field lists, and existing FK patterns; Option A is the only viable design given the existing schema |
| Pitfalls | HIGH | Grounded in the production schema, the `dwc` migration, `fields.ts`, and the v1.3 executive summary; prod counts are point-in-time |

**Overall confidence:** HIGH

### Gaps to Address During Planning

- **Maplify backfill dictionary completeness:** the exec summary documents known tag variants from a prod sample; the full universe requires a `SELECT DISTINCT` query against production. Run this as the first action in Phase 3 planning.

- **`contributor_id` population on Maplify rows:** the trailing "Submitted by … Trusted Observer" line names an org, not a person. The "Submitted by [Full Name]" variant (a real person name) is noted as a possible signal but not fully characterized in the research. Audit Maplify comments for person-name patterns before assuming contributor backfill is straightforward.

- **`collection_id` constraint strategy post-backfill:** some Maplify rows will permanently have `collection_id = NULL` (empty bracket tags, one-offs). The constraint should probably be left nullable for Maplify permanently rather than hardened. For iNat/HappyWhale, 100% population is achievable immediately.

- **`contributor.orcid` column:** adding it now (nullable) is low-cost; populating it requires manual curation of the 28 native contributors. Whether any have ORCIDs is not verified in the research. Confirm before including in Phase 5 scope.

---

## Sources

### Primary (HIGH confidence — codebase and official specs)

- `supabase/migrations/20260617203900_dwc_schema.sql` — existing 25-column view contract, UNION ALL structure, branch views
- `supabase/migrations/20260204013006_sightings_uses_contributors.sql` — `public.observations.contributor_id` FK, cross-schema FK proof
- `supabase/migrations/20250919034327_fix_maplify_taxon_mapping.sql` — `maplify.sightings.taxon_id REFERENCES inaturalist.taxa(id)` cross-schema FK precedent
- `scripts/dwca/fields.ts` — 25-entry `OCCURRENCE_FIELDS`, F-03 ordinal-stability invariant
- `scripts/dwca/build.ts` — `assertFieldAlignment`, 22-step pipeline
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` — terminology, prod counts, resolution order, SRC-01 scope
- [GBIF Data Quality Requirements — Occurrence Datasets](https://www.gbif.org/data-quality-requirements-occurrences)
- [Darwin Core Quick Reference Guide (TDWG)](https://dwc.tdwg.org/terms/)
- [GBIF Release Notes — per-record datasetName search](https://www.gbif.org/release-notes)
- [TDWG People in Biodiversity Data — recordedByID](https://www.tdwg.org/community/attribution/people/)

### Secondary (MEDIUM confidence — aggregator pattern inference)

- [GBIF — Happywhale North Pacific right whale dataset](https://www.gbif.org/dataset/25da6d17-16b7-42d8-974c-dcae5cf038b1) — per-species/basin publishing pattern; contributor EML listing
- [GBIF Community Forum — iNaturalist author attribution](https://discourse.gbif.org/t/identifying-authors-of-inaturalist-observations-within-gbif-download-data/4258) — `recordedBy` = profile display name
- [GBIF Community Forum — bibliographicCitation usage](https://discourse.gbif.org/t/confused-about-bibliographiccitation-youre-not-alone/3945) — per-row different citations discouraged
- [OBIS Darwin Core Manual](https://manual.obis.org/darwin_core.html) — `institutionCode` as custodian institute acronym
- [eBird on GBIF](https://www.gbif.org/news/82357/ebird-update-pushes-records-in-gbif-over-500-million) — fixed `institutionCode=CLO` aggregator pattern

### Tertiary (LOW confidence — inferred from sparse documentation)

- Facebook group community-channel attribution — no biodiversity standard exists; `collections.kind = 'facebook_group'` is novel; per-platform vs. per-group granularity not explicitly documented in any GBIF policy

---

*Research completed: 2026-06-19*
*Ready for roadmap: yes*
