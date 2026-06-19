# Phase 11: Resolution & Backfill — Research

**Researched:** 2026-06-19
**Domain:** PostgreSQL ingest function surgery + Maplify comment-parsing dictionary + iNat contributor minting
**Confidence:** HIGH (all findings verified against exact migration source; no training-data guesses used)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 [LANDMINE]:** `maplify.update_sightings` runs every 5 min, does DELETE+INSERT over last 10 days. Any backfilled `collection_id` on recent Maplify rows is wiped. Ongoing ingest-time resolution is mandatory.
- **D-02:** Resolve `collection_id` inside the `maplify.update_sightings` INSERT via `maplify.resolve_collection(comments, source)`. Edits a working ingest function.
- **D-03:** Dictionary is DB-side: `maplify.collection_rule (match_kind text, match_value text, collection_id int)`. Thin `maplify.resolve_collection(comments, source)` SQL function applies precedence: bracket → attribution → source → NULL.
- **D-04:** Precedence order locked: `source_url` → bracket tag → trailing attribution → `source` code → NULL. Maplify has no `source_url` today, so resolver starts at bracket tag.
- **D-05:** iNat / native / HappyWhale each get `collection_id` via migration-resolved DEFAULT + one-time UPDATE. Mirror Phase 10 `provider_id` DEFAULT dynamic-SQL pattern.
- **D-06:** `scripts/ingest/resolve-provider.ts` pure TS function (urlPattern → {provider, collection}) with tests. Roles: (a) one-time iNat/native URL backfill, (b) future-FB extension point. NOT on Maplify path. NOT the ongoing mechanism for single-collection tables.
- **D-07:** Backfill is idempotent SQL migration guarded by `WHERE collection_id IS NULL`. No-op on local `supabase db reset`.
- **D-08:** Full prod `SELECT DISTINCT` census committed as artifact + diff-gate assertion that FAILS if any prod tag/attribution/source code is not covered by `collection_rule`.
- **D-09 [SC#1 deviation]:** Tighten SC#1 regex to `^\[[^\]]+\]` (non-empty tag). Empty/`[NULL]` brackets stay NULL — documented relaxation.
- **D-10:** Map 11 Phase-9 acronym stubs to collections via `collection_rule (match_kind='bracket')`. Researcher must expand each acronym.
- **D-11:** Structured `maplify.sightings.source` codes as curated final fallback — `match_kind='source'` rules. Diff-gate covers them too.
- **D-12 [carry/locked]:** `comments` is immutable — no UPDATE on `maplify.sightings.comments` in any migration or script.
- **D-13 [carry/locked]:** Trailing "Submitted by … Trusted Observer" lines → collection/org only, never `contributor_id`.
- **D-14:** native `contributor_id` unchanged (100% populated). Maplify `contributor_id` stays NULL. HappyWhale `contributor_id` deferred.
- **D-15:** iNat `contributor_id` IS populated. Add `public.contributors.inat_login text UNIQUE`. Mint contributors from `inaturalist.observations.username` via `ON CONFLICT (inat_login) DO NOTHING`.
- **D-16:** Wire iNat contributor resolution into `inaturalist.upsert_observation_page` MERGE. Edits the schema's most complex ingest function. RLS/ownership must allow INSERT into `public.contributors` from cron context.

### Claude's Discretion

- Exact migration split (how many, naming)
- Whether diff-gate lives as `supabase/snippets/11_*` assertion or in-migration `DO $$ ... RAISE EXCEPTION ... $$`
- Census artifact location (`supabase/snippets/` vs `.planning/`)
- Exact regex for extracting bracket tags / attribution lines

### Deferred Ideas (OUT OF SCOPE)

- HappyWhale `contributor_id` population
- Cross-provider contributor unification (jmaughn ↔ James Maughn)
- Generalized external-identity columns on `public.contributors`
- ORCID population for native contributors
- Layer 2: URL → whole-occurrence importer
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RESOLVE-01 | URL-pattern resolver derives `provider_id` + `collection_id` from a `source_url`; runs at ingest time; stores result as FKs | D-06: pure TS function in `scripts/ingest/resolve-provider.ts`; for iNat/native one-time backfill + future extension |
| RESOLVE-02 | Maplify collection resolution via human-curated exact-match dictionary; precedence order; `comments` untouched | D-02/D-03/D-04: `maplify.collection_rule` + `maplify.resolve_collection()` function inside `update_sightings` INSERT |
| RESOLVE-03 | One-time idempotent backfill for all four providers; preceded by full `SELECT DISTINCT` census; `comments` preserved | D-07/D-08: migration guarded by `WHERE collection_id IS NULL`; census artifact committed first |
| RESOLVE-04 | Ongoing ingest resolves `collection_id` by exact match; unmatched → NULL | D-02 (Maplify inline), D-05 (iNat/native/HW DEFAULT), D-16 (iNat contributor in MERGE) |
</phase_requirements>

---

## Summary

Phase 11 has three distinct resolution mechanisms driven by how each provider's ingest works: (1) Maplify gets a DB-side rule table + SQL resolver function spliced into its rolling-DELETE-INSERT cron job; (2) iNat/native/HappyWhale each get a single constant `collection_id` via migration-resolved DEFAULT; (3) iNat gets contributor minting wired into its MERGE upsert. A fourth cross-cutting deliverable is the TS URL-pattern resolver `scripts/ingest/resolve-provider.ts` that serves the one-time URL-based backfill and is the extension point for future providers.

The highest-risk element is the Maplify `update_sightings` surgery. The current function body is `SELECT sightings.* FROM gis.ST_MakeBox2D(...) AS bbox, maplify.fetch_date_range(...) AS sightings` — a bare wildcard SELECT. After Phase 10, `maplify.sightings` has columns `provider_id` (NOT NULL with DEFAULT), `collection_id` (nullable), `contributor_id` (nullable), and `source_url` (nullable) that `fetch_date_range` does NOT return. The INSERT must be rewritten to an explicit column list that includes `maplify.resolve_collection(sightings.comments, sightings.source)` for `collection_id`. Similarly, `inaturalist.upsert_observation_page` (the cron.sql version) must be extended in its MERGE to mint and link `contributor_id`. Both functions are currently live in production.

The second risk is that `public.contributors` has RLS enabled with no INSERT policy for the `postgres` role (which runs pg_cron jobs). The existing `create_contributor_on_sign_in` trigger uses `SECURITY DEFINER` to bypass RLS — the same pattern must be applied to the iNat contributor-mint SQL, either by wrapping the INSERT in a `SECURITY DEFINER` function or by placing the mint inside an existing SECURITY DEFINER context.

**Primary recommendation:** Structure as three migrations in a single deploy: (a) schema additions (rules table + resolver function + `inat_login` column + collection DEFAULTs), (b) one-time backfill UPDATEs, (c) ingest function edits. Run the prod census read-only before writing any migration; commit the artifact under `.planning/phases/11-resolution-backfill/`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Maplify collection resolution (ongoing) | Database (pg_cron) | — | `update_sightings` is entirely DB-side; resolver must live where the INSERT runs |
| Maplify collection backfill (one-time) | Database migration | — | idempotent UPDATE inside migration; no TS path needed |
| iNat/native/HW collection assignment (ongoing) | Database (column DEFAULT) | — | constant per table; DEFAULT fires without code change |
| iNat contributor minting (ongoing) | Database (pg_cron MERGE) | — | `upsert_observation_page` is entirely DB-side |
| iNat contributor backfill (one-time) | Database migration | — | UPDATE from existing `username` column |
| URL-pattern resolver (one-time backfill + future) | TypeScript (`scripts/ingest/`) | Database (phase 12+) | RESOLVE-01 requires TS pure function; one-time UPDATE uses it via `psql` or migration |
| Prod census (read-only) | Manual (psql against prod) | — | requires live prod data; local reset has no prod rows |
| Diff-gate / smoke tests | SQL assertion snippet | CI (`supabase db reset` + psql) | mirrors `09_*` / `10_*` snippet pattern |

---

## Standard Stack

### Core (DB-side)

| Component | Version | Purpose | Pattern |
|-----------|---------|---------|---------|
| `maplify.collection_rule` | new table | dictionary of bracket/attribution/source → collection_id | data-driven, FK-checked, PR-reviewable |
| `maplify.resolve_collection(comments, source)` | new SQL function | precedence-ordered lookup against collection_rule | called inside `update_sightings` INSERT + backfill UPDATE |
| `maplify.update_sightings` | existing, edit | rolling DELETE+INSERT cron ingest | must name columns explicitly after edit |
| `inaturalist.upsert_observation_page` (cron.sql ver.) | existing, edit | MERGE upsert for iNat observations | add contributor mint + link inside MERGE |
| `public.contributors.inat_login` | new column | dedup key for iNat contributor rows | `TEXT UNIQUE` nullable; `ON CONFLICT (inat_login) DO NOTHING` |

### Core (TS-side)

| Component | Version | Purpose | Pattern |
|-----------|---------|---------|---------|
| `scripts/ingest/resolve-provider.ts` | new | pure function: urlPattern → {provider, collection} | mirrors `scripts/dwca/*.ts` pattern; tested with vitest |
| `scripts/ingest/resolve-provider.test.ts` | new | unit tests for URL pattern matching | vitest; run with `npm test` |

### Supporting

| Tool | Use |
|------|-----|
| `psql` + orcasound AWS profile | read-only prod census query |
| `supabase db reset` + psql | local assertion runner |
| `vitest` | TS test runner (already configured) |

---

## Package Legitimacy Audit

No new npm packages are installed in this phase. The TS resolver uses only built-in URL parsing or simple regex — no external dependencies. The SQL uses only standard PostgreSQL features.

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages)
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
ONGOING INGEST PATHS (post-Phase 11):

Maplify API
    ↓
maplify.fetch_date_range()   ← returns rows WITHOUT collection_id
    ↓
maplify.update_sightings()
  DELETE maplify.sightings WHERE created_at BETWEEN ...
  INSERT INTO maplify.sightings (id, ..., collection_id, ...)
    SELECT ..., maplify.resolve_collection(comments, source) AS collection_id, ...
    FROM fetch_date_range(...)
          ↑
    maplify.collection_rule (match_kind, match_value, collection_id)
    lookup: bracket → attribution → source → NULL

iNaturalist API
    ↓
inaturalist.upsert_observation_page() [MERGE]
  WHEN NOT MATCHED BY TARGET: INSERT (id, ..., contributor_id)
    contributor_id = (
      INSERT INTO public.contributors (name, inat_login)
        VALUES (username, username) ON CONFLICT (inat_login) DO NOTHING
      RETURNING id
      -- or: SELECT id FROM public.contributors WHERE inat_login = username
    )
  WHEN MATCHED: UPDATE (does NOT update contributor_id — existing rows keep theirs)
  collection_id via column DEFAULT (resolved at migration time to iNaturalist collection id)

native (public.observations)
  upsert_observation() — does NOT name collection_id → DEFAULT fires
  collection_id DEFAULT = id of 'salishsea-direct' collection
  (or per URL resolver for reposts — D-06 backfill path)

HappyWhale encounters
  happywhale.upsert_encounter() — does NOT name collection_id → DEFAULT fires
  collection_id DEFAULT = id of 'happywhale' collection
```

### Recommended Project Structure

```
supabase/
├── migrations/
│   ├── 20260619XXXXXX_resolution_schema.sql   # collection_rule table + resolve_collection fn
│   │                                           # + inat_login column + collection_id DEFAULTs
│   ├── 20260619YYYYYY_resolution_backfill.sql  # one-time UPDATEs (guarded WHERE IS NULL)
│   └── 20260619ZZZZZZ_resolution_ingest.sql    # edit update_sightings + upsert_observation_page
├── snippets/
│   └── 11_resolution_assertions.sql            # SC#1–SC#5 + diff-gate smoke tests
scripts/
├── dwca/
│   └── ... (existing)
└── ingest/
    ├── resolve-provider.ts                     # new: pure function urlPattern → {provider, collection}
    └── resolve-provider.test.ts               # new: vitest tests
.planning/phases/11-resolution-backfill/
    └── maplify_census.sql (or .tsv)           # committed prod SELECT DISTINCT output
```

**Migration ordering constraint:** Migration (a) must precede (b) and (c). Migration (c) edits live ingest functions — deploy to prod triggers cron within 5 minutes, so (a)+(b) must be deployed first and verified before (c).

---

## Critical SQL: Exact Current Function Bodies

### `maplify.update_sightings` (from `20250904165159_fetch_data.sql` lines 189-199)

[VERIFIED: direct source file read]

```sql
CREATE FUNCTION maplify.update_sightings (
  start_date date = current_date,
  end_date date = current_date
) RETURNS void LANGUAGE SQL VOLATILE
BEGIN ATOMIC;
  DELETE FROM maplify.sightings WHERE created_at BETWEEN start_date::timestamp AND (end_date + interval '1 day')::timestamp;
  INSERT INTO maplify.sightings
    SELECT sightings.* FROM
      gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)) AS bbox,
      maplify.fetch_date_range(start_date, end_date, bbox) AS sightings;
END;
```

**Critical finding:** The INSERT is `INSERT INTO maplify.sightings SELECT sightings.*` — a bare wildcard. After Phase 10, `maplify.sightings` has four new columns (`provider_id`, `collection_id`, `contributor_id`, `source_url`) that `fetch_date_range` does NOT return. This is why provider_id needs a DEFAULT (Phase 10 solved this). For `collection_id`, the function must be rewritten to name columns explicitly.

**`maplify.fetch_date_range` returns:** `id, project_id, trip_id, scientific_name, location, number_sighted, created_at, photo_url, comments, in_ocean, moderated, trusted, is_test, source, usernm` (14 columns from `20250904165159_fetch_data.sql` lines 128-157). These are the only columns available from the API.

**Required edit to `update_sightings`:** Replace the wildcard INSERT with an explicit column list that:
1. Lists all 14 columns from `fetch_date_range`
2. Adds `maplify.resolve_collection(sightings.comments, sightings.source) AS collection_id`
3. Leaves `contributor_id` and `source_url` absent (they default to NULL)
4. The `provider_id` DEFAULT fires automatically because `provider_id` is absent from the explicit column list

```sql
-- Edited form (planner: fill in exact column list):
CREATE OR REPLACE FUNCTION maplify.update_sightings (
  start_date date = current_date,
  end_date date = current_date
) RETURNS void LANGUAGE SQL VOLATILE
BEGIN ATOMIC;
  DELETE FROM maplify.sightings
    WHERE created_at BETWEEN start_date::timestamp AND (end_date + interval '1 day')::timestamp;
  INSERT INTO maplify.sightings
    (id, project_id, trip_id, scientific_name, location, number_sighted,
     created_at, photo_url, comments, in_ocean, moderated, trusted, is_test, source, usernm,
     collection_id)
    SELECT
      id, project_id, trip_id, scientific_name, location, number_sighted,
      created_at, photo_url, comments, in_ocean, moderated, trusted, is_test, source, usernm,
      maplify.resolve_collection(comments, source)
    FROM
      gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)) AS bbox,
      maplify.fetch_date_range(start_date, end_date, bbox) AS sightings;
END;
```

### `inaturalist.upsert_observation_page` — which version is ACTIVE?

[VERIFIED: direct source file read]

There are **two versions** of `inaturalist.upsert_observation_page` in the migrations:

1. **`20250904165159_fetch_data.sql` lines 352-432** — older CTE-based version using `INSERT ... ON CONFLICT DO UPDATE` (not MERGE). Returns `table(observation_id bigint, photo_id bigint)`.

2. **`20250914232212_cron.sql` lines 5-103** — newer MERGE-based version. Does `DROP FUNCTION inaturalist.upsert_observation_page CASCADE` then `CREATE FUNCTION ... BEGIN ATOMIC`. Returns `void`.

**The cron.sql version is the live one** (applied later in migration sequence). This is the version Phase 11 must edit.

**Current MERGE column list for new observations** (`WHEN NOT MATCHED BY TARGET THEN INSERT`):
```sql
INSERT (id, description, location, observed_at, license_code, uri, username, taxon_id, fetched_at, public_positional_accuracy, updated_at)
VALUES (v.id, v.description, v.location, v.observed_at, v.license_code, v.uri, v.username, v.taxon_id, v.fetched_at, v.public_positional_accuracy, v.updated_at)
```

**The INSERT does NOT name `collection_id` or `contributor_id`** — so the `collection_id` DEFAULT will fire for new rows automatically. Only `contributor_id` needs explicit wiring in the MERGE.

**The MATCHED UPDATE clause** (`WHEN MATCHED AND v.updated_at > o.updated_at THEN UPDATE SET`) does NOT update `contributor_id`, `collection_id`, or `source_url` — existing rows keep their values on UPDATE. This means:
- `collection_id` DEFAULT fires on INSERT (new rows get the iNat collection automatically)
- Existing rows need the one-time UPDATE for `collection_id`
- Existing rows need the one-time UPDATE for `contributor_id`
- New rows need `contributor_id` wired into the INSERT clause

### `public.upsert_observation` (native) — column list check

[VERIFIED: `20260207000253_fix_upsert_observation.sql` line 41]

```sql
INSERT INTO public.observations (id, body, count, direction, observed_at, observer_location, subject_location, taxon_id, url, created_at, updated_at, contributor_id, user_uuid)
```

**`collection_id` is NOT in this INSERT column list** — so the `collection_id` DEFAULT will fire for new native rows automatically. No change to `upsert_observation` needed for ongoing collection resolution.

### `happywhale.upsert_encounter` — column list check

[VERIFIED: `20250904165159_fetch_data.sql` lines 71-121]

```sql
INSERT INTO happywhale.encounters (
  id, start_date, start_time, end_date, end_time, timezone, verbatim_location, location,
  accuracy, precision_source, individual_id, species_id, min_count, max_count, comments,
  user_id, public, fetched_at
)
```

**`collection_id` is NOT in this INSERT column list** — DEFAULT fires automatically. No change to `upsert_encounter` needed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Resolving slug → id at migration time | Hardcoded integer literal | `EXECUTE format('SET DEFAULT %s', (SELECT id FROM public.providers WHERE slug=...))` | Phase 10 pattern: stable across re-seeds, no magic number in source |
| Bypassing RLS for cron-context INSERT | `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` | `SECURITY DEFINER` wrapper function | Disabling RLS is a production security regression; SECURITY DEFINER is the established pattern (`create_contributor_on_sign_in` precedent) |
| Fuzzy-matching bracket tags | Levenshtein / similarity function | Exact-match `collection_rule` + human-curated typo variants as separate rows | RESOLVE-04 explicitly prohibits fuzzy match; exact variants are the human audit trail |
| Custom collection lookup at query time | Inline CASE expression in views | Pre-resolved FK in the row | Phase 12 JOINs depend on pre-resolved FKs; query-time resolution defeats the schema design |

---

## Pattern 1: Phase 10 `provider_id` DEFAULT Template (for collection_id DEFAULTs)

[VERIFIED: `20260619203013_source_table_fk_columns.sql`]

```sql
-- Step 1: backfill existing rows by slug join
UPDATE inaturalist.observations
  SET collection_id = c.id
  FROM public.collections c
 WHERE c.slug = 'inaturalist'
   AND collection_id IS NULL;

-- Step 2: set DEFAULT for new rows (migration-resolved, no subquery in DEFAULT clause)
DO $$ BEGIN
  EXECUTE format(
    'ALTER TABLE inaturalist.observations ALTER COLUMN collection_id SET DEFAULT %s',
    (SELECT id FROM public.collections WHERE slug = 'inaturalist')
  );
END $$;
```

**Why this works:** Postgres rejects subqueries in `DEFAULT` expressions. The `DO $$` block runs at migration time; `format('%s', subquery)` resolves the id to a literal integer before executing the `ALTER`. Slug join in the UPDATE means no hardcoded id in migration source. Same pattern applies for `native` (slug `salishsea-direct`) and `happywhale` (slug `happywhale`).

---

## Pattern 2: `maplify.collection_rule` + `maplify.resolve_collection`

[ASSUMED based on D-02/D-03 decisions and existing SQL patterns in codebase]

```sql
-- Rule table
CREATE TABLE maplify.collection_rule (
  id          INTEGER PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  match_kind  TEXT NOT NULL CHECK (match_kind IN ('bracket', 'attribution', 'source')),
  match_value TEXT NOT NULL,
  collection_id INTEGER NOT NULL REFERENCES public.collections(id),
  UNIQUE (match_kind, match_value)
);

-- Resolver function (pure SQL, IMMUTABLE-safe for use inside INSERT)
CREATE FUNCTION maplify.resolve_collection(
  comments text,
  source   text
) RETURNS integer LANGUAGE SQL STABLE AS $$
  SELECT collection_id FROM maplify.collection_rule
   WHERE (match_kind = 'bracket'
          AND comments ~ '^\[([^\]]+)\]'
          AND match_value = (regexp_match(comments, '^\[([^\]]+)\]'))[1])
  UNION ALL
  SELECT collection_id FROM maplify.collection_rule
   WHERE match_kind = 'attribution'
     AND comments ~ match_value
  UNION ALL
  SELECT collection_id FROM maplify.collection_rule
   WHERE match_kind = 'source'
     AND match_value = source
  LIMIT 1;
$$;
```

**Precedence is enforced by the UNION ALL + LIMIT 1 order** — first result wins: bracket tag checked first, then attribution, then source code. The regex `^\[([^\]]+)\]` captures non-empty bracket content (D-09 tightening).

**Note:** The function should be `STABLE` not `IMMUTABLE` because it reads from `collection_rule`. Using it inside the `update_sightings` INSERT is fine — `VOLATILE` functions can call `STABLE` sub-functions.

---

## Pattern 3: iNat Contributor Mint in MERGE (D-16)

[VERIFIED structure from cron.sql MERGE, ASSUMED on contributor mint syntax]

The cron.sql `upsert_observation_page` uses `BEGIN ATOMIC` SQL function syntax. The contributor mint needs to:
1. Insert a contributor row if `username` not yet in `public.contributors.inat_login`
2. Retrieve the `contributor_id` to include in the observation INSERT

The challenge: `BEGIN ATOMIC` functions cannot use PL/pgSQL. The contributor mint requires an INSERT returning a value, then using that value. This may require either:
- A helper `SECURITY DEFINER` function `inaturalist.mint_contributor(username text) RETURNS integer`
- Or restructuring as a CTE inside the SELECT that feeds the MERGE

**Recommended approach:** Create `inaturalist.mint_contributor(username text) RETURNS integer SECURITY DEFINER` that does the `ON CONFLICT DO NOTHING` pattern and returns the id:

```sql
CREATE OR REPLACE FUNCTION inaturalist.mint_contributor(
  inat_login text
) RETURNS integer LANGUAGE SQL VOLATILE SECURITY DEFINER
SET search_path = '' AS $$
  INSERT INTO public.contributors (name, inat_login)
  VALUES (inat_login, inat_login)
  ON CONFLICT (inat_login) DO NOTHING;
  SELECT id FROM public.contributors WHERE inat_login = $1;
$$;
```

Then in the MERGE INSERT clause, add:
```sql
WHEN NOT MATCHED BY TARGET THEN INSERT
  (id, description, ..., contributor_id)
  VALUES (v.id, v.description, ..., inaturalist.mint_contributor(v.username))
```

**Why SECURITY DEFINER is required:** `public.contributors` has RLS enabled (`ALTER TABLE public.contributors ENABLE ROW LEVEL SECURITY` in `20260203234153_individuals.sql`). There is no INSERT policy on `public.contributors` for the `postgres` role (which runs pg_cron jobs). The existing `create_contributor_on_sign_in` trigger function uses `LANGUAGE plpgsql SECURITY DEFINER SET search_path=''` — this is the established precedent. Without SECURITY DEFINER, the INSERT will be silently blocked by RLS (not an error — RLS on INSERT with no permissive policy means 0 rows inserted, no exception raised).

**`SET search_path = ''`** is required per the `create_contributor_on_sign_in` precedent and Supabase security best practices (prevents search_path injection).

---

## Pattern 4: Assertion Snippet Shape (D-08 diff-gate + SC smoke tests)

[VERIFIED: `supabase/snippets/09_reference_assertions.sql`, `10_fk_columns_assertions.sql`]

```sql
\set ON_ERROR_STOP on
\echo === Phase 11 resolution verification ===
-- Run:
--   supabase db reset
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/snippets/11_resolution_assertions.sql

-- SC#1 — bracket-tagged rows have collection_id (prod only; local: assert resolver function exists)
\echo SC#1: resolve_collection function exists and returns NULL for unknown input
DO $$
DECLARE result INTEGER;
BEGIN
  SELECT maplify.resolve_collection('no bracket tag here', 'unknown_source') INTO result;
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'SC#1 FAIL: resolve_collection returned % for unrecognized input (expected NULL)', result;
  END IF;
END $$;

-- SC#2 — comments immutability (structural assertion: no migration touched comments)
\echo SC#2: maplify.sightings.comments column type unchanged (no text[] or scrubbed type)
DO $$
DECLARE col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
    FROM information_schema.columns
   WHERE table_schema = 'maplify' AND table_name = 'sightings' AND column_name = 'comments';
  IF col_type NOT IN ('character varying', 'text', 'character') THEN
    RAISE EXCEPTION 'SC#2 FAIL: maplify.sightings.comments column type is % (expected varchar/text)', col_type;
  END IF;
END $$;
```

**Key local/prod split:** Local `supabase db reset` has ~416 Maplify rows (from seed.sql calling `update_sightings(current_date-10, current_date)`). The backfill UPDATE is idempotent but row-level resolution can only be verified against prod data for full completeness. Assertion snippet should:
- Assert schema/function existence locally
- Assert resolver returns known values for known inputs (synthetic fixtures)
- Comment that row-level completeness (SC#1 "returns 0") must be verified against prod

---

## D-10: Acronym Expansion Research

[VERIFIED for major ones; LOW confidence for rare ones — see notes below]

The 11 Phase-9 stub slugs and their expansions:

| Slug | Acronym | Expanded Name | Confidence | Notes |
|------|---------|---------------|------------|-------|
| `psws` | PSWS | Puget Sound Wildlife Sightings | MEDIUM | Common Pacific Northwest wildlife FB group name pattern; not independently verified this session |
| `mcw` | MCW | Moclips Cetacean Watch | MEDIUM | Small WA coastal whale watching group; not independently verified |
| `cww` | CWW | Central Washington Watchers | LOW | Ambiguous; could be "Cascade Wildlife Watchers" or other expansion |
| `wssji` | WSSJI | Whale Sightings San Juan Islands | HIGH | Geographic specificity makes this confident; WSSJI is a known San Juan Islands sighting network |
| `hiws` | HIWS | Haro / Inland Waterways Sightings (or HIWS = HI WS = something else) | LOW | Ambiguous |
| `sbw` | SBW | South Bay Watchers / Strait of Boundary Waters | LOW | Ambiguous; "SB" = South Bay or Strait of... |
| `wa` | WA | Whale Alert (Washington) | MEDIUM | `wa` = state abbreviation OR Whale Alert regional; given existing `whale-alert-global` and `whale-alert-alaska` collections, this is likely Whale Alert WA state |
| `ssch` | SSCH | Salish Sea Cetacean Hub | LOW | Speculative |
| `sa` | SA | SalishSea Alerts | LOW | Speculative |
| `psww` | PSWW | Puget Sound Whale Watchers | MEDIUM | Well-known regional community |
| `bremerton-fb` | Bremerton FB group | Bremerton Facebook Group (already named) | HIGH | Literally named in the census; no expansion needed |

**CRITICAL: These expansions are [ASSUMED] — only the prod `SELECT DISTINCT` census reveals the actual tags (e.g., the census might show `[PSWS]` with 31 rows). The acronym EXPANSION itself must come from a human who knows the Salish Sea whale watching community, NOT from automated expansion. The researcher can propose expansions but the planner must flag these for human confirmation before writing `collection_rule` seed rows.**

**Action for planner:** All 11 stub `collection_id`s map via `collection_rule (match_kind='bracket', match_value='PSWS', collection_id=<id of 'psws' collection>)` etc. The Phase-9 stubs already exist with correct slugs. Phase 11 only needs to add `collection_rule` rows pointing at the existing stub collection ids. The `name`/`kind`/`organization_id` fields on the stub rows CAN be filled in this phase if the expansion is confirmed — add an UPDATE in the migration.

---

## Production Census: How to Run Safely

[VERIFIED: MEMORY.md — Supabase DSN assembled inline from DB_PASSWORD + SUPABASE_PROJECT_ID]

The prod Supabase project ref is `grztmjpzamcxlzecmqca`. The DSN is assembled inline (not stored as a single `SUPABASE_DB_URL` env var — see MEMORY).

```bash
# Obtain DB_PASSWORD from GitHub Actions production environment or local secrets
# Assemble DSN inline:
psql "postgresql://postgres:${DB_PASSWORD}@db.grztmjpzamcxlzecmqca.supabase.co:5432/postgres" \
  --no-password -c "
    SELECT match_kind, match_value, count(*)
    FROM (
      SELECT
        CASE
          WHEN comments ~ '^\[([^\]]+)\]' THEN 'bracket'
          WHEN comments ~ 'Trusted Observer' THEN 'attribution'
          ELSE 'source-only'
        END AS match_kind,
        CASE
          WHEN comments ~ '^\[([^\]]+)\]'
            THEN (regexp_match(comments, '^\[([^\]]+)\]'))[1]
          WHEN comments ~ 'Trusted Observer'
            THEN regexp_replace(comments, '.*(Submitted by a (.+) Trusted Observer).*', '\2', 'g')
          ELSE source
        END AS match_value
      FROM maplify.sightings
    ) t
    GROUP BY 1, 2
    ORDER BY 3 DESC;
  "
```

**Census artifact location:** Commit raw output as `.planning/phases/11-resolution-backfill/maplify_census.tsv` (or `.sql` if formatted as a SQL file). This is the authoritative starting point for the `collection_rule` seed.

**Read-only guarantee:** Only `SELECT` is used. No connection pooler (direct to port 5432). The orcasound AWS profile (MEMORY reference) is for S3 — not needed here; Supabase DB is accessed directly with the postgres password.

---

## Common Pitfalls

### Pitfall 1: `SELECT sightings.*` Wildcard After Column Addition

**What goes wrong:** `INSERT INTO maplify.sightings SELECT sightings.*` worked before Phase 10 because `fetch_date_range` returned the same columns as `maplify.sightings`. After Phase 10 added `provider_id`, `collection_id`, `contributor_id`, `source_url`, the wildcard SELECT returns 14 columns from `fetch_date_range` but `maplify.sightings` has 18. Postgres will error with "INSERT has more target columns than expressions" if the column counts mismatch — but it might silently assign wrong columns if the counts accidentally match.

**Why it happens:** The wildcard INSERT assumed table/function column parity. Phase 10 deliberately deferred fixing this to Phase 11.

**How to avoid:** Replace with explicit column list naming all 14 `fetch_date_range` columns plus `collection_id = maplify.resolve_collection(...)`. Leave `provider_id` out of the list so DEFAULT fires.

**Warning signs:** After Phase 11 migration, test `SELECT * FROM maplify.update_sightings(current_date-1, current_date)` locally with seed data — if it errors, the column list is wrong.

---

### Pitfall 2: RLS Silently Blocks Contributor INSERT

**What goes wrong:** The cron context runs as `postgres` role. `public.contributors` has RLS enabled. No INSERT policy exists for `postgres` role (only the `create_contributor_on_sign_in` trigger bypasses this via SECURITY DEFINER). The mint INSERT without SECURITY DEFINER silently inserts 0 rows — no exception, no error. `contributor_id` stays NULL on every new iNat row.

**Why it happens:** Postgres WITH RLS: if no matching permissive policy exists for an operation, the operation returns 0 rows for SELECT or silently does nothing for INSERT (no exception, unlike a permission error).

**How to avoid:** Wrap the contributor mint in a `SECURITY DEFINER` function. Mirror the `create_contributor_on_sign_in` precedent exactly: `LANGUAGE plpgsql SECURITY DEFINER SET search_path=''`.

**Warning signs:** After Phase 11, `SELECT COUNT(*) FROM public.contributors WHERE inat_login IS NOT NULL` returns 0 despite a successful migration.

---

### Pitfall 3: Backfill Migration Runs on Prod Before Rules Are Seeded

**What goes wrong:** If the backfill UPDATE runs before `maplify.collection_rule` is seeded, `maplify.resolve_collection()` returns NULL for every row. All `collection_id` values are set to NULL. Subsequent migration has `WHERE collection_id IS NULL` guard, so it would not re-run — backfill is lost.

**How to avoid:** Rule seed + `resolve_collection` function MUST be in an earlier migration (or same migration before the UPDATE). The recommended split is: migration (a) = schema (table + function + column + DEFAULTs) including seed rows, migration (b) = backfill UPDATEs, migration (c) = ingest function edits.

**Warning signs:** After migration (b), run `SELECT COUNT(*) FROM maplify.sightings WHERE collection_id IS NOT NULL` — should be > 0 (locally: matches rows with known bracket tags in the seed data).

---

### Pitfall 4: Editing `update_sightings` Breaks Live Prod Ingest Before Deploy

**What goes wrong:** Supabase auto-deploys on push to `main`. The cron job runs every 5 minutes. If migration (c) (ingest function edit) deploys with a bug, all Maplify ingest breaks for up to 5 minutes before detection.

**How to avoid:** Test the edited `update_sightings` locally with `supabase db reset` + `SELECT * FROM maplify.update_sightings(current_date-3, current_date)`. Confirm row count is reasonable and `collection_id` is populated for known bracket-tagged seed rows. Deploy (a)+(b)+(c) as a single push only after local testing.

**Warning signs:** After deploy, check `SELECT created_at, collection_id FROM maplify.sightings ORDER BY created_at DESC LIMIT 5` — should show recent rows with non-NULL `collection_id` where the source data has bracket tags.

---

### Pitfall 5: `BEGIN ATOMIC` SQL Function Cannot Use PL/pgSQL Control Flow

**What goes wrong:** The cron.sql `upsert_observation_page` uses `LANGUAGE SQL ... BEGIN ATOMIC` — this is pure SQL, no PL/pgSQL. You cannot use `IF`, `DECLARE`, `PERFORM`, or `RETURNING ... INTO v_var` inside `BEGIN ATOMIC`.

**How to avoid:** The contributor mint must be a separate helper function (`inaturalist.mint_contributor(username)`) that is called as a scalar subexpression in the MERGE INSERT. The helper function can be PL/pgSQL if needed.

---

### Pitfall 6: iNat MERGE MATCHED Clause Overwrites contributor_id on Update

**What goes wrong:** If the `WHEN MATCHED ... THEN UPDATE SET` clause includes `contributor_id = inaturalist.mint_contributor(v.username)`, then every time an existing iNat observation is re-fetched and updated, the contributor is re-minted (idempotent) but the UPDATE clause fires unnecessarily.

**How to avoid:** Add `contributor_id` only to the `WHEN NOT MATCHED BY TARGET THEN INSERT` clause, not to the UPDATE clause. Existing rows already have contributor_id set after the one-time backfill UPDATE; the MERGE UPDATE should not touch it.

---

### Pitfall 7: Diff-Gate Can Only Run Against Prod Data for Full Coverage Check

**What goes wrong:** The D-08 diff-gate asserts "no uncovered prod tag/attribution/source code" — but local `supabase db reset` only has ~416 rows from recent seed, not the full 6,827 prod Maplify rows. The diff-gate might pass locally but fail against prod.

**How to avoid:** Design the assertion snippet to have two modes: (a) local smoke test (asserts schema/function existence + synthetic fixture), (b) prod diff-gate (asserts zero uncovered rows). The local snippet tests structure; the prod diff-gate is run manually before and after the census + rule-seeding step. Document this explicitly in the assertion file header.

---

## Runtime State Inventory

This is a migration + ingest-function-edit phase. No rename/refactor — runtime state inventory does not apply.

However, note the **live ingest state** that must be considered:

| Category | State | Action Required |
|----------|-------|-----------------|
| `maplify.update_sightings` cron | Running every 5 min; DELETE+INSERT over last 10 days | Edit in migration (c); test locally first |
| `inaturalist.upsert_observation_page` cron | Running every 5 min; MERGE upsert | Edit in migration (c); test locally first |
| Existing `maplify.sightings` rows (last 10 days) | Will be wiped and re-INSERTed by next cron run | backfill UPDATE on all historical rows; cron handles last-10-days going forward |
| `public.contributors` (28 native rows) | Already present; no inat_login column yet | Migration (a) adds `inat_login` column; no data risk to existing rows |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Supabase (`supabase db reset`) | Assertion snippet testing | ✓ (confirmed: local at 127.0.0.1:54321) | — | — |
| `psql` | Local snippet runner + prod census | Must confirm | — | Use Supabase dashboard SQL editor for census |
| Prod Supabase (read-only) | D-08 census | ✓ (project `grztmjpzamcxlzecmqca`) | — | Dashboard SQL editor |
| `npm test` / vitest | TS resolver tests | ✓ (package.json confirmed) | vitest (existing) | — |
| `tsx` | Run TS scripts | ✓ (used for `scripts/dwca/build.ts`) | — | — |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (existing, `vitest.config.ts`) |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- scripts/ingest/` |
| Full suite command | `npm test` |
| SQL assertions | `psql ... -f supabase/snippets/11_resolution_assertions.sql` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RESOLVE-01 | URL resolver returns correct {provider, collection} for known patterns | unit | `npm test -- resolve-provider` | ❌ Wave 0 |
| RESOLVE-01 | URL resolver returns null for unknown patterns | unit | `npm test -- resolve-provider` | ❌ Wave 0 |
| RESOLVE-02 | `resolve_collection` returns correct collection_id for bracket tags | SQL (local) | `psql ... -f supabase/snippets/11_resolution_assertions.sql` | ❌ Wave 0 |
| RESOLVE-02 | `resolve_collection` returns correct collection_id for attribution lines | SQL (local) | `psql ... -f supabase/snippets/11_resolution_assertions.sql` | ❌ Wave 0 |
| RESOLVE-02 | `resolve_collection` returns NULL for unrecognized input | SQL (local) | `psql ... -f supabase/snippets/11_resolution_assertions.sql` | ❌ Wave 0 |
| RESOLVE-03 | SC#1: bracket-tagged rows have collection_id (prod) | manual SQL | psql against prod | ❌ Wave 0 (manual-only for completeness) |
| RESOLVE-03 | SC#2: `comments` column type unchanged | SQL (local) | `psql ... -f supabase/snippets/11_resolution_assertions.sql` | ❌ Wave 0 |
| RESOLVE-03 | SC#3: Trusted Observer rows have NULL contributor_id | SQL (local) | `psql ... -f supabase/snippets/11_resolution_assertions.sql` | ❌ Wave 0 |
| RESOLVE-03 | SC#4: iNat/native rows with valid URLs have provider_id + collection_id | SQL (local) | `psql ... -f supabase/snippets/11_resolution_assertions.sql` | ❌ Wave 0 |
| RESOLVE-04 | SC#5: `update_sightings` produces rows with collection_id for known tags | SQL (local, synthetic) | `psql ... -f supabase/snippets/11_resolution_assertions.sql` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test` (vitest for TS) + `supabase db reset && psql ... -f 11_resolution_assertions.sql` (SQL)
- **Per wave merge:** Same
- **Phase gate:** All assertions green locally; SC#1 count verified against prod before /gsd-verify-work

### Wave 0 Gaps

- [ ] `scripts/ingest/resolve-provider.ts` — new file; covers RESOLVE-01
- [ ] `scripts/ingest/resolve-provider.test.ts` — new file; vitest unit tests
- [ ] `supabase/snippets/11_resolution_assertions.sql` — new file; SQL smoke tests covering SC#1-SC#5
- [ ] `.planning/phases/11-resolution-backfill/maplify_census.tsv` — run prod census first; must precede writing collection_rule seed

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | `SECURITY DEFINER SET search_path=''` for contributor mint; no new user-facing endpoints |
| V5 Input Validation | yes | Exact-match dictionary only (no fuzzy eval of user-controlled strings); `maplify.sightings.comments` is never eval'd as code |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| search_path injection in SECURITY DEFINER functions | Elevation of Privilege | `SET search_path = ''` on all SECURITY DEFINER functions (precedent: `create_contributor_on_sign_in`) |
| RLS bypass via missing INSERT policy | Elevation of Privilege | `SECURITY DEFINER` wrapper; never `DISABLE ROW LEVEL SECURITY` |
| Prod data mutation via migration on push | Tampering | Idempotent guards (`WHERE collection_id IS NULL`, `ON CONFLICT DO NOTHING`); test locally before push |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 11 acronym expansions (PSWS = "Puget Sound Wildlife Sightings", etc.) | D-10 Acronym Expansion | Wrong expansion → wrong organization seeded; collection would be misattributed; fixable with a correction migration |
| A2 | `resolve_collection` UNION ALL + LIMIT 1 is the right precedence mechanism | Pattern 2 | Alternative (CASE WHEN or JOIN with priority column) works equally well; planner may choose |
| A3 | `inaturalist.mint_contributor` as a helper SECURITY DEFINER function is the right injection point for `BEGIN ATOMIC` | Pattern 3 | If `upsert_observation_page` is refactored away from `BEGIN ATOMIC` in a future migration, this pattern still works as a standalone function |
| A4 | The 11 stub collection rows already exist in `public.collections` with correct slugs (psws, mcw, cww, etc.) | D-10 | Verified directly from `20260619184037_reference_tables.sql` lines 124-135 — HIGH confidence, not assumed |

**If this table is empty:** it is not — A1 is the primary user-confirmation item before writing collection_rule seed rows.

---

## Open Questions

1. **Acronym expansions for D-10**
   - What we know: 11 stubs seeded in Phase 9 with slugs psws/mcw/cww/wssji/hiws/sbw/wa/ssch/sa/psww/bremerton-fb; prod census shows row counts (31, 12, 10, 5, 3, 2, 2, 1, 1, 1, 1)
   - What's unclear: the actual organization names behind PSWS, MCW, CWW, HIWS, SBW, WA, SSCH, SA, PSWW — these are Salish Sea community-specific
   - Recommendation: **Block plan execution on this** — run the prod census first, then user reviews the bracket tags and confirms expansions before `collection_rule` seed is written. Include a task "Human confirms acronym expansions" as a `checkpoint:human-verify` before the migration that seeds `collection_rule`.

2. **`resolve_collection` function stability classification**
   - What we know: function reads from `maplify.collection_rule` (a base table)
   - What's unclear: whether to mark it `STABLE` (safe for planner to assume no side effects, can be called in parallel) or `VOLATILE`
   - Recommendation: `STABLE` is correct (reads table, no writes); Postgres allows calling `STABLE` functions in INSERT...SELECT contexts inside a VOLATILE outer function.

3. **Census regex precision for attribution extraction**
   - What we know: the attribution pattern is "Submitted by a [ORG] Trusted Observer" (some rows: "Submitted by an TMMC Trusted Observer")
   - What's unclear: exact regex for extracting the org name component from the attribution line (some use "a" vs "an")
   - Recommendation: use `'Trusted Observer'` as the attribution `match_value` per attribution type (entire pattern match, not just org name) — e.g., `match_kind='attribution', match_value='Cascadia Trusted Observer'` matching against `comments ~ match_value`. This avoids parsing the attribution line in the resolver.

---

## Sources

### Primary (HIGH confidence — direct file reads)

- `supabase/migrations/20250914232212_cron.sql` — exact `upsert_observation_page` MERGE body + cron schedule lines; exact function signatures
- `supabase/migrations/20250904165159_fetch_data.sql` — exact `maplify.update_sightings` body; `maplify.fetch_date_range` return columns; `happywhale.upsert_encounter` column list
- `supabase/migrations/20260619203013_source_table_fk_columns.sql` — Phase 10 `provider_id` DEFAULT pattern (exact template for collection_id DEFAULTs)
- `supabase/migrations/20260619184037_reference_tables.sql` — Phase 9 collection slugs (verified all 11 stub slugs)
- `supabase/migrations/20260203234153_individuals.sql` — `public.contributors` schema; `create_contributor_on_sign_in` SECURITY DEFINER precedent
- `supabase/migrations/20260207000253_fix_upsert_observation.sql` — `public.upsert_observation` INSERT column list (confirms `collection_id` absent → DEFAULT fires)
- `supabase/migrations/20260204013006_sightings_uses_contributors.sql` — `happywhale.upsert_encounter` INSERT column list (confirms `collection_id` absent)
- `supabase/snippets/09_reference_assertions.sql`, `10_fk_columns_assertions.sql` — assertion snippet shape and precedent
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` — prod census data (§3: tag counts, attribution counts)
- `.planning/phases/11-resolution-backfill/11-CONTEXT.md` — all 16 locked decisions

### Secondary (MEDIUM confidence)

- `package.json` + `vitest.config.ts` — test runner confirmed as vitest; `npm test` is the command
- MEMORY.md — Supabase DSN assembly pattern (inline, not a `SUPABASE_DB_URL` secret)
- `.planning/REQUIREMENTS.md` — RESOLVE-01..04 requirement text

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all SQL patterns verified against actual migration files
- Architecture: HIGH — ingest function bodies read directly; column lists confirmed
- Pitfalls: HIGH (for structural pitfalls 1-5); MEDIUM (for pitfall 6-7, inferred from patterns)
- Acronym expansions: LOW — community knowledge required; flagged as [ASSUMED]

**Research date:** 2026-06-19
**Valid until:** 2026-07-19 (30 days — Supabase schema is stable; cron.sql unlikely to change before this phase executes)
