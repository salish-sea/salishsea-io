# Phase 5: DB Projection (`dwc` schema) - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase creates a new read-only `dwc` Postgres schema that encodes Phase 4's `04-POLICY.md` as auditable SQL. Output: `dwc.occurrences` (DwC-aligned rows for native + Maplify/Whale Alert sources) and `dwc.datasets` (single-row dataset reification per D-15/D-16). Source: `public.sightings`, `public.contributors`, `public.sighting_photos` (native) + `maplify.sightings` (third-party) + `inaturalist.taxa` (taxonomy backbone). **Never** sourced from the UI-shaped `public.occurrences` matview.

This is **SQL only** — new migration in `supabase/migrations/`, no app-runtime changes, no app-code mapping, no new infrastructure. The downstream consumer is the Phase 7 nightly job that DuckDB-ATTACHes Postgres and `COPY`s `dwc.occurrences` to CSV + GeoParquet.

Requirements covered: ALIGN-01..ALIGN-06.

</domain>

<decisions>
## Implementation Decisions

### Materialization of `dwc.occurrences` (M-01, M-02)

- **M-01:** `dwc.occurrences` is a **plain view**, not a materialized view. The nightly job (Phase 7) executes the underlying query once per day via DuckDB `ATTACH` + `COPY`, streaming straight to Parquet/CSV. No refresh step, no staleness window, no extra storage. `public.occurrences` is a matview — that precedent is for runtime-read workloads (UI), which is not Phase 5's consumer.
- **M-02:** The view is composed of **two intermediate per-source views** UNION ALL'd:
  - `dwc._native_occurrences` — projects `public.sightings` (joined to `public.contributors`, `public.sighting_photos`, taxonomy) per the §3.1 gap table.
  - `dwc._maplify_occurrences` — projects `maplify.sightings` per the §3.2 gap table.
  - `dwc.occurrences` = `SELECT * FROM dwc._native_occurrences UNION ALL SELECT * FROM dwc._maplify_occurrences`.

  Rationale: each branch is independently testable (`SELECT * FROM dwc._maplify_occurrences LIMIT 5`), the per-source D-03 drop filter slots cleanly into the Maplify branch's `WHERE` clause, and the two branches have genuinely different gap mappings — keeping them visually separate keeps the policy-to-SQL correspondence legible.

### `dwc.datasets` form (M-03, M-04 — closes D-15)

- **M-03:** `dwc.datasets` is a **view over a VALUES list** declared inline in a migration. Dataset metadata is source code — every edit is a migration, version-controlled and reviewable, no separate seed step, survives `supabase db reset` without ceremony. One row in v1.2 per D-16; adding a future constituent row is a one-line migration. (Closes POLICY §6.1's explicit "Phase 5 picks one with a written rationale" delegation.)
- **M-04:** `contact_email` is **committed in the migration** as a real address. `supabase/migrations/` is application code, not `.planning/`, and the same address is published in EML to the world; redacting it from git would be theater. Use `rainhead@gmail.com`.

### Taxonomy hierarchy walk (M-05 — closes ALIGN-03)

- **M-05:** Introduce a **helper view `dwc.taxa_classification`** with one row per `inaturalist.taxa.id`, columns `taxon_id`, `taxon_rank`, `kingdom`, `phylum`, `class`, `order_`, `family`, `genus`, `scientific_name`. Built with `WITH RECURSIVE` walking `parent_id`. Both `dwc._native_occurrences` and `dwc._maplify_occurrences` JOIN it on `taxon_id`.

  Rationale: the recursive walk lives in one inspectable place (`SELECT * FROM dwc.taxa_classification WHERE genus = 'Orcinus'`), the higher-rank-only logic has a single test surface, and any future change to the rank set propagates without touching both branch views.

  **Higher-rank-only contract (must be encoded):** For a taxon whose own `rank` is `family` (or higher), `dwc.taxa_classification.scientific_name` carries the taxon's own `scientific_name` (the family name, e.g., `Delphinidae`); `genus` and below are NULL; `taxon_rank` is the taxon's actual rank string (lowercased, mapped to DwC vocabulary if the enum differs). The branch views then emit `scientificName = taxa_classification.scientific_name`, `taxonRank = taxa_classification.taxon_rank` — no fabricated binomial, ALIGN-03 satisfied.

### Claude's Discretion

- **SQL file layout** — a single new migration `supabase/migrations/{ts}_dwc_schema.sql` covering schema + helper view + branch views + `dwc.occurrences` + `dwc.datasets` is the default. Planner may split for size/readability, but interdependencies (branch views depend on `dwc.taxa_classification`; `dwc.occurrences` depends on both branches) argue for keeping it cohesive.
- **D-03 readiness, not D-03 activation** — Phase 5 must keep the per-`maplify.source` filter mechanically available (e.g., `maplify.source` survives as a column the Maplify branch's `WHERE` references, or a parameterizable predicate). In v1.2 **no source is filtered** — POLICY §4.1 says drop activates only on explicit removal request or QA finding, and neither has happened. Planner ensures the lever exists; planner does **not** drop anything by default.
- **`rwsas` filter verification** — POLICY §5.3 says verify against production whether `maplify.sightings` contains any `rwsas` rows; if so, the Maplify branch's `WHERE` excludes them. Planner queries production-shaped data (or local-supabase fixture) and decides whether the predicate is needed.
- **`maplify.source` distinct values + display-name mapping (Assumption A2)** — POLICY §2.2 says query `SELECT DISTINCT source FROM maplify.sightings` before writing the source→display-name mapping (used for `datasetName` and `rightsHolder`). Planner queries first, then encodes a `CASE` (or small mapping table) the Maplify branch joins.
- **`dwc.datasets.dataset_id` slug for v1.2** — POLICY §6.3 says "not load-bearing." Default to `occurrences-v1` → `https://salishsea.io/datasets/occurrences-v1`. Planner may pick a different slug if a better one exists.
- **`dynamicProperties` JSON assembly** — POLICY §2.3 fixes the key set and rules (omit when NULL, etc.). Planner picks the SQL technique: `jsonb_build_object` with `STRIP_NULLS`, or a function. Choose whichever yields cleaner per-key conditionals.
- **`occurrenceID` collision check** — `salishsea:` prefix on UUIDs and `maplify:` prefix on integer IDs can't collide by construction, but a `SELECT … HAVING COUNT(*) > 1` smoke test in the verification step is cheap insurance against future source additions.
- **D-05 Maplify-data QA harness is NOT in Phase 5 scope** — POLICY §4.5 describes the QA pass as an out-of-band review against `dwc.occurrences` output; it is not a code deliverable. If the planner produces convenience views (e.g., `dwc._maplify_qa_audit`), they are bonus, not required.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 4 policy (the authoritative encoding contract)
- `.planning/phases/04-rights-data-model-policy-gate/04-POLICY.md` — full policy doc. **Required reading.** Section anchors used by Phase 5:
  - §1.1 (D-20) — per-source license URIs (native CC-BY-NC 4.0; Maplify CC-BY 4.0 via Acartia)
  - §1.2 — per-photo CC license converter table (CASE expression input)
  - §1.4 (D-19) — `license_code = 'none'` vs `IS NULL` semantics (two distinct CASE branches)
  - §2.1 (D-09) — native `recordedBy` / `rightsHolder` from `contributors.name`
  - §2.2 (D-10, D-11) — Maplify `recordedBy` / `datasetName` / `rightsHolder` mapping; Assumption A2 (verify `DISTINCT source`)
  - §2.3 — `dynamicProperties` schema (canonical key set + present-when rules)
  - §2.4 — unvalidated whale identifiers: `unvalidatedIdentifiers` array only, never identity terms
  - §3.1 — `public.sightings` gap table (column-by-column projection)
  - §3.2 — `maplify.sightings` gap table (column-by-column projection)
  - §3.3 — `public.observation_photos` (Multimedia extension; Phase 5 emits the columns, Phase 6 emits the extension file)
  - §3.4 (D-12), §3.5 (D-13) — `occurrenceStatus = present`, `individualCount` sparse rules
  - §4.1 (D-03) — per-`maplify.source` drop **lever** required; not exercised in v1.2
  - §5.1 — sources excluded (iNaturalist, HappyWhale)
  - §5.2 (D-14) — no-op for v1.2 (HappyWhale out of scope; Maplify uses exact `number_sighted`)
  - §5.3 — `rwsas` ingest-level exclusion (verify in production)
  - §6.1 (D-15) — `dwc.datasets` table-vs-view delegation → **resolved here as M-03 (view)**
  - §6.2 (D-16) — `dwc.datasets` schema (column list)
  - §6.3 (D-17) — `datasetID` URI scheme
  - §6.4 (D-18) — publisher = SalishSea.io org, contact = Peter Abrahamsen individual; email lives in `dwc.datasets` not POLICY.md
  - §6.5 — coverage fields (mostly Phase 6, but `dwc.occurrences.datasetID` join lives here)
  - §6.7 — explicit Phase 5/Phase 6 ownership split

### Phase 4 supporting artifacts
- `.planning/phases/04-rights-data-model-policy-gate/04-CONTEXT.md` — original decisions before policy elaboration; D-19/D-20 added later
- `.planning/phases/04-rights-data-model-policy-gate/04-SUMMARY.md` — D-14 correction note, A1/A2 assumption registry

### Milestone scope
- `.planning/REQUIREMENTS.md` — v1.2 scope; ALIGN-01..06 requirement text; v1 vs. v2 boundary (individual linkage, ResourceRelationship deferred)
- `.planning/ROADMAP.md` §"Phase 5" — phase goal and the five success criteria (`dwc.occurrences` returns native+Maplify rows, 4 required terms, recursive `dwc.classification()` for `taxonRank`, spatial axis/sign correctness, per-source date precision)
- `.planning/PROJECT.md` — overall milestone scope and decision history

### Source schema (the inputs being projected)
- `supabase/migrations/20250903172708_initial_schema.sql` — base schema. Notably:
  - `public.sightings` (id uuid, observed_at, contributor_id, location, accuracy, body, count, direction, taxon_id, …)
  - `public.contributors` (id, name, …)
  - `public.sighting_photos` (sighting_id, seq, href, license_code)
  - `inaturalist.taxa` (id, parent_id, scientific_name, vernacular_name, rank) — the parent_id chain the recursive walk follows
  - `inaturalist.rank` enum — possible values feeding `taxonRank`
  - Composite types: `public.lat_lng`, `public.dimensions`, `public.taxon`
  - `public.travel_direction` enum + `extract_travel_direction(body)` function (feeds `dynamicProperties.travelDirection`)
- `supabase/migrations/20250915170256_fix-inat-photos.sql` — counts/`number_sighted` shape across sources
- `supabase/migrations/20250919034327_fix_maplify_taxon_mapping.sql` + `*_fix_maplify_taxa_harder.sql` — `maplify.sightings` shape, the `source` column carrying nested provenance, `number_sighted`
- `supabase/migrations/20250921053046_maplify_photo_url.sql` — `maplify.sightings.photo_url` (license-less, excluded per POLICY §1.4)
- `supabase/migrations/20251027062024_fix_blank_license.sql` — the `license_code` `DROP NOT NULL` migration that introduced D-19's NULL semantics
- `database.types.ts` — generated TS types (for any planner cross-references)

### Local dev / verification surface
- `supabase/config.toml` — local Supabase config (port 54321 per project memory)
- `supabase/seed.sql` — current seed surface (Phase 5 does **not** modify; M-03 keeps dataset metadata in the migration, not seed.sql)

### Codebase maps (orientation, not authoritative)
- `.planning/codebase/INTEGRATIONS.md` — Supabase tables/views inventory; confirms `public.occurrences` is the runtime matview (precedent for M-01 but not the same use case)
- `.planning/codebase/ARCHITECTURE.md`, `STACK.md` — overall app shape (Lit, Vite, S3/CloudFront)

### External standards
- DarwinCore Quick Reference (TDWG) — term semantics: `occurrenceID`, `basisOfRecord`, `scientificName`, `eventDate`, `coordinateUncertaintyInMeters`, `decimalLatitude`/`decimalLongitude`, `taxonRank`, `kingdom`..`genus`, `occurrenceStatus`, `individualCount`, `recordedBy`, `rightsHolder`, `datasetName`, `datasetID`, `license`, `dynamicProperties`.
- GBIF DwC-A occurrence-core required terms (4: `occurrenceID`, `basisOfRecord`, `scientificName`, `eventDate`).
- Creative Commons CC-BY 4.0 and CC-BY-NC 4.0 canonical `/legalcode` URIs (already pinned in POLICY §1.1; researcher should not re-derive).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `public.extract_travel_direction(body text)` — IMMUTABLE STRICT function already in schema; the Maplify branch calls this on `maplify.sightings.comments` to fill `dynamicProperties.travelDirection`.
- `public.extract_identifiers(body)` (or equivalent — referenced by POLICY §2.4) — for the `unvalidatedIdentifiers` array.
- `inaturalist.taxa.parent_id` self-FK with `DEFERRABLE INITIALLY DEFERRED` — fine for `WITH RECURSIVE` walks.
- `gis.geography(Point)` columns on both `public.sightings.subject_location` and `maplify.sightings.location` (per ARCHITECTURE map) — `ST_Y` / `ST_X` extract `decimalLatitude` / `decimalLongitude` directly.
- The `license` enum + `cc-by`/`cc-by-nc`/`cc0`/... members already exist in the DB; the per-photo converter is a CASE over this enum.

### Established Patterns
- **DwC contract lives in SQL, not app code** (carried from Phase 4 — confirmed by ROADMAP and POLICY §6.1). Phase 5 is SQL-only. Phase 6 (the serializer) reads `dwc.occurrences` + `dwc.datasets` and emits files; it does not re-decide any column.
- **Migrations are the unit of change.** Every schema decision is a migration in `supabase/migrations/`. There is no separate ORM/codegen layer.
- **`public.occurrences` is a matview** for the runtime UI — that's the *matview-as-runtime-cache* pattern. Phase 5 is the *view-as-export-contract* pattern: structurally different, deliberately not a matview (M-01).
- **Migration timestamp prefix** matches `YYYYMMDDHHMMSS_name.sql` convention. New migration date is in 2026 (see existing `20260*` migrations).

### Integration Points
- **Phase 6 (Archive Generation)** reads `dwc.occurrences` + `dwc.datasets` directly via DuckDB ATTACH. The view's column order, types, and NULL handling are the contract — Phase 5 freezes them.
- **Phase 7 (Nightly Workflow)** runs Phase 6's export; touches Phase 5 only through DuckDB ATTACH + `SELECT *` from `dwc.occurrences` and `dwc.datasets`. No CredentialChain or RLS concern — the nightly job uses a service-role connection (per existing project memory) and the `dwc` schema is read-only.
- **Phase 8 (Frontend Download)** never touches `dwc.*`. Out of integration scope here.

</code_context>

<specifics>
## Specific Ideas

- The dataset slug `occurrences-v1` (default) anticipates a v2 archive (registered with GBIF) under `occurrences-v2` — the v1.2 doc said the slug is "not load-bearing," but `v1`/`v2` framing keeps the door open without making it semantic.
- `dwc._native_occurrences` / `dwc._maplify_occurrences` use the leading-underscore convention to signal "internal, do not consume directly" — Phase 6 reads `dwc.occurrences` (the union), never the branches.
- The recursive CTE in `dwc.taxa_classification` should be expressed as a view definition, not a function, so EXPLAIN plans are inspectable without `SET client_min_messages`.

</specifics>

<deferred>
## Deferred Ideas / Roadmap Ripples

- **D-05 Maplify-data QA harness as code** — POLICY §4.5 defines the QA pass as out-of-band review; if it later proves useful as SQL (e.g., `dwc._maplify_qa_audit` view with NULL counts, coord-out-of-bbox flags, identifier-extraction-mismatch flags), add it in a follow-up phase or operational tooling, not v1.2.
- **D-07 native-only archive variant** — POLICY §4.1 explicitly punts this to Phase 7/8. `dwc.occurrences` does not split native vs. third-party for output; downstream consumers can filter by `datasetName` or `rightsHolder` (or a future constituent join) if they need to.
- **Individuals linkage (REQUIREMENTS.md INDIV-01, v2)** — `organismID` is deferred. `dwc.occurrences` does not emit it; the migration `20260330182547_individual_model.sql` (untracked at time of writing) is unrelated to v1.2.
- **Future per-constituent `dwc.datasets` rows** — schema is sized for them (POLICY §6.2); Phase 5 ships one row.

</deferred>

---

*Phase: 05-db-projection-dwc-schema*
*Context gathered: 2026-06-17*
