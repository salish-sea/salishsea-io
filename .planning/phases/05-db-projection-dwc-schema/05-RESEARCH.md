# Phase 5: DB Projection (`dwc` schema) — Research

**Researched:** 2026-06-17
**Domain:** Postgres view design, DarwinCore term encoding, PostGIS axis convention, recursive taxonomy walks
**Confidence:** HIGH (most claims VERIFIED against codebase / official docs; a few [CITED] from TDWG/GBIF; minor [ASSUMED] tagged inline)

---

## Summary

Phase 5 is a single Supabase migration that creates a read-only `dwc` Postgres schema with four artifacts: `dwc.taxa_classification` (recursive helper), `dwc._native_occurrences`, `dwc._maplify_occurrences`, `dwc.occurrences` (`UNION ALL` of branches), `dwc.datasets` (view over a `VALUES` list), and `dwc.multimedia` (Multimedia-extension columns; recommended as a separate view per the 1-to-N shape — see §8). The materialisation choice (plain views), branch shape, taxonomy helper, and `dwc.datasets` form are all **locked** by CONTEXT.md M-01..M-05; this research does not relitigate them.

The substantive unknowns this research resolves: (a) the exact DwC term column list with types and constraints, (b) the `inaturalist.rank` → DwC `taxonRank` value mapping, (c) the recursive-CTE skeleton that walks `inaturalist.taxa.parent_id` while preserving higher-rank-only correctness, (d) the ISO-8601 `eventDate` emission pattern (per-source precision), (e) PostGIS axis convention for `gis.geography(Point)` (verified: `ST_X` = longitude, `ST_Y` = latitude), (f) the `jsonb_build_object` + `jsonb_strip_nulls` pattern for `dynamicProperties`, (g) the per-photo `license_code` CASE expression with the D-19 two-branch NULL/`none` distinction, (h) the Multimedia extension table shape, (i) a verification SQL suite the orchestrator can promote to VALIDATION.md, (j) two **CRITICAL schema discrepancies** the planner must address before writing migrations.

**Primary recommendation:** A single new migration `supabase/migrations/20260617XXXXXX_dwc_schema.sql` creates the schema, both internal branch views, the taxonomy helper, the public-facing `dwc.occurrences` / `dwc.multimedia` / `dwc.datasets` views, plus minimal grants (`anon`, `authenticated` get `USAGE` + `SELECT`; service-role auto-inherits). All projection logic ships in one cohesive file so the policy-to-SQL correspondence is reviewable in one diff. The orchestrator should add a `[BLOCKING]` `supabase db reset` task before any verification step.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **M-01** — `dwc.occurrences` is a **plain view**, not a materialised view. The nightly job (Phase 7) executes it once daily via DuckDB `ATTACH` + `COPY`, streaming straight to Parquet/CSV. No refresh step, no staleness window.
- **M-02** — Two intermediate per-source views: `dwc._native_occurrences` + `dwc._maplify_occurrences`, joined as `dwc.occurrences = SELECT * FROM dwc._native_occurrences UNION ALL SELECT * FROM dwc._maplify_occurrences`. Leading-underscore convention signals "internal, do not consume directly."
- **M-03** — `dwc.datasets` is a **view over a `VALUES` list** declared inline in the migration. Every edit is a migration; survives `supabase db reset`.
- **M-04** — `contact_email = 'rainhead@gmail.com'`, committed verbatim in the migration. `supabase/migrations/` is application code, not `.planning/`.
- **M-05** — `dwc.taxa_classification` is a helper view (recursive CTE over `inaturalist.taxa.parent_id`), JOINed by both branch views. **Higher-rank-only contract:** taxa at family rank or higher carry `scientific_name = taxa.scientific_name` (e.g., `Delphinidae`), with `genus` and below NULL; `taxon_rank` reflects the taxon's actual rank (mapped to DwC vocabulary).

### Claude's Discretion

- **SQL file layout** — single new migration is the default; planner may split for readability, but the four artifacts have hard dependencies (`taxa_classification` → branches → `occurrences`).
- **D-03 readiness, not D-03 activation** — preserve the `WHERE`-clause lever; **do not** filter any source in v1.2 unless §5.3's `rwsas` audit finds rows.
- **`rwsas` filter verification** — planner queries the production-shaped data (or local fixture) and decides whether the `WHERE source != 'rwsas'` predicate is needed in the Maplify branch.
- **`maplify.source` distinct-values mapping** — planner queries `SELECT DISTINCT source FROM maplify.sightings` before writing the source→display-name CASE table.
- **`dwc.datasets.dataset_id` slug** — default `occurrences-v1`; planner may pick differently.
- **`dynamicProperties` assembly technique** — `jsonb_build_object` + `jsonb_strip_nulls` is the recommended pattern (see §6).
- **`occurrenceID` collision smoke test** — include `HAVING COUNT(*) > 1` assertion in verification.
- **D-05 Maplify QA harness** — out of Phase 5 scope; convenience views are bonus, not required.

### Deferred Ideas (OUT OF SCOPE)

- **D-05 Maplify-data QA harness as code** — out-of-band review, not v1.2 code deliverable.
- **D-07 native-only archive variant** — punted to Phase 7/8.
- **Individuals linkage / `organismID`** (REQUIREMENTS INDIV-01, v2) — `organismID` is NOT emitted by Phase 5. The 2026-03-30 `individual_model.sql` (untracked) is unrelated to v1.2.
- **Future per-constituent `dwc.datasets` rows** — schema is sized for them; Phase 5 ships exactly one row.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **ALIGN-01** | A dedicated read-only `dwc` Postgres schema projects in-scope occurrences into DarwinCore-aligned columns, built directly from source tables (not the UI `public.occurrences` view), filtered to native + Maplify/Whale Alert only | §"Standard Stack" + §"Architecture Patterns" — new `dwc` schema, `_native_occurrences` reads `public.observations` + `public.contributors` + `public.observation_photos` + `inaturalist.taxa`; `_maplify_occurrences` reads `maplify.sightings`; both join `dwc.taxa_classification`. iNaturalist + HappyWhale tables are not referenced. |
| **ALIGN-02** | Each occurrence record carries the four GBIF-required terms: `occurrenceID`, `basisOfRecord`, `scientificName`, `eventDate` | §"DwC Column Specification" — required columns marked `NOT NULL` in the column-by-column table; verification §10 assertion (a) checks all four are non-null on every row. |
| **ALIGN-03** | Taxonomy expanded to `taxonRank` + `kingdom`…`genus` by walking `taxa` parent hierarchy, higher-rank-only handled correctly | §"Higher-Rank-Only Recursive Walk" — `WITH RECURSIVE` skeleton; verification §10 assertion (d) checks family-rank rows emit no fabricated binomial. |
| **ALIGN-04** | Spatial terms emit `decimalLatitude`/`decimalLongitude` with correct axis and sign, constant WGS84 `geodeticDatum`, `coordinateUncertaintyInMeters` omitted-when-NULL (never 0) | §"PostGIS Axis Convention" — verified `ST_Y(location::gis.geometry)` = lat, `ST_X` = lon (existing `public.occurrences` view uses this exact pattern, e.g., `20251027062024_fix_blank_license.sql:27`). Verification §10 assertions (b), (c), (e). |
| **ALIGN-05** | ISO-8601 `eventDate` at honest per-source precision (Maplify report-time at date precision) | §"ISO-8601 eventDate Formatting" — native uses `to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SSOF')`; Maplify uses `(created_at AT TIME ZONE 'GMT')::date::text`. |
| **ALIGN-06** | `occurrenceID` stable and deterministic across runs (source-prefixed surrogate keys) | §"DwC Column Specification" — `'salishsea:' || o.id::text` and `'maplify:' || s.id::text`; verification §10 assertion (f) confirms uniqueness. |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| DwC term mapping (policy→column) | Postgres / `dwc` schema (views) | — | The contract lives in SQL, not app code (established pattern from Phase 4 POLICY §6.7, confirmed by ROADMAP). Phase 6 reads the view; it never re-decides a column. |
| Recursive taxonomy walk | Postgres / `dwc.taxa_classification` view | — | `WITH RECURSIVE` runs once per `dwc.occurrences` consumption (Phase 7 nightly), so re-evaluation cost is bounded. Centralising it as a view means EXPLAIN plans are inspectable and the higher-rank-only logic has one test surface (M-05). |
| Dataset metadata (EML source) | Postgres / `dwc.datasets` view | — | M-03: view-over-VALUES is the source-of-truth. Phase 6 reads it; no string constants in serialiser code. |
| Per-photo license URI mapping | Postgres / `dwc.multimedia` view (CASE expression) | — | The converter is shared across formats (Multimedia .csv, GeoParquet sidecar). Encoded once in SQL. |
| HTML stripping from `body` / `comments` | Postgres / `dwc.*` views | — | Phase 5 emits the column; Phase 6's serialiser does NOT post-process text. (Note: POLICY §3.1/§3.2 say "Strip HTML; emit as plain text." A simple `regexp_replace(text, '<[^>]+>', '', 'g')` is the standard approach. Planner picks the exact pattern; this is Claude's discretion.) |
| `dynamicProperties` JSON assembly | Postgres / `dwc.*` views (`jsonb_build_object`) | — | `jsonb_strip_nulls` produces the omit-when-null semantics with a single per-row expression. |
| GBIF validator pass | Phase 6 (out of Phase 5 scope) | — | Phase 5's verification (§10) confirms SQL contracts; structural archive validation lives in Phase 6. |
| Source filtering (`rwsas`, `is_test`, future D-03) | Postgres / `dwc._maplify_occurrences.WHERE` | — | The lever stays in SQL; Phase 6 has no source-filtering knobs. |

---

## Standard Stack

### Core

| Library / Feature | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| PostgreSQL | 17 (per `supabase/config.toml:db.major_version`) | Host DB | Project standard. |
| PostGIS (`gis` schema) | extension already installed | `geography(Point)` projection to lat/lon decimals | Already used by `public.occurrences`. `ST_X`/`ST_Y` extract scalars. |
| Supabase CLI | latest matching project's `package.json` | `supabase db reset` / `supabase db push` for local validation | Project default. |
| `psql` (via `npx supabase` or system) | n/a | Run verification assertions against `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Standard local-Supabase DB connection. |

**No new packages.** This phase is a `.sql` migration; no npm/Python/Rust dependencies are introduced.

### Supporting (already in project)

| Feature | Purpose | When to Use |
|---------|---------|-------------|
| `WITH RECURSIVE` | Walk `inaturalist.taxa.parent_id` for `dwc.taxa_classification` | M-05 helper view |
| `jsonb_build_object` + `jsonb_strip_nulls` | Assemble `dynamicProperties` with omit-when-null semantics | Native + Maplify branches |
| `to_char(timestamptz, 'YYYY-MM-DD"T"HH24:MI:SSOF')` | Force ISO-8601 with explicit offset for native `eventDate` | `_native_occurrences` |
| `regexp_replace(text, '<[^>]+>', '', 'g')` | Strip HTML from `body` / `comments` | Both branches (POLICY §3.1 / §3.2) |
| `public.extract_travel_direction(text)` | Existing IMMUTABLE STRICT helper | Maplify branch `dynamicProperties.travelDirection` from `comments` |
| `public.extract_identifiers(text)` | Existing IMMUTABLE STRICT helper, returns `varchar[]` | Both branches `dynamicProperties.unvalidatedIdentifiers` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain view (`dwc.occurrences`) | Materialised view | M-01 locked: matview adds refresh cadence and storage; the nightly DuckDB consumer reads through once daily, so caching buys nothing. |
| `WITH RECURSIVE` as view | `WITH RECURSIVE` inside a `STABLE` SQL function | M-05 locked: view exposes EXPLAIN plans without `SET client_min_messages` and avoids `SECURITY DEFINER` considerations. |
| `jsonb_build_object` + `jsonb_strip_nulls` | Manual `CASE WHEN ... IS NOT NULL THEN '"key":' || ...` string concat | `jsonb_strip_nulls` is the idiomatic Postgres 17 pattern. String concat re-implements escaping; avoid. |
| `to_char(...)` for ISO-8601 | Postgres's default `text` cast of `timestamptz` | Postgres's default cast yields `2024-03-15 14:30:00+00`, which DwC strict parsers reject (the space delimiter and offset format `+00` instead of `+00:00` are sub-RFC-3339). Use `to_char(... 'YYYY-MM-DD"T"HH24:MI:SSOF')` for a `T` delimiter and ±HH offset (GBIF/DwC accepts ±HH per ISO-8601 basic-form). [CITED: dwc.tdwg.org/terms/eventDate accepts ISO-8601] |

### Installation

```bash
# No installs. The phase is a migration. Local validation:
supabase db reset    # rebuilds local DB from all migrations
# or, if migrations are already applied:
supabase db push --local
```

### Version verification

- PostgreSQL 17 confirmed: `supabase/config.toml` line 31. [VERIFIED: codebase]
- PostGIS `gis` schema confirmed: `supabase/migrations/20250903172708_initial_schema.sql` lines 1–2. [VERIFIED: codebase]
- Supabase CLI version is whatever the contributor has installed; `supabase/config.toml` doesn't pin it. The migration uses standard SQL — no CLI version sensitivity.

---

## Package Legitimacy Audit

This phase installs **no external packages**. Phase 5 is a single SQL migration. The audit is **N/A**.

---

## CRITICAL Schema Discrepancies (Planner Must Resolve)

> Two discrepancies between CONTEXT.md and the actual on-disk schema. Both surfaced while reading `supabase/migrations/`. Each one is load-bearing — the planner cannot write the migration without resolving them.

### Discrepancy 1: Table names — `public.sightings` → `public.observations`

**CONTEXT.md says** (multiple places): "Source: `public.sightings`, `public.contributors`, `public.sighting_photos`", "Composite types: `public.lat_lng`", "`public.sightings` (id uuid, observed_at, contributor_id, …)".

**Schema actually has:**
- `public.sightings` was **renamed to** `public.observations` on 2025-09-15 (`20250915171505_sighting_policies.sql:35`). [VERIFIED: codebase]
- `public.sighting_photos` was **renamed to** `public.observation_photos`, and `sighting_id` was renamed to `observation_id` (same migration, lines 36–37). [VERIFIED: codebase]
- Current `public.observations` columns include `contributor_id INTEGER REFERENCES contributors(id)` (added 2026-02-04, `20260204013006_*:1`), `user_uuid uuid REFERENCES auth.users(id)` (added 2026-02-07), `accuracy INTEGER`, `subject_location gis.geography(Point,4326)`, `observer_location gis.geography(Point,4326)`, `observed_at timestamptz`, `body varchar(2000)`, `count smallint CHECK (count IS NULL OR count > 0)`, `url varchar(2000)`, `direction public.travel_direction`, `taxon_id INTEGER REFERENCES inaturalist.taxa(id)` (initial schema + accretive ALTERs). [VERIFIED: codebase]
- Current `public.observation_photos` is `(id, observation_id uuid REFERENCES public.observations, seq smallint, href varchar(2000), license_code character varying(20) NOT NULL)`. The `license_code` is **still `varchar(20) NOT NULL`** — `DROP NOT NULL` was **never applied to this column** (see Discrepancy 2). [VERIFIED: codebase — initial schema line 243 + no subsequent `ALTER COLUMN license_code` migration]

**Planner action:** All Phase 5 SQL references must use `public.observations` and `public.observation_photos` with column `observation_id`. The migration's CONTEXT.md `<canonical_refs>` block has the old names; the planner must NOT copy them mechanically.

**Impact on M-01..M-05:** None — the M decisions are about views, not source-table names. M-02 still calls for `_native_occurrences` reading `public.observations`.

---

### Discrepancy 2: `DROP NOT NULL` applies to iNaturalist, not native

**POLICY.md §1.2 says** (verbatim): *"The `ALTER COLUMN license DROP NOT NULL` migration allows `NULL` values in `public.observation_photos.license_code`."*

**CONTEXT.md `<canonical_refs>` says**: "`supabase/migrations/20251027062024_fix_blank_license.sql` — the `license_code` `DROP NOT NULL` migration grounding D-19".

**Schema actually has:**
- The 2025-09-21 migration `20250921045207_photo_licensing.sql:1-2` runs `ALTER TABLE inaturalist.observation_photos ALTER COLUMN license DROP NOT NULL` — on the **iNaturalist** photos table, not `public.observation_photos`. [VERIFIED: codebase]
- The 2025-10-27 migration `20251027062024_fix_blank_license.sql` modifies the iNaturalist upsert function to coerce `''` → `NULL`. It contains **no** `ALTER COLUMN` on `public.observation_photos`. [VERIFIED: codebase]
- `public.observation_photos.license_code` was created as `character varying(20) NOT NULL` in the initial schema and **no subsequent migration alters that NOT NULL constraint**. (Grep `ALTER TABLE.*observation_photos|ALTER COLUMN.*license_code` returns zero hits on `public.observation_photos`.) [VERIFIED: codebase]

**Implication for D-19:** The two-branch CASE (`WHEN 'none' THEN exclude; WHEN NULL THEN exclude`) was specified for the iNaturalist column — but **iNaturalist is excluded from v1.2 scope** per POLICY §5.1. The native `public.observation_photos.license_code` cannot currently be NULL.

**Planner options (Claude's discretion territory, but POLICY direction is binding):**

1. **Encode the CASE faithfully to POLICY.md anyway.** The two-branch CASE includes a `WHEN license_code IS NULL` arm that today matches zero rows but encodes the intended forward-compatible semantic. This is the lowest-risk option: matches POLICY verbatim, future-proofs against a `DROP NOT NULL` on the native column, costs nothing. **Recommended.**
2. **Flag the discrepancy back to discuss-phase / the planner.** If the policy is wrong (the constraint never applied to native), then D-19 may be a no-op for v1.2 and the CASE simplifies. Surface this through a planning check-in rather than silently choosing.

**Recommendation:** Option 1. Encode the CASE per POLICY §1.2 — including a `WHEN license_code IS NULL THEN ... exclude` arm — and add a comment in the migration: `-- D-19: NULL branch currently unreachable on public.observation_photos.license_code (NOT NULL constraint preserved from initial schema); preserved for forward compatibility with a future DROP NOT NULL`. This honours POLICY without inventing a fact. The planner should also raise this as Discrepancy-2 in the plan-check or summary so a future reviewer of POLICY.md knows the wording references a constraint that may never have applied to native photos.

---

## Architecture Patterns

### System Architecture Diagram

```
Source tables (read-only inputs):
  public.observations  ──┐
  public.contributors  ──┤
  public.observation_photos ──┤
  inaturalist.taxa      ──┼──→ dwc.taxa_classification (recursive CTE view)
                          │           │
                          │           ▼
                          ├──→ dwc._native_occurrences (view) ──┐
                          │                                      │
  maplify.sightings   ────┼──→ dwc._maplify_occurrences (view) ──┼──→ dwc.occurrences (UNION ALL)
  (joined to inat.taxa)   │                                      │           │
                          │                                      │           ▼
  public.observation_photos ──→ dwc.multimedia (view, native-only) ──┐  consumed by Phase 6
                                                                      │   (DuckDB ATTACH +
  (VALUES literal, one row in migration) ──→ dwc.datasets (view) ─────┘    COPY to CSV/Parquet)

Filter discipline:
  - dwc._native_occurrences:  FROM public.observations o JOIN public.contributors c …  (no extra WHERE; all observations are in-scope)
  - dwc._maplify_occurrences: FROM maplify.sightings s …
        WHERE NOT is_test          -- existing maplify hygiene
          AND number_sighted BETWEEN 1 AND 1000   -- D-13, mirrors public.occurrences UI view
          AND source != 'rwsas'    -- §5.3, only if §5.3 audit shows rows present
          /* AND source NOT IN (…)   -- D-03 lever; not exercised in v1.2 */

Phase 5 NEVER reads:
  - public.occurrences (UI matview shape — wrong source set + UI-shaped columns)
  - inaturalist.observations (POLICY §5.1)
  - happywhale.encounters (POLICY §5.1)
  - any individuals tables (v2 scope)
```

The two leading-underscore branch views are not user-facing; Phase 6 reads only `dwc.occurrences`, `dwc.multimedia`, and `dwc.datasets`.

### Recommended File Layout

```
supabase/migrations/
└── 20260617XXXXXX_dwc_schema.sql    # single migration: schema + views (recommended)
```

Sequence inside the file:
1. `CREATE SCHEMA dwc;`
2. Grants: `GRANT USAGE ON SCHEMA dwc TO anon, authenticated;` (service-role inherits via Supabase defaults).
3. `CREATE VIEW dwc.taxa_classification AS WITH RECURSIVE …` (so the next two views can JOIN it).
4. `CREATE VIEW dwc.datasets AS VALUES (…);` (independent — order doesn't matter, but adjacent to the section it logically owns is nice).
5. `CREATE VIEW dwc._native_occurrences AS …` (depends on `taxa_classification` + `datasets`).
6. `CREATE VIEW dwc._maplify_occurrences AS …` (depends on `taxa_classification` + `datasets`).
7. `CREATE VIEW dwc.occurrences AS SELECT * FROM dwc._native_occurrences UNION ALL SELECT * FROM dwc._maplify_occurrences;`
8. `CREATE VIEW dwc.multimedia AS …` (depends on `dwc._native_occurrences` for the `coreId` join — see §8).
9. `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated;` (after view creation; "ALL TABLES" includes views in Postgres).
10. Comments on each view explaining the policy section it encodes (`COMMENT ON VIEW dwc.occurrences IS 'Encodes 04-POLICY §3.1 (native) and §3.2 (Maplify). Read by Phase 6.';`).

The interdependencies argue against splitting into multiple migrations; CONTEXT.md endorses single-file.

### Pattern 1: View-as-export-contract

**What:** A read-only view that freezes column order, types, and NULL semantics for a downstream consumer.

**When to use:** Cross-process contracts where the consumer can't tolerate column drift (here: DuckDB's `meta.xml` field order in Phase 6, which is anchored on `dwc.occurrences` column order per DWCA-02).

**Example:**
```sql
-- Source: this codebase pattern + locked M-01 / M-02
CREATE VIEW dwc.occurrences AS
SELECT * FROM dwc._native_occurrences
UNION ALL
SELECT * FROM dwc._maplify_occurrences;
```

The `UNION ALL` enforces identical column count, order, and types between the two branches — Postgres raises a `column count` / `type mismatch` error at view-creation if they drift. This is free defensive programming for DWCA-02.

### Pattern 2: Recursive ancestor walk with rank pivot

**What:** Walk a self-referencing taxonomy table, emit one row per leaf taxon with ancestor scientific names pivoted into rank-named columns.

**Example:** see §"Higher-Rank-Only Recursive Walk" below.

### Pattern 3: `jsonb_build_object` + `jsonb_strip_nulls`

**What:** Build a JSON object then drop keys whose values are NULL.

**Example:** see §"`dynamicProperties` JSON construction" below.

### Anti-Patterns to Avoid

- **Materialised view for `dwc.occurrences`.** M-01 forbids. Adds refresh cadence, staleness, storage cost — buys nothing for a once-per-night consumer.
- **Reading `public.occurrences`** (the UI matview). It includes iNaturalist + HappyWhale (out of scope), exposes UI-shaped composite types, and `is_own_observation` depends on `auth.uid()` — wrong shape and wrong source set.
- **Fabricating a binomial when only family is known.** `scientificName = COALESCE(species_name, family_name || ' sp.')` is forbidden. POLICY's higher-rank-only contract requires emitting the family name as-is with `taxonRank = 'family'`.
- **`coordinateUncertaintyInMeters = 0`.** Zero means "1-meter circle from this point", which is a false claim of GPS precision. POLICY says omit (= NULL) when unknown. Verification §10 asserts this.
- **Emitting `eventDate` from the default `timestamptz::text` cast.** Postgres yields `2024-03-15 14:30:00+00` — space delimiter, sub-hour-resolution offset. Strict ISO-8601/RFC-3339 parsers reject. Use `to_char(... 'YYYY-MM-DD"T"HH24:MI:SSOF')`.
- **Plain-text `body`/`comments` without HTML stripping.** POLICY §3.1 / §3.2 require `regexp_replace(body, '<[^>]+>', '', 'g')`.
- **Calling `extract_identifiers` without `COALESCE`.** Per `20250924160210_detect_individuals.sql:8`, the function returns NULL (not `'{}'`) when the input has no matches. Use `COALESCE(extract_identifiers(body), ARRAY[]::varchar[])` (this is the established pattern across all existing migrations — see all uses in `public.occurrences` view definitions).

---

## DwC Column Specification

> The complete column list for `dwc.occurrences`. The Multimedia extension lives in `dwc.multimedia` (§8). Type and NOT-NULL guidance is derived from TDWG Quick Reference + GBIF occurrence-core required-terms documentation [CITED: dwc.tdwg.org/list/].

### `dwc.occurrences` columns

| Column | DwC URI | Postgres Type | Required (GBIF) | Native value | Maplify value |
|--------|---------|---------------|-----------------|---------------|----------------|
| `occurrenceID` | `http://rs.tdwg.org/dwc/terms/occurrenceID` | `text` | **YES (NOT NULL)** | `'salishsea:' \|\| o.id::text` | `'maplify:' \|\| s.id::text` |
| `basisOfRecord` | `http://rs.tdwg.org/dwc/terms/basisOfRecord` | `text` | **YES (NOT NULL)** | `'HumanObservation'` | `'HumanObservation'` |
| `eventDate` | `http://rs.tdwg.org/dwc/terms/eventDate` | `text` | **YES (NOT NULL)** | `to_char(o.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` (full ISO-8601 timestamp in UTC) — see §"ISO-8601" below | `(s.created_at AT TIME ZONE 'GMT')::date::text` (date precision only, per ALIGN-05 and §3.2) |
| `scientificName` | `http://rs.tdwg.org/dwc/terms/scientificName` | `text` | **YES (NOT NULL)** | `tc.scientific_name` (from `dwc.taxa_classification`) | `tc.scientific_name` |
| `taxonRank` | `http://rs.tdwg.org/dwc/terms/taxonRank` | `text` | recommended | `tc.taxon_rank` | `tc.taxon_rank` |
| `kingdom` | `http://rs.tdwg.org/dwc/terms/kingdom` | `text` | recommended | `tc.kingdom` | `tc.kingdom` |
| `phylum` | `http://rs.tdwg.org/dwc/terms/phylum` | `text` | recommended | `tc.phylum` | `tc.phylum` |
| `class` | `http://rs.tdwg.org/dwc/terms/class` | `text` | recommended | `tc.class` | `tc.class` |
| `order` | `http://rs.tdwg.org/dwc/terms/order` | `text` | recommended | `tc."order"` (quoted — `order` is a SQL reserved word) | `tc."order"` |
| `family` | `http://rs.tdwg.org/dwc/terms/family` | `text` | recommended | `tc.family` | `tc.family` |
| `genus` | `http://rs.tdwg.org/dwc/terms/genus` | `text` | recommended | `tc.genus` (NULL when taxon's own rank ≥ family) | `tc.genus` |
| `decimalLatitude` | `http://rs.tdwg.org/dwc/terms/decimalLatitude` | `double precision` (or `numeric(9,6)` for exact 6-decimal display; see note) | recommended | `gis.ST_Y(o.subject_location::gis.geometry)` | `gis.ST_Y(s.location::gis.geometry)` |
| `decimalLongitude` | `http://rs.tdwg.org/dwc/terms/decimalLongitude` | `double precision` | recommended | `gis.ST_X(o.subject_location::gis.geometry)` | `gis.ST_X(s.location::gis.geometry)` |
| `geodeticDatum` | `http://rs.tdwg.org/dwc/terms/geodeticDatum` | `text` | recommended | `'WGS84'` constant | `'WGS84'` |
| `coordinateUncertaintyInMeters` | `http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters` | `integer` | recommended | `NULLIF(o.accuracy, 0)` (omit when 0 or NULL) | `NULL` (no source column) |
| `individualCount` | `http://rs.tdwg.org/dwc/terms/individualCount` | `integer` | recommended | `o.count` (already CHECKed > 0) | `s.number_sighted` (already filtered `BETWEEN 1 AND 1000`) |
| `occurrenceStatus` | `http://rs.tdwg.org/dwc/terms/occurrenceStatus` | `text` | recommended | `'present'` | `'present'` |
| `occurrenceRemarks` | `http://rs.tdwg.org/dwc/terms/occurrenceRemarks` | `text` | optional | `NULLIF(TRIM(regexp_replace(o.body, '<[^>]+>', '', 'g')), '')` | `NULLIF(TRIM(regexp_replace(s.comments, '<[^>]+>', '', 'g')), '')` |
| `recordedBy` | `http://rs.tdwg.org/dwc/terms/recordedBy` | `text` | recommended | `c.name` (from `public.contributors`) | `s.usernm` (NULL passes through) |
| `rightsHolder` | `http://purl.org/dc/terms/rightsHolder` | `text` | recommended | `c.name` | `dn.display_name` (from source→display CASE; falls back to `'Whale Alert / Maplify'`) |
| `datasetName` | `http://rs.tdwg.org/dwc/terms/datasetName` | `text` | recommended | `d.title` (joined from `dwc.datasets` single row) | `dn.display_name` (same source CASE; sub-source-named) |
| `datasetID` | `http://rs.tdwg.org/dwc/terms/datasetID` | `text` | recommended | `d.dataset_id` (joined; `https://salishsea.io/datasets/occurrences-v1`) | `d.dataset_id` |
| `license` | `http://purl.org/dc/terms/license` | `text` | recommended | `'https://creativecommons.org/licenses/by-nc/4.0/legalcode'` (CC-BY-NC, native; D-20) | `'https://creativecommons.org/licenses/by/4.0/legalcode'` (CC-BY, Maplify via Acartia; D-20) |
| `dynamicProperties` | `http://rs.tdwg.org/dwc/terms/dynamicProperties` | `text` | optional | See §6 (JSON, omit-when-null) | See §6 |
| `informationWithheld` | `http://rs.tdwg.org/dwc/terms/informationWithheld` | `text` | optional | `NULL` (or static string when `unvalidatedIdentifiers` non-empty — see POLICY §2.4) | `NULL` (same) |

**Notes:**

- **`numeric(9,6)` vs `double precision` for lat/lon.** `ST_X` / `ST_Y` return `double precision`. Casting to `numeric(9,6)` would force 6 decimals of precision and serialise as a fixed-width string in CSV (~10 cm at the equator) — but DuckDB's COPY will format `double precision` to a reasonable precision automatically, and DwC's Quick Reference treats `decimalLatitude` as "decimal" without a fixed-scale requirement [CITED: dwc.tdwg.org/terms/]. **Recommendation:** Keep `double precision` and let Phase 6's COPY round; this matches the existing `public.occurrences` pattern (`gis.ST_X(location::gis.geometry)` returns `double precision`).
- **`coordinateUncertaintyInMeters` integer vs numeric.** TDWG/GBIF Quick Reference says "integer" [CITED: dwc.tdwg.org/terms/coordinateUncertaintyInMeters]. The native source `accuracy` column is already `integer`. Emit as `integer`. The `NULLIF(o.accuracy, 0)` guards against a hypothetical `0` slipping in (existing `CHECK` does not forbid 0; the policy does).
- **`order` is a SQL reserved word.** Use `"order"` in the view definition, or alias as `tc.order_ AS "order"` from the helper view (the helper itself can use `order_` to avoid quoting cascades). DuckDB's `COPY` to CSV will produce `order` as the column header (quoted column names emit unquoted in CSV headers).
- **`column count`/`type mismatch` discipline.** Both branches MUST emit columns in identical order with identical types. Tests this implicitly when `CREATE VIEW dwc.occurrences AS … UNION ALL …` is run — Postgres raises if mismatched.

---

## `inaturalist.rank` → DwC `taxonRank` Vocabulary Mapping

The `inaturalist.rank` enum has **35 values** (initial schema lines 119–155). [VERIFIED: codebase] GBIF's `taxonRank` vocabulary uses **lowercase identifiers** by convention [CITED: rs.gbif.org/vocabulary/gbif/rank.xml]. Most `inaturalist.rank` values map straight through with no transformation; the only divergence is `stateofmatter` (an iNaturalist-specific rank for the very top of the tree) which has no GBIF analogue.

| `inaturalist.rank` value | GBIF `taxonRank` string | Notes |
|--------------------------|--------------------------|-------|
| `infrahybrid` | `infrahybrid` | iNaturalist-specific; pass through verbatim |
| `form` | `form` | match |
| `variety` | `variety` | match |
| `subspecies` | `subspecies` | match |
| `hybrid` | `hybrid` | match |
| `species` | `species` | match |
| `complex` | `complex` | iNaturalist-specific; not in GBIF vocab — emit verbatim |
| `subsection` | `subsection` | iNaturalist-specific botanical; emit verbatim |
| `section` | `section` | match |
| `subgenus` | `subgenus` | match |
| `genushybrid` | `genushybrid` | iNaturalist-specific; emit verbatim |
| `genus` | `genus` | match |
| `subtribe` | `subtribe` | match |
| `tribe` | `tribe` | match |
| `supertribe` | `supertribe` | match |
| `subfamily` | `subfamily` | match |
| `family` | `family` | match |
| `epifamily` | `epifamily` | iNaturalist-specific; emit verbatim |
| `superfamily` | `superfamily` | match |
| `zoosubsection` | `zoosubsection` | iNaturalist-specific; emit verbatim |
| `zoosection` | `zoosection` | iNaturalist-specific; emit verbatim |
| `parvorder` | `parvorder` | match |
| `infraorder` | `infraorder` | match |
| `suborder` | `suborder` | match |
| `order` | `order` | match |
| `superorder` | `superorder` | match |
| `subterclass` | `subterclass` | iNaturalist-specific; emit verbatim |
| `infraclass` | `infraclass` | match |
| `subclass` | `subclass` | match |
| `class` | `class` | match |
| `superclass` | `superclass` | match |
| `subphylum` | `subphylum` | match |
| `phylum` | `phylum` | match |
| `kingdom` | `kingdom` | match |
| `stateofmatter` | `stateofmatter` | **No GBIF analogue.** Only `id=48460 Life` has this rank in iNaturalist. In practice no Phase 5 in-scope row will ever have `taxon_id=48460` (we're tracking cetaceans + selected marine mammals); emit verbatim if encountered. |

**Recommendation:** Cast the enum to text directly. **The values match by construction** for every rank Phase 5 will actually see in-scope (Cetacea descendants), so the mapping CASE can be a one-liner: `t.rank::text`. The migration should add a comment noting that GBIF accepts arbitrary lowercase strings in `taxonRank`; values outside the recommended vocabulary cause a "soft" quality flag but are not rejected. [VERIFIED: rs.gbif.org/vocabulary/gbif/rank.xml — vocabulary is permissive] [ASSUMED: that iNaturalist-specific ranks like `complex`, `epifamily`, `zoosection` are not rejected by GBIF — based on GBIF's documented permissive parsing posture; planner may verify against a GBIF DwC-A validator run in Phase 6.]

**Pivot mapping (which rank goes into which DwC column):** Only `kingdom`, `phylum`, `class`, `order`, `family`, `genus` get their own DwC columns. Sub-ranks (e.g., `subgenus`, `subfamily`, `subspecies`) do NOT get a column — they end up in `scientificName` (when the leaf taxon's rank is that sub-rank) but never pivot into a Linnaean column.

---

## Higher-Rank-Only Recursive Walk

> The `WITH RECURSIVE` skeleton for `dwc.taxa_classification`. Encodes M-05's higher-rank-only contract.

**Contract:** For each `inaturalist.taxa.id`, return one row with:
- `taxon_id`, `taxon_rank` (the leaf's own rank, as text)
- `scientific_name` (the leaf's own scientific name — NEVER a fabricated binomial)
- `kingdom`, `phylum`, `class`, `order_`, `family`, `genus` — populated by walking ancestors, but **only ranks at or below the leaf's own rank are populated**. A family-rank leaf has `kingdom`..`family` filled and `genus` = NULL.

**Pattern (production-ready skeleton, not pseudocode):**

```sql
CREATE VIEW dwc.taxa_classification AS
WITH RECURSIVE ancestors AS (
  -- Seed: every taxon is its own first ancestor (distance 0)
  SELECT
    id          AS leaf_id,
    id          AS ancestor_id,
    parent_id,
    rank,
    scientific_name,
    0           AS depth
  FROM inaturalist.taxa

  UNION ALL

  -- Step: walk parent_id one level at a time
  SELECT
    a.leaf_id,
    p.id,
    p.parent_id,
    p.rank,
    p.scientific_name,
    a.depth + 1
  FROM ancestors a
  JOIN inaturalist.taxa p ON p.id = a.parent_id
  -- No depth limit needed — iNaturalist tree depth is bounded (<30)
),
-- Pivot ancestors into one row per leaf, one column per Linnaean rank
pivoted AS (
  SELECT
    leaf_id AS taxon_id,
    MAX(CASE WHEN rank = 'kingdom'::inaturalist.rank THEN scientific_name END) AS kingdom,
    MAX(CASE WHEN rank = 'phylum'::inaturalist.rank  THEN scientific_name END) AS phylum,
    MAX(CASE WHEN rank = 'class'::inaturalist.rank   THEN scientific_name END) AS class,
    MAX(CASE WHEN rank = 'order'::inaturalist.rank   THEN scientific_name END) AS order_,
    MAX(CASE WHEN rank = 'family'::inaturalist.rank  THEN scientific_name END) AS family,
    MAX(CASE WHEN rank = 'genus'::inaturalist.rank   THEN scientific_name END) AS genus
  FROM ancestors
  GROUP BY leaf_id
)
SELECT
  t.id                                    AS taxon_id,
  t.rank::text                            AS taxon_rank,
  t.scientific_name                       AS scientific_name,   -- always the leaf's own name (no fabrication)
  p.kingdom,
  p.phylum,
  p.class,
  p.order_,
  p.family,
  -- Higher-rank-only correctness: blank out genus when the leaf is at family rank or higher.
  -- Implementation: if the leaf's own rank's ordinal is >= family's ordinal, NULL genus.
  -- Rank ordinals are encoded by enum position; we use a small helper:
  CASE
    WHEN t.rank IN ('genus','genushybrid','subgenus','species','complex','section','subsection',
                    'hybrid','subspecies','variety','form','infrahybrid')
      THEN p.genus
    ELSE NULL
  END                                     AS genus
FROM inaturalist.taxa t
JOIN pivoted p ON p.taxon_id = t.id;
```

**Why the genus CASE is enumerated explicitly:** `inaturalist.rank` is an enum; enum comparison works (`t.rank >= 'genus'`) and returns based on declaration order. Looking at the enum declaration (initial schema lines 119–155), `genus` is position 12 and `family` is position 17, so `t.rank <= 'genus'` would also work to mean "genus or below". The explicit `IN` list is more reviewable than a positional comparison and survives future enum reorderings — recommended for clarity.

**Performance note:** This is a view, so the recursion re-runs every time `dwc.occurrences` is queried. For Phase 7's nightly read, this is fine (one query, ~all taxa). If iNaturalist taxa grows to >1M rows the recursion may justify a `MATERIALIZED VIEW` later; for v1.2 the table size is manageable (~1k-100k rows). M-01's anti-matview stance applies to `dwc.occurrences`, not necessarily to `dwc.taxa_classification` — but POLICY/CONTEXT don't authorise matview here either, so default to plain view.

**Higher-rank-only test surface:** `SELECT * FROM dwc.taxa_classification WHERE rank = 'family';` should return rows with `scientific_name` = the family name (e.g., `Delphinidae`), `family` filled, `genus` NULL. Verification §10(d) asserts this.

---

## ISO-8601 `eventDate` Formatting in Postgres

POLICY §3.1 (native): "Emit as ISO-8601 at full precision."
POLICY §3.2 (Maplify): "Emit at date precision only (`created_at::date`, e.g., `2024-03-15`)."

**Native — full timestamp in UTC:**
```sql
to_char(o.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
-- yields:  2024-03-15T22:30:00Z
```

Why `"Z"` not `'OF'`: `'OF'` outputs `+00`, which is valid ISO-8601 but inconsistent with the GBIF DwC examples (which use `Z`). The `Z` form is unambiguous UTC. [CITED: ISO-8601 §4.2.5.2 permits both]

`o.observed_at` is `timestamptz`. `AT TIME ZONE 'UTC'` converts to a `timestamp without time zone` representing the UTC wall clock — `to_char` then formats it without further offset interpretation. This is the idiomatic Postgres ISO-8601-with-Z idiom.

**Maplify — date-only:**
```sql
(s.created_at AT TIME ZONE 'GMT')::date::text
-- yields:  2024-03-15
```

`s.created_at` is `timestamp without time zone` (per initial schema). `AT TIME ZONE 'GMT'` converts to `timestamptz` (it pretends the bare timestamp was in GMT — which matches the existing `public.occurrences` pattern at `20251027062024_fix_blank_license.sql:30`). Then `::date::text` collapses to `YYYY-MM-DD`. Same convention used in the existing UI view.

**GBIF acceptance:** GBIF parses `eventDate` per ISO-8601, accepting `YYYY`, `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS`, `YYYY-MM-DDTHH:MM:SSZ`, and `YYYY-MM-DDTHH:MM:SS±HH:MM` forms [CITED: dwc.tdwg.org/list/#dwc_eventDate examples]. The two patterns above land within the accepted set.

**Timezone handling on the native side:** `public.observations.observed_at` is `timestamptz` (`gis.geography(Point,4326)` … `observed_at timestamptz NOT NULL`). The `AT TIME ZONE 'UTC'` normalises to UTC, regardless of the original entry timezone. This is correct for GBIF (DwC has no requirement that `eventDate` be in the observer's local timezone — UTC is the safe default).

**Single-column type discipline:** Both branches emit `text`, not `timestamptz` — Postgres can't `UNION ALL` a `text` (Maplify) with a `timestamptz` (native). Cast both to `text` at the branch level.

---

## PostGIS Axis Convention (`ST_X` = longitude, `ST_Y` = latitude)

> The single most failure-prone DwC mapping is swapping lat/lon. This section locks it down.

**PostGIS convention:** `geography(Point)` stores coordinates in the WKT order `POINT(longitude latitude)`. `ST_X` returns the X axis (= longitude); `ST_Y` returns the Y axis (= latitude). This is the OGC/SFA convention universally followed by PostGIS. [CITED: postgis.net/docs/ST_X.html, postgis.net/docs/ST_Y.html]

**Verification in codebase:**

- `public.occurrences` view (multiple migrations) uses exactly: `row(gis.ST_X(subject_location::gis.geometry), gis.ST_Y(subject_location::gis.geometry))::lon_lat` — and the composite type is `lon_lat (lon, lat)`. [VERIFIED: codebase — `20260204175500_admins.sql:35,60,91`]
- `gis.ST_Point(longitude, latitude)::gis.geography` in `maplify.update_sightings` confirms ingest writes lon-first. [VERIFIED: codebase — `20250919034327_fix_maplify_taxon_mapping.sql:34`]

**Phase 5 expression:**
```sql
gis.ST_Y(o.subject_location::gis.geometry) AS "decimalLatitude",
gis.ST_X(o.subject_location::gis.geometry) AS "decimalLongitude",
```

**Why cast to `gis.geometry`?** `gis.geography` requires the geometry cast for `ST_X`/`ST_Y` to compile cleanly (these functions are defined on `gis.geometry`). Existing migrations all do this.

**Known Salish Sea sanity-check point:** `(48.5°N, -123.0°W)` is mid-Haro-Strait. A round-trip should yield `ST_Y` ≈ 48.5, `ST_X` ≈ -123.0. Verification §10(c) tests an actual row from `public.observations` (whose `subject_location` was ingested via `gis.ST_Point(observed_from.lon, observed_from.lat)` per `20250915171505_sighting_policies.sql:95`).

**`coordinateUncertaintyInMeters`:**
- DwC type: integer [CITED: dwc.tdwg.org/list/#dwc_coordinateUncertaintyInMeters].
- Source: `public.observations.accuracy` is `INTEGER` already. No type coercion needed.
- POLICY: emit when non-NULL and > 0; omit otherwise. Use `NULLIF(o.accuracy, 0)` to belt-and-suspenders against a future ingest writing 0.
- Maplify branch has no accuracy column → emit `NULL`.

---

## `dynamicProperties` JSON Construction

> POLICY §2.3's canonical key set, encoded as a per-row `jsonb_build_object` with `jsonb_strip_nulls`.

### Native branch

POLICY §2.3 keys for native rows:
- `travelDirection` — present when `o.direction` is non-NULL
- `unvalidatedIdentifiers` — present when non-empty
- (no `aggregatorSource`, `aggregatorChain`, `countIsMinimum` — those are Maplify-only)

```sql
NULLIF(
  jsonb_strip_nulls(jsonb_build_object(
    'travelDirection',         o.direction::text,
    'unvalidatedIdentifiers',  NULLIF(public.extract_identifiers(o.body), ARRAY[]::varchar[])
  ))::text,
  '{}'
) AS "dynamicProperties"
```

- `jsonb_strip_nulls` removes keys whose values are `NULL`.
- `NULLIF(..., '{}')` collapses an entirely-empty object to NULL, so the column is NULL rather than `{}` when the row has no dynamic properties at all (avoids `dynamicProperties: "{}"` noise in the CSV).
- `o.direction::text` — `public.travel_direction` enum casts cleanly to text (`'north'`, etc.).
- `NULLIF(public.extract_identifiers(o.body), ARRAY[]::varchar[])` — the function returns `NULL` (not empty array) when no match, but the established codebase pattern wraps in `COALESCE(..., '{}')`. Here we want the **opposite**: NULL signals "omit key". So we use `NULLIF(extract_identifiers(...), ARRAY[]::varchar[])` to convert any empty result to NULL. Since `extract_identifiers` already returns NULL on no match, this is technically redundant — but defensive against future regex change. (Alternative: just `public.extract_identifiers(o.body)` since NULL is already the desired absence signal.)

### Maplify branch

POLICY §2.3 keys for Maplify rows:
- `travelDirection` — from `public.extract_travel_direction(s.comments)`
- `aggregatorSource` — display name from source mapping (always emitted)
- `aggregatorChain` — structured provenance text (always emitted)
- `unvalidatedIdentifiers` — present when non-empty
- `countIsMinimum` — **never emitted in v1.2** (HappyWhale-only per D-14 §5.2)

```sql
NULLIF(
  jsonb_strip_nulls(jsonb_build_object(
    'travelDirection',         public.extract_travel_direction(s.comments)::text,
    'aggregatorSource',        dn.display_name,                                        -- non-null by CASE default
    'aggregatorChain',         'Whale Alert / Maplify (WASEAK) > ' || dn.display_name,
    'unvalidatedIdentifiers',  NULLIF(public.extract_identifiers(s.comments), ARRAY[]::varchar[])
  ))::text,
  '{}'
) AS "dynamicProperties"
```

Where `dn.display_name` comes from a `CROSS JOIN LATERAL` against the source CASE (or a small CTE / `VALUES` join in the view body). Example shape (Claude's discretion, but this is clean):

```sql
FROM maplify.sightings s
JOIN dwc.taxa_classification tc ON tc.taxon_id = s.taxon_id
CROSS JOIN LATERAL (
  SELECT
    CASE s.source
      WHEN 'orca_network' THEN 'Orca Network'
      WHEN 'cascadia'     THEN 'Cascadia Research Collective'
      -- ... after planner runs SELECT DISTINCT source FROM maplify.sightings
      ELSE 'Whale Alert / Maplify'
    END AS display_name
) AS dn
```

The `CROSS JOIN LATERAL` keeps the CASE referenceable as `dn.display_name` in both `rightsHolder`, `datasetName`, and the `dynamicProperties` JSON without repetition.

**Type discipline:** Both branches emit `text`. Both wrap in `NULLIF(..., '{}')` so empty-strip collapses to NULL — Postgres's `text::text` is a no-op, so the cast is just there to satisfy the `UNION ALL` column-type requirement.

**Whether to cast `jsonb` → `text` in the view:** GBIF treats `dynamicProperties` as opaque text [CITED: POLICY §5.4]. CSV emission needs `text` anyway. Pre-casting in the view simplifies Phase 6's COPY pipeline.

---

## `license_code` CASE Pattern (Per-Photo Conversion)

> POLICY §1.2 mapping table + D-19 two-branch NULL/`none` distinction. Used in `dwc.multimedia.license` column.

```sql
CASE op.license_code
  WHEN 'cc0'          THEN 'https://creativecommons.org/publicdomain/zero/1.0/legalcode'
  WHEN 'cc-by'        THEN 'https://creativecommons.org/licenses/by/4.0/legalcode'
  WHEN 'cc-by-nc'     THEN 'https://creativecommons.org/licenses/by-nc/4.0/legalcode'
  WHEN 'cc-by-sa'     THEN 'https://creativecommons.org/licenses/by-sa/4.0/legalcode'
  WHEN 'cc-by-nd'     THEN 'https://creativecommons.org/licenses/by-nd/4.0/legalcode'
  WHEN 'cc-by-nc-sa'  THEN 'https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode'
  WHEN 'cc-by-nc-nd'  THEN 'https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode'
  -- D-19 distinct branches: encoded for forward compatibility per POLICY §1.2 (NULL branch
  -- currently unreachable on public.observation_photos.license_code due to NOT NULL constraint
  -- preserved from initial schema; see Discrepancy 2 in RESEARCH).
  WHEN 'none'         THEN NULL  -- terminal: classified as no redistributable license
  ELSE NULL                       -- catches IS NULL (POLICY §1.2 "unknown / unclassified", non-terminal)
END AS license_uri
```

The view filters `WHERE license_uri IS NOT NULL` so excluded photos do not appear in `dwc.multimedia`. POLICY §1.4 makes both `'none'` and NULL excluded in v1.2 — the distinct CASE branches encode the semantic separately even though the v1.2 effect is identical, so a future "classify unknowns" workflow can swap the `ELSE NULL` for a real URI without affecting the `'none'` branch.

**Filter placement note:** Apply the filter in the view body (`WHERE license_uri IS NOT NULL`), not in the CASE itself. This keeps the CASE pure (test surface: feed it every license code, inspect the URIs) and the filter inspectable (test surface: `SELECT COUNT(*) FROM public.observation_photos WHERE license_code IN ('none')` vs `SELECT COUNT(*) FROM dwc.multimedia` gives a directly readable delta).

---

## Multimedia Extension Column Set — Recommend `dwc.multimedia` View

> Item 8 in the research scope.

**Shape question:** Multimedia is 1-to-N per occurrence (one observation can have multiple photos). The DwC-A format encodes this as a separate `multimedia.csv` joined to `occurrence.csv` on `coreId` (DWCA-03). On the Postgres side, the planner can either:

(A) Add per-photo columns to `dwc.occurrences` → **wrong shape** (would explode `dwc.occurrences` row count or require array-typed columns; either breaks Phase 6's straight CSV emission).

(B) Create a separate `dwc.multimedia` view → matches the DwC-A two-file structure 1:1 and gives Phase 6 a `COPY dwc.multimedia TO 'multimedia.csv'` one-liner.

**Recommendation: (B) — `dwc.multimedia` view.** This is required by the `coreId` join requirement of DWCA-03 (each Multimedia row needs a `coreId` that matches an `occurrenceID` in `occurrence.csv`).

### `dwc.multimedia` columns

Per the GBIF Simple Multimedia extension spec [VERIFIED: rs.gbif.org/extension/gbif/1.0/multimedia.xml]:

| Column | Qualified URI | Postgres expression (native-only) | Source |
|--------|---------------|------------------------------------|--------|
| `coreId` (join key) | n/a (descriptor-level) | `'salishsea:' \|\| op.observation_id::text` | Joins to `dwc.occurrences.occurrenceID` |
| `type` | `http://purl.org/dc/terms/type` | `'StillImage'` constant | POLICY §3.3 |
| `format` | `http://purl.org/dc/terms/format` | `NULL` (not stored) | omit |
| `identifier` | `http://purl.org/dc/terms/identifier` | `op.href` | POLICY §3.3 |
| `references` | `http://purl.org/dc/terms/references` | `NULL` (no landing page per photo) | omit |
| `title` | `http://purl.org/dc/terms/title` | `NULL` | omit |
| `description` | `http://purl.org/dc/terms/description` | `NULL` | omit |
| `created` | `http://purl.org/dc/terms/created` | `NULL` (no per-photo timestamp stored separately from observation) | omit |
| `creator` | `http://purl.org/dc/terms/creator` | `c.name` | inherit from observation's contributor |
| `contributor` | `http://purl.org/dc/terms/contributor` | `NULL` | omit |
| `publisher` | `http://purl.org/dc/terms/publisher` | `NULL` | omit |
| `audience` | `http://purl.org/dc/terms/audience` | `NULL` | omit |
| `source` | `http://purl.org/dc/terms/source` | `NULL` | omit |
| `license` | `http://purl.org/dc/terms/license` | (CASE on `op.license_code` from §7) | POLICY §1.2 |
| `rightsHolder` | `http://purl.org/dc/terms/rightsHolder` | `c.name` (inherit) | POLICY §3.3 |

**Ordering column (extension-defined, used for stable iteration order):** The spec calls for an `index` term but it's not part of Simple Multimedia core. Phase 6 can sort by `(coreId, seq)` at COPY time using the underlying `op.seq` — expose as a `seq` column even though it's not a DwC term, OR sort in the view's `ORDER BY` (Postgres views' `ORDER BY` is preserved into `COPY`). **Recommendation:** Don't expose `seq` as an output column (it's not a DwC term); embed `ORDER BY op.observation_id, op.seq` at the end of `dwc.multimedia`'s SELECT. Phase 6's `COPY (SELECT * FROM dwc.multimedia) TO …` will preserve ordering.

### `dwc.multimedia` skeleton

```sql
CREATE VIEW dwc.multimedia AS
SELECT
  'salishsea:' || op.observation_id::text                AS "coreId",
  'StillImage'                                           AS "type",
  op.href                                                AS "identifier",
  CASE op.license_code
    WHEN 'cc0'         THEN 'https://creativecommons.org/publicdomain/zero/1.0/legalcode'
    WHEN 'cc-by'       THEN 'https://creativecommons.org/licenses/by/4.0/legalcode'
    WHEN 'cc-by-nc'    THEN 'https://creativecommons.org/licenses/by-nc/4.0/legalcode'
    WHEN 'cc-by-sa'    THEN 'https://creativecommons.org/licenses/by-sa/4.0/legalcode'
    WHEN 'cc-by-nd'    THEN 'https://creativecommons.org/licenses/by-nd/4.0/legalcode'
    WHEN 'cc-by-nc-sa' THEN 'https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode'
    WHEN 'cc-by-nc-nd' THEN 'https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode'
    WHEN 'none'        THEN NULL
    ELSE NULL
  END                                                    AS "license",
  c.name                                                 AS "rightsHolder",
  c.name                                                 AS "creator"
FROM public.observation_photos op
JOIN public.observations o ON o.id = op.observation_id
JOIN public.contributors c ON c.id = o.contributor_id
WHERE
  -- Per POLICY §1.4: exclude 'none' (terminal "no license") and NULL ("unknown") in v1.2.
  op.license_code IS NOT NULL
  AND op.license_code <> 'none'
ORDER BY op.observation_id, op.seq;
```

**Maplify photos are excluded from `dwc.multimedia` entirely** per POLICY §1.4 (no license info on `maplify.sightings.photo_url`). So `dwc.multimedia` reads only native photo sources — Phase 6's anti-join check (DWCA-03) will see fewer multimedia rows than occurrences, which is fine.

---

## `occurrenceID` Collision Risk

The two prefixes `salishsea:` and `maplify:` cannot collide by construction (one carries a UUID, the other an integer; the prefix disambiguates regardless). But a future source addition (HappyWhale, iNaturalist) could violate this without anyone noticing.

**Smoke test (single SQL, copy into verification):**

```sql
SELECT "occurrenceID", COUNT(*)
FROM dwc.occurrences
GROUP BY "occurrenceID"
HAVING COUNT(*) > 1;
-- Expected: zero rows. Any result = collision present, halt.
```

---

## Validation Architecture

> Required by `workflow.nyquist_validation: true` in `.planning/config.json`. This section is the basis for VALIDATION.md.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Plain SQL `psql` assertions against the local Supabase database. No JS/Python test runner — this is a migration-only phase. |
| Config file | None new. Connection string: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (per `supabase/config.toml:db.port=54322`). |
| Quick run command | `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/snippets/05_dwc_assertions.sql` |
| Full suite command | Same as above — single assertion script. |

**Test file location:** `supabase/snippets/05_dwc_assertions.sql`. The `supabase/snippets/` directory already exists in the project (`ls supabase/` confirmed) and is the conventional place for ad-hoc SQL not in the migrations chain. Verification §11 below discusses alternatives.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ALIGN-01 | `dwc.occurrences` returns rows from native + Maplify only | smoke | `SELECT split_part("occurrenceID",':',1) AS prefix, COUNT(*) FROM dwc.occurrences GROUP BY 1;` — expect `salishsea` and `maplify`, never `inaturalist`/`happywhale` | ❌ Wave 0 |
| ALIGN-02 | Four GBIF-required terms NOT NULL on every row | assertion (a) | `SELECT COUNT(*) FROM dwc.occurrences WHERE "occurrenceID" IS NULL OR "basisOfRecord" IS NULL OR "scientificName" IS NULL OR "eventDate" IS NULL;` — expect 0 | ❌ Wave 0 |
| ALIGN-03 | Higher-rank taxon emits no fabricated binomial | assertion (d) | `SELECT "scientificName", "taxonRank", "genus" FROM dwc.occurrences WHERE "taxonRank" IN ('family','subfamily','order') AND "genus" IS NOT NULL;` — expect 0 rows | ❌ Wave 0 |
| ALIGN-03 | `taxonRank` populated for every row | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "taxonRank" IS NULL;` — expect 0 | ❌ Wave 0 |
| ALIGN-04 | Lat in [-90, 90] and lon in [-180, 180] | assertion (b) | `SELECT COUNT(*) FROM dwc.occurrences WHERE "decimalLatitude" NOT BETWEEN -90 AND 90 OR "decimalLongitude" NOT BETWEEN -180 AND 180;` — expect 0 | ❌ Wave 0 |
| ALIGN-04 | Known Salish Sea point lands at ~48°N, -123°W (axis sanity) | assertion (c) | `SELECT "decimalLatitude", "decimalLongitude" FROM dwc.occurrences ORDER BY ABS("decimalLatitude" - 48.5) + ABS("decimalLongitude" + 123.0) LIMIT 1;` — manually inspect: lat should be between 47–50, lon between -125 and -122 | ❌ Wave 0 |
| ALIGN-04 | `coordinateUncertaintyInMeters` is never 0 | assertion (e) | `SELECT COUNT(*) FROM dwc.occurrences WHERE "coordinateUncertaintyInMeters" = 0;` — expect 0 | ❌ Wave 0 |
| ALIGN-04 | `geodeticDatum` is always `WGS84` | assertion | `SELECT DISTINCT "geodeticDatum" FROM dwc.occurrences;` — expect single row `WGS84` | ❌ Wave 0 |
| ALIGN-05 | Maplify `eventDate` is date precision (no `T` separator) | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "occurrenceID" LIKE 'maplify:%' AND "eventDate" ~ 'T';` — expect 0 | ❌ Wave 0 |
| ALIGN-05 | Native `eventDate` includes time (`T` separator) | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "occurrenceID" LIKE 'salishsea:%' AND "eventDate" NOT LIKE '%T%';` — expect 0 | ❌ Wave 0 |
| ALIGN-06 | `occurrenceID` unique across all rows | assertion (f) | `SELECT "occurrenceID", COUNT(*) FROM dwc.occurrences GROUP BY 1 HAVING COUNT(*) > 1;` — expect 0 rows | ❌ Wave 0 |
| (M-05 contract) | `taxa_classification` genus is NULL for family-rank taxa | unit | `SELECT * FROM dwc.taxa_classification tc JOIN inaturalist.taxa t ON t.id = tc.taxon_id WHERE t.rank = 'family' AND tc.genus IS NOT NULL;` — expect 0 rows | ❌ Wave 0 |
| (M-05 contract) | `taxa_classification` returns one row per taxon | unit | `SELECT COUNT(*) FROM dwc.taxa_classification; SELECT COUNT(*) FROM inaturalist.taxa;` — counts must match | ❌ Wave 0 |
| (POLICY §1.4) | `dwc.multimedia` excludes `none` and NULL license rows | unit | `SELECT COUNT(*) FROM dwc.multimedia WHERE "license" IS NULL;` — expect 0 | ❌ Wave 0 |
| (DWCA-03 readiness) | Every `coreId` in `dwc.multimedia` is in `dwc.occurrences` | smoke | `SELECT m."coreId" FROM dwc.multimedia m LEFT JOIN dwc.occurrences o ON o."occurrenceID" = m."coreId" WHERE o."occurrenceID" IS NULL LIMIT 1;` — expect 0 rows | ❌ Wave 0 |
| (dataset wiring) | `dwc.occurrences.datasetID` matches `dwc.datasets.dataset_id` | smoke | `SELECT COUNT(*) FROM dwc.occurrences o LEFT JOIN dwc.datasets d ON d.dataset_id = o."datasetID" WHERE d.dataset_id IS NULL;` — expect 0 | ❌ Wave 0 |
| (license URIs) | `license` is one of the two canonical legalcode URIs | smoke | `SELECT DISTINCT "license" FROM dwc.occurrences;` — expect exactly two rows: CC-BY-NC 4.0 legalcode and CC-BY 4.0 legalcode | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `supabase db reset && psql … -f supabase/snippets/05_dwc_assertions.sql` (a single shell command that prints `OK` or `FAIL: <which>`).
- **Per wave merge:** Same.
- **Phase gate (`/gsd-verify-work`):** Same — there is only one suite.

### Wave 0 Gaps

- [ ] `supabase/snippets/05_dwc_assertions.sql` — the assertion script. Should use `\set ON_ERROR_STOP on` and a series of `DO $$ BEGIN IF (assertion) THEN RAISE … END $$;` blocks, each labelled with the requirement ID.
- [ ] (optional) `supabase/snippets/README.md` — note that `05_dwc_assertions.sql` is the Phase 5 verification harness, run via `psql -f …` against the local DB.
- [ ] No framework install needed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ISO-8601 timestamp formatting | Manual `concat(year, '-', lpad(month::text,2,'0'), …)` | `to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` | Postgres handles leap days, BC dates, etc.; manual concat will get one of them wrong. |
| HTML stripping | A multi-step `regexp_replace` chain trying to handle entities (`&amp;`, etc.) | Single `regexp_replace(text, '<[^>]+>', '', 'g')` for tags; do **not** try to decode entities in SQL | Phase 6 / serialiser handles encoding. Native `body` and Maplify `comments` are short freeform — a tag-stripper is enough; full HTML decoding belongs in a real parser. |
| Recursive ancestor walks | Self-joining N times with hardcoded depths | `WITH RECURSIVE` | iNaturalist trees are bounded but variable-depth; recursive CTEs handle this without depth assumptions. |
| Source→display-name mapping | `string_agg` + lateral joins on hardcoded constants | `CROSS JOIN LATERAL (SELECT CASE WHEN … END) AS dn` | The lateral pattern makes `dn.display_name` available across `rightsHolder`, `datasetName`, and `dynamicProperties` once, instead of repeating the CASE three times. |
| Per-photo license URI mapping | Joining to a table of license codes | Inline CASE (only 7 enum members + 2 NULL branches) | A lookup table is overkill at 7 values; CASE is reviewable in one diff. |
| Coordinate axis check | Comparing `subject_location::text` parsing | `ST_Y` / `ST_X` after `::gis.geometry` cast | PostGIS functions are the source of truth. |
| Building DwC term URI map in app code | A constants file in Phase 6 | Trust the SQL view's column names (DwC terms) | Phase 6's `meta.xml` reads columns by name; column-to-term mapping lives in `meta.xml`, not in SQL. |

**Key insight:** The DwC contract is a *string-shaped* contract (column names = DwC term local names). Phase 5's job is to emit columns that Phase 6's `meta.xml` writer can mechanically map by name. Don't introduce per-column metadata tables, lookup helpers, or term-URI columns — they're rebuildable from the column list.

---

## Runtime State Inventory

> N/A — this is a greenfield additive phase: new schema, new views, no rename or migration of existing data. The four pre-existing migrations referenced by CONTEXT.md (`maplify_taxon_mapping`, `maplify_photo_url`, `fix_blank_license`, `occurrences_observed_at_indexes`) are **inputs** read by the projection, not artifacts the planner edits.

For completeness:
- **Stored data:** None modified. `dwc.*` views are read-only over existing source tables. Verified: planner does not insert / update / delete any rows.
- **Live service config:** None. No external services have a "dwc" name registered.
- **OS-registered state:** None. No cron, no Windows scheduler, no launchd plist.
- **Secrets / env vars:** None. The migration commits `rainhead@gmail.com` in plain text per M-04 (intentional and authorised).
- **Build artifacts:** None. `database.types.ts` is generated from the schema and will pick up `dwc.*` views on the next `supabase gen types` run — note this for Phase 6's planner, but not a Phase 5 task.

---

## Common Pitfalls

### Pitfall 1: PostGIS axis swap

**What goes wrong:** `decimalLatitude` and `decimalLongitude` are swapped; the entire archive shows up on land in central Eurasia (~-123°N, 48°E).

**Why it happens:** Off-by-one mental model — geographic intuition says "lat comes first" because of `(lat, lng)` JSON convention. PostGIS WKT is the opposite (`POINT(lon lat)`).

**How to avoid:** Always use `ST_Y` for lat, `ST_X` for lon. Verification §10(c) tests a real Salish Sea point. The existing `public.occurrences` view uses the right convention; Phase 5 mirrors it.

**Warning signs:** Any verification result where lat is outside [-90, 90] or geographically unreasonable (Salish Sea points landing in Asia).

### Pitfall 2: `coordinateUncertaintyInMeters = 0`

**What goes wrong:** GBIF flags the record as having sub-meter precision, which is false.

**Why it happens:** The `public.observations.accuracy` column's CHECK doesn't forbid 0 (it's `INTEGER` without a `> 0` constraint, unlike `count` which has one). If an ingest path stores 0 to mean "unknown", it'll leak through.

**How to avoid:** `NULLIF(o.accuracy, 0)` in the projection. Verification §10(e) enforces.

### Pitfall 3: Fabricating a binomial when only genus or family is known

**What goes wrong:** A row with `taxonRank = 'family'` emits `scientificName = 'Delphinidae sp.'` or `'Delphinidae undet.'`. The string-shaped `scientificName` looks parsable but it's not a real Linnaean name — GBIF's name matcher won't resolve it, and downstream consumers can't tell what was observed at family resolution vs. species resolution.

**Why it happens:** A naïve "always make it look binomial" coercion.

**How to avoid:** `dwc.taxa_classification.scientific_name` is **always** the taxon's own `scientific_name` — never reconstructed. The higher-rank-only CASE in §"Higher-Rank-Only Recursive Walk" is what enforces this. Verification §10(d) asserts.

### Pitfall 4: `UNION ALL` column type drift

**What goes wrong:** `dwc._native_occurrences` emits `count` as `smallint` (from `public.observations.count`), but `dwc._maplify_occurrences` emits it as `integer` (from `maplify.sightings.number_sighted`). `UNION ALL` widens to `integer`, fine. But if one branch emits a `text` and the other an `integer`, Postgres raises at view creation.

**Why it happens:** Forgetting to cast everywhere — e.g., `s.created_at::date` (date) vs `to_char(o.observed_at, …)` (text). Mismatched types in `eventDate` is the most likely.

**How to avoid:** Cast both branches' `eventDate` to `text` explicitly. Cast every numeric to a common type when the source types differ. The view creation will fail loudly if you miss one — that's a feature.

### Pitfall 5: Forgetting `GRANT USAGE ON SCHEMA dwc` to `anon` / `authenticated`

**What goes wrong:** Local Supabase Studio cannot see the schema. Subsequent `supabase gen types` produces no DwC types. Phase 6's nightly DuckDB connection (service-role) works fine, but local dev is blocked.

**Why it happens:** New schemas in Postgres default to NO USAGE for unauthorised roles.

**How to avoid:** Add `GRANT USAGE ON SCHEMA dwc TO anon, authenticated;` after `CREATE SCHEMA`. Add `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated;` at the end of the migration (after the views exist; "ALL TABLES" includes views).

**Note on `extra_search_path`:** `supabase/config.toml:extra_search_path = ["public", "extensions"]`. The `dwc` schema is intentionally NOT in the search path — consumers must qualify (`dwc.occurrences`, never bare `occurrences`). This avoids surprising shadowing with the UI `public.occurrences`.

**Note on Supabase API exposure:** `supabase/config.toml:api.schemas = ["public", "graphql_public"]`. Do NOT add `dwc` to this list. The `dwc` schema is a Phase 7 DuckDB consumer surface, NOT a PostgREST API surface. Adding it would expose all views over PostgREST, which is wrong (and would generate gen-types noise for Phase 8).

### Pitfall 6: `extract_identifiers` returns NULL, not empty array, on no match

**What goes wrong:** `dynamicProperties.unvalidatedIdentifiers` ends up containing `null` literal instead of being omitted.

**Why it happens:** Existing UI view defensively wraps in `COALESCE(extract_identifiers(...), '{}'::varchar[])` — but for `dynamicProperties` we want the OPPOSITE: keep it NULL so `jsonb_strip_nulls` drops the key.

**How to avoid:** Do NOT COALESCE inside `jsonb_build_object`. Let NULL propagate; `jsonb_strip_nulls` handles it.

### Pitfall 7: `s.created_at` is `timestamp` (no tz), `o.observed_at` is `timestamptz`

**What goes wrong:** Time-zone confusion. Maplify's `created_at` is a timezone-naive timestamp stored as GMT (per the existing UI view's `AT TIME ZONE 'GMT'` treatment). Native's `observed_at` is timezone-aware.

**Why it happens:** Different source ingest patterns.

**How to avoid:** Maplify branch always uses `AT TIME ZONE 'GMT'` before `::date::text`. Native uses `AT TIME ZONE 'UTC'` before `to_char`. Both produce text in UTC; neither emits a local-time `eventDate`.

---

## Code Examples

> Verified patterns from the existing codebase + the recommended Phase 5 idioms.

### `WITH RECURSIVE` ancestor walk

See §"Higher-Rank-Only Recursive Walk" above. Pattern is standard Postgres 17.

### `jsonb_build_object` with omit-when-null

```sql
-- Source: standard Postgres 17 pattern; no external citation needed.
SELECT jsonb_strip_nulls(jsonb_build_object(
  'a', NULL,            -- dropped
  'b', 'value',         -- kept
  'c', NULL             -- dropped
));
-- Returns: {"b": "value"}
```

### Source mapping via `CROSS JOIN LATERAL`

```sql
FROM maplify.sightings s
JOIN dwc.taxa_classification tc ON tc.taxon_id = s.taxon_id
CROSS JOIN LATERAL (
  SELECT
    CASE s.source
      WHEN 'orca_network' THEN 'Orca Network'
      WHEN 'cascadia'     THEN 'Cascadia Research Collective'
      ELSE 'Whale Alert / Maplify'
    END AS display_name
) AS dn
```

### Single-row dataset `VALUES`-backed view (M-03)

```sql
-- Source: M-03 idiom. Each new constituent is a one-line VALUES row + redeploy.
CREATE VIEW dwc.datasets AS
SELECT * FROM (VALUES
  (
    'https://salishsea.io/datasets/occurrences-v1'::text,                          -- dataset_id
    NULL::text,                                                                    -- parent_dataset_id
    'SalishSea.io Cetacean Occurrences (v1.2)'::text,                              -- title
    'Native and Maplify/Whale Alert cetacean sighting records …'::text,            -- abstract (planner to author; Phase 6 may refine)
    CURRENT_DATE::text,                                                            -- pub_date  (or a constant date; planner picks)
    'en'::text,                                                                    -- language
    'https://creativecommons.org/licenses/by-nc/4.0/legalcode'::text,              -- intellectual_rights
    'SalishSea.io'::text,                                                          -- creator_name
    'rainhead@gmail.com'::text,                                                    -- creator_email (M-04)
    'originator'::text,                                                            -- creator_role
    'SalishSea.io'::text,                                                          -- metadata_provider_name
    'rainhead@gmail.com'::text,                                                    -- metadata_provider_email
    'Peter Abrahamsen'::text,                                                      -- contact_name
    'rainhead@gmail.com'::text,                                                    -- contact_email  (M-04)
    'pointOfContact'::text,                                                        -- contact_role
    NULL::text,                                                                    -- geographic_coverage (Phase 6 authors)
    NULL::text,                                                                    -- temporal_coverage  (Phase 6 computes at generation)
    'Cetacea (Order)'::text,                                                       -- taxonomic_coverage
    NULL::text                                                                     -- methods (Phase 6 authors)
  )
) AS d (
  dataset_id, parent_dataset_id, title, abstract, pub_date, language,
  intellectual_rights, creator_name, creator_email, creator_role,
  metadata_provider_name, metadata_provider_email,
  contact_name, contact_email, contact_role,
  geographic_coverage, temporal_coverage, taxonomic_coverage, methods
);
```

POLICY §6.7 explicitly leaves `title`, `abstract`, `methods`, `geographic_coverage`, `slug`, etc. for Phase 6. The Phase 5 migration commits whatever placeholders or partial values seem defensible; Phase 6 will edit through a new migration. This is the M-03 contract (every edit is a migration).

### Per-photo license CASE

See §"`license_code` CASE Pattern" above.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| App-code mapping over a UI matview | Dedicated `dwc` schema with views directly over source tables | This phase | Phase 5 owns the DwC contract; serialiser becomes a thin COPY. |
| String-concat JSON building | `jsonb_build_object` + `jsonb_strip_nulls` | Postgres 9.5+ (long stable) | Idiomatic, safer escaping. |
| Manual ancestor self-join | `WITH RECURSIVE` | Postgres 8.4 (long stable) | Simpler code; handles variable-depth trees. |

**Deprecated/outdated:**
- "Use `to_char(ts, 'YYYY-MM-DD HH24:MI:SS')` for ISO-8601" — the space delimiter is not strict ISO-8601. Use `"T"` literal in the format string.
- "DwC-A archives can use `eventDate` in observer's local timezone" — historically allowed but the strong convention since GBIF 2020+ is UTC or explicit offset; emit Z-suffixed UTC.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | iNaturalist-specific rank values (`complex`, `epifamily`, `zoosection`, etc.) are accepted by GBIF's `taxonRank` parser as soft-flagged but not rejected | §"`inaturalist.rank` → DwC vocabulary" | If GBIF rejects, archive validation in Phase 6 fails. Mitigation: validator run in Phase 6 will surface this; Phase 5 can revisit with a CASE that maps to closest-recognised value. Low risk because no in-scope (Cetacea) taxa will have ranks below `subspecies` or above `superfamily` in practice. |
| A2 | `inaturalist.taxa.parent_id` is acyclic | §"Higher-Rank-Only Recursive Walk" | If cyclic, `WITH RECURSIVE` infinite-loops. Mitigation: the schema's self-FK constraint prevents inserting a row whose `parent_id` doesn't exist; cycles would have to be deliberately created. A `WHERE depth < 50` guard is cheap insurance — recommend adding. |
| A3 | `s.created_at` (Maplify) being stored in GMT is correct semantically — verified the existing UI view uses `AT TIME ZONE 'GMT'` | §"ISO-8601 eventDate" | If the upstream API actually returns a different timezone, dates near midnight UTC could be off by one day. The existing UI view has this same risk; Phase 5 mirrors it. |
| A4 | All native `public.observation_photos.license_code` values today are members of `public.license` enum (matching the `cc-by`, `cc-by-nc`, `cc0`, etc. set) plus possibly `'none'` | §"`license_code` CASE Pattern" | If unknown string values exist, the CASE's `ELSE NULL` branch will silently exclude them. Mitigation: a Phase 5 verification SQL can list distinct values: `SELECT DISTINCT license_code FROM public.observation_photos;` — planner runs this before finalising the migration. |
| A5 | `rwsas` rows do not exist in `maplify.sightings` because the ingest function filters them out (`WHERE source != 'rwsas'`) | §"Architecture diagram" filter list | If rows leak through, they get attributed to `'Whale Alert / Maplify'` (the `ELSE` branch of the source CASE). Mitigation: verify via the §"Cheap probes" section below and only add the `WHERE source != 'rwsas'` if any are found. |

**If any of A1–A5 prove wrong:** the planner adds a discuss-phase checkpoint before the corresponding code is written.

---

## Open Questions

### 1. `maplify.source` distinct values — how does the planner obtain the list?

**What we know:**
- POLICY §2.2 Assumption A2 says query `SELECT DISTINCT source FROM maplify.sightings` before encoding the mapping table.
- The repo does **not** include a snapshot or fixture file containing the source list.
- Local `supabase db reset` produces an empty database (no production data).
- Confirmed: `supabase/seed.sql` is the only seed, and it doesn't include `maplify.sightings` rows.

**What's unclear:** Whether the planner is expected to query production directly, or whether a local fixture exists somewhere.

**Recommendation — cheapest path:** The orchestrator inserts a `[BLOCKING]` task at the top of the plan: "Run `SELECT DISTINCT source FROM maplify.sightings;` against production (read-only) and paste the result here." The query is dirt-cheap (< 100ms) and the result lists a handful of distinct values. The planner then encodes the CASE with the verified list and falls back to `'Whale Alert / Maplify'` for any unmatched value (defensive default per POLICY §2.2).

Alternatively (acceptable but slower): plan with the assumed-good list (`orca_network`, `cascadia`) plus `ELSE 'Whale Alert / Maplify'`, and accept that any unrecognised source code in production will fall to the `ELSE` branch. Phase 7's first nightly run will surface the gap.

### 2. `rwsas` rows audit

**What we know:** `maplify.update_sightings` includes `WHERE source != 'rwsas'` at ingest. The intent is that no `rwsas` rows exist in production.

**What's unclear:** Whether the filter has always been in place, or whether legacy rows pre-date it.

**Recommendation — cheapest path:** Combine with Open Question 1: when the planner runs `SELECT DISTINCT source FROM maplify.sightings;` against production, the result transparently shows whether `rwsas` appears. If yes, the Maplify branch must add `AND source != 'rwsas'` to its WHERE. If no, the predicate is unnecessary (but adding it preemptively as belt-and-suspenders is harmless and inexpensive).

**Default recommendation:** Add `AND source != 'rwsas'` unconditionally to the Maplify branch. It's a free correctness guard, matches the ingest filter exactly, and self-documents POLICY §5.3.

### 3. `database.types.ts` regeneration

**What we know:** The repo includes `database.types.ts` (TypeScript types generated from Supabase). Adding a new schema produces new types.

**What's unclear:** Whether Phase 5 owns the regeneration (run `supabase gen types typescript --local`) or Phase 6/8 do.

**Recommendation:** Phase 5 does NOT regenerate `database.types.ts`. The `dwc` schema is consumed by Phase 7's nightly job via DuckDB, not by the app runtime. Adding `dwc` types to the TS file would be churn the frontend doesn't use. Phase 8 (frontend download link) does not call `dwc.*` views directly (per CONTEXT.md `<code_context>` line 144). If a downstream phase needs the types, that phase can regenerate.

### 4. Should `dwc.taxa_classification` carry `vernacular_name`?

**What we know:** DwC has `vernacularName` (not commonly in the Occurrence core, but optional). M-05's contract says columns are `taxon_id, taxon_rank, kingdom, …, scientific_name`. No `vernacular_name`.

**Recommendation:** Don't add it in v1.2. Out of scope per M-05. If Phase 6 wants it, Phase 5 can extend in a follow-up migration.

---

## Environment Availability

> Phase 5 is code-only (one .sql migration) plus a `psql` verification harness.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 17 (local Supabase) | All Phase 5 work | ✓ (per `supabase/config.toml`) | 17 | — |
| PostGIS extension | View definitions | ✓ (installed in initial migration) | bundled with PG 17 | — |
| Supabase CLI | `supabase db reset` for local validation | Likely ✓ (project uses Supabase) | Verify with `supabase --version` | Use `psql` directly to apply migration |
| `psql` | Running verification assertions | ✓ (system or bundled with Supabase CLI) | — | — |
| Local DB on port 54322 | Verification harness target | Verify with `supabase status` | — | If unavailable, run `supabase start` first |
| Production DB read access | Open Questions 1 & 2 (DISTINCT source audit) | unknown — user has DB credentials | — | Defensive defaults: assume orca_network/cascadia, add `rwsas` filter unconditionally |

**Missing dependencies with no fallback:** None blocking. The Open Questions 1 / 2 require production read access OR defensive defaults.

**Missing dependencies with fallback:** Production DB access — defensive defaults work; nightly Phase 7 will surface gaps.

---

## Migration Filename

Most recent migration is `20260610001507_occurrences_observed_at_indexes.sql`. Today is 2026-06-17. Recommended new filename:

```
supabase/migrations/20260617XXXXXX_dwc_schema.sql
```

Where `XXXXXX` is whatever timestamp suffix the planner picks at write-time (e.g., `20260617203900`). Any value > `20260610001507` in lexicographic order works; Supabase migrations sort by filename.

**Suggested concrete value:** `20260617203900_dwc_schema.sql` (8:39 PM UTC on the research date).

---

## Local Verification Harness

> Item 11: where to put the assertion SQL.

**Project conventions inspection:**
- `supabase/snippets/` exists (verified: `ls supabase/` returns `config.toml, migrations, seed.sql, snippets`).
- The `snippets/` directory is empty at research time (`ls supabase/snippets/` returns nothing).
- The project has no `tests/` directory at the root.
- The project has no Postgres test framework (no pgTAP, no Postgres-side test harness).

**Recommendation:** Place the assertion script at `supabase/snippets/05_dwc_assertions.sql`. Rationale:
1. `snippets/` already exists as a project convention.
2. Phase 5 is SQL-only — a SQL script in `supabase/snippets/` matches the discipline of the rest of the supabase/ tree.
3. Running it is one command: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/snippets/05_dwc_assertions.sql`.

**Script structure (skeleton):**
```sql
\set ON_ERROR_STOP on
\echo === Phase 5 DwC projection verification ===

\echo ALIGN-02: four required terms NOT NULL
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences
    WHERE "occurrenceID" IS NULL OR "basisOfRecord" IS NULL
       OR "scientificName" IS NULL OR "eventDate" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'ALIGN-02 FAIL: % rows missing required terms', n;
  END IF;
END $$;

-- ... (one block per row in §"Phase Requirements → Test Map" above)

\echo === All assertions passed ===
```

`\set ON_ERROR_STOP on` halts on the first `RAISE EXCEPTION`, so the script fails loud and fast.

**`/gsd-verify-work` integration:** The orchestrator runs the script after `supabase db reset`. Exit code = 0 → green; non-zero → red. No JSON parsing needed.

---

## Schema Push Command for Local Dev

> Item 15: what should the orchestrator inject as a `[BLOCKING]` task?

**Locked-in commands (per Supabase 2025+ CLI):**

| Action | Command | Notes |
|--------|---------|-------|
| Re-apply ALL migrations (clean DB) | `supabase db reset` | Drops local DB, re-runs every migration in `supabase/migrations/`, runs `seed.sql`. Slow (~30s) but the cleanest. |
| Apply only **new** migrations (incremental) | `supabase db push --local` | Faster; applies any migrations not yet recorded in `supabase_migrations.schema_migrations`. |
| Apply a single new migration manually | `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/migrations/{ts}_dwc_schema.sql` | Bypasses Supabase's migration tracking. Useful for iterating during dev; do NOT rely on this for the final pass. |

**Recommendation for `/gsd-execute-phase`:**

Insert as a `[BLOCKING]` task immediately after the migration is written:

```bash
supabase db reset
```

Rationale:
1. Clean state — confirms the migration applies from scratch (`db push --local` would apply against whatever state exists, which can mask ordering bugs).
2. Required for `database.types.ts` regeneration if Phase 5 ever opts in (it doesn't, per Open Question 3).
3. Required before the `psql -f supabase/snippets/05_dwc_assertions.sql` verification step.

**Considerations for adding a new schema:**

- **RLS defaults:** Postgres doesn't apply RLS to views — RLS is a table-level concern, and `dwc.*` are all views. The underlying tables (`public.observations`, `public.contributors`, `inaturalist.taxa`, `maplify.sightings`) all have RLS enabled with `SELECT` policies allowing `anon`. So `dwc.*` will be readable per the underlying RLS. No explicit RLS work needed on `dwc.*`.
- **Grants:** `CREATE SCHEMA dwc; GRANT USAGE ON SCHEMA dwc TO anon, authenticated;` at the top of the migration. After view creation, `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated;` ("ALL TABLES" includes views).
- **search_path:** Do NOT add `dwc` to `extra_search_path` in `config.toml`. Consumers must fully-qualify (`dwc.occurrences`), preventing accidental shadowing.
- **API exposure:** Do NOT add `dwc` to `[api].schemas` in `config.toml`. The `dwc` schema is a database-internal contract for Phase 7's DuckDB consumer, not a REST API surface.

---

## Sources

### Primary (HIGH confidence)

- **Codebase itself** (all `[VERIFIED: codebase]` claims):
  - `supabase/migrations/20250903172708_initial_schema.sql` — base schema, `inaturalist.rank` enum, `public.taxon`, `public.travel_direction`, `public.extract_travel_direction`, `gis` schema setup.
  - `supabase/migrations/20250915171505_sighting_policies.sql` — the rename of `public.sightings` → `public.observations`, of `sighting_photos` → `observation_photos`.
  - `supabase/migrations/20260204013006_sightings_uses_contributors.sql` — contributor join shape (current `public.observations.contributor_id` FK).
  - `supabase/migrations/20260203234153_individuals.sql` — `public.contributors` table definition.
  - `supabase/migrations/20250921045207_photo_licensing.sql` — `DROP NOT NULL` on iNaturalist (NOT native).
  - `supabase/migrations/20251027062024_fix_blank_license.sql` — iNaturalist license handling (does not alter `public.observation_photos`).
  - `supabase/migrations/20250924160210_detect_individuals.sql` — `public.extract_identifiers` function.
  - `supabase/migrations/20250919034327_fix_maplify_taxon_mapping.sql` — Maplify ingest shape, `WHERE source != 'rwsas'` filter, `gis.ST_Point(longitude, latitude)` axis convention.
  - `supabase/config.toml` — PostgreSQL 17, port 54322, `extra_search_path = ["public", "extensions"]`.
- **`.planning/phases/04-rights-data-model-policy-gate/04-POLICY.md`** — the authoritative encoding contract. Every D-NN cited inline.
- **TDWG DwC term list** — https://dwc.tdwg.org/list/ — canonical term URIs and definitions [CITED].
- **GBIF taxonomic rank vocabulary** — https://rs.gbif.org/vocabulary/gbif/rank.xml — lowercase identifiers, permissive vocabulary [CITED].
- **GBIF Simple Multimedia extension** — https://rs.gbif.org/extension/gbif/1.0/multimedia.xml — column set and DC term URIs [CITED].

### Secondary (MEDIUM confidence)

- PostGIS `ST_X` / `ST_Y` semantics — confirmed by codebase usage AND by the OGC SFA convention. Reproducible against any PostGIS install.
- ISO-8601 `eventDate` acceptance by GBIF — cited from DwC quick reference example forms; not formally cross-verified against the GBIF parser source code.

### Tertiary (LOW confidence)

- A1: iNaturalist-specific rank values accepted by GBIF — based on GBIF's documented permissive parsing posture; not tested against the validator. Phase 6 GBIF validator run will confirm.

---

## Project Constraints (from CLAUDE.md and MEMORY.md)

> Inline-relevant constraints from the user's project-level instructions and persistent memory.

- **Pushes to `main` auto-deploy to production** via `.github/workflows/deploy.yml` (per `MEMORY.md`). Phase 5 is a Supabase migration, which does NOT touch the GitHub Actions deploy — but it DOES need to be applied to the production database. **Implication for the planner:** Surface to the user *before* push whether Phase 5's migration should be applied to production now (cleanest) or held until Phase 6's verifier exists. Don't blindly push.
- **`supabase db reset` is destructive locally.** Use confidently in dev. Verification harness assumes a fresh local DB.
- **No new env vars required.** The migration commits `rainhead@gmail.com` in plain text by intent (M-04). No GitHub Actions secret introduction.
- **README discipline.** The repo's READMEs (if any reference the DB schema) should not need updating for Phase 5 — the schema is additive and read-only. But the `database.types.ts` will not be regenerated by Phase 5 (see Open Question 3).
- **No `--break-system-packages` / no global pip / no `npx --yes`** discipline. N/A — Phase 5 has no Node/Python installs.
- **`orcasound` AWS profile** (per MEMORY.md). N/A for Phase 5 (no AWS calls).

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — single migration, no new packages, all SQL features stable since PG 8.4 / 9.5.
- DwC column specification: HIGH — TDWG quick reference + GBIF doc fetched and cited.
- Architecture patterns: HIGH — locked by M-01..M-05 + codebase precedent (existing `public.occurrences` shape).
- Higher-rank-only recursive walk: HIGH — established `WITH RECURSIVE` pattern, codebase has no precedent here but the SQL is standard.
- PostGIS axis: HIGH — verified in codebase (multiple migrations consistently use `ST_X = lon, ST_Y = lat`).
- `dynamicProperties` JSON: HIGH — `jsonb_strip_nulls` is idiomatic.
- License CASE: HIGH on the URI mapping (POLICY §1.2 verbatim), MEDIUM on the NULL branch (Discrepancy 2 flags an inconsistency between POLICY wording and schema reality — recommendation is to honour POLICY as forward-compatibility).
- Multimedia view shape: HIGH — DwC-A `coreId` requirement (DWCA-03) forces the separate-view pattern.
- Verification queries: HIGH — all are direct translations of the ALIGN-NN requirements.
- Maplify source mapping: MEDIUM — depends on Open Question 1 (planner verifies DISTINCT source against production).
- iNaturalist rank vocabulary accepted by GBIF: LOW (A1) — relies on GBIF being permissive; Phase 6 validator confirms.

**Research date:** 2026-06-17
**Valid until:** ~2026-07-17 (30 days; the DwC standard and GBIF vocabulary are stable; codebase facts are checked against migrations at HEAD).
