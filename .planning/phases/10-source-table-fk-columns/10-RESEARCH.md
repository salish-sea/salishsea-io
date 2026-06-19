# Phase 10: Source Table FK Columns - Research

**Researched:** 2026-06-19
**Domain:** PostgreSQL schema migration (Supabase) — additive FK columns, generated columns, migration-resolved defaults, cross-schema FKs
**Confidence:** HIGH (all core SQL idioms live-verified against the project's local Supabase DB on Postgres 17.6)

## Summary

Phase 10 is a pure additive DDL migration: four provenance columns
(`provider_id`, `collection_id`, `contributor_id`, `source_url`) onto the four
source tables, a `collection_id` index on the two exported tables, and the
deterministic backfill (`provider_id` everywhere, `source_url` on
native/iNat/HappyWhale). No application code, no ingest-RPC edits. Every
locked decision in CONTEXT.md (D-01 … D-14) is implementable exactly as
written, with **one substantive correction** (see below).

I verified every load-bearing SQL idiom live against the running local DB:
`GENERATED ALWAYS AS (url) STORED` populates existing rows and appears in `\d`;
it cannot be `UPDATE`d (so Phase 11 cannot touch it — correct by design); the
migration-resolved `DEFAULT` via `EXECUTE format('… SET DEFAULT %s', (SELECT id …))`
stores a plain integer literal with no subquery; a column `DEFAULT` containing a
subquery is rejected by Postgres (confirming D-04's rationale); the full
phase-10 DDL applies cleanly to the real `maplify.sightings` (416 local rows)
and a synthetic SC#4 insert with NULL `collection_id` succeeds and auto-defaults
`provider_id`. The two ingest RPCs that write these tables (`maplify.update_sightings`,
`public.upsert_observation`) both use **explicit INSERT column lists**, so adding
columns does not break them — D-14 ("don't touch the RPCs") is safe.

**The one correction:** CONTEXT D-09's expected HappyWhale URL
`https://happywhale.com/encounter/{id}` is **not the form this codebase uses**.
Every HappyWhale URL across 15+ migrations is
`https://happywhale.com/individual/{individual_id};enc={encounter_id}` — which
requires `individual_id` (a sibling column on `happywhale.encounters`), not just
`id`. The literal `/encounter/{id}` pattern is unverifiable and contradicts repo
precedent. See Pitfall 1 + Open Question 1 + Assumptions Log A1.

**Primary recommendation:** Single timestamped migration in
`supabase/migrations/` that, per table, runs ADD COLUMN → backfill `provider_id`
by slug-join → SET NOT NULL → dynamic-SQL SET DEFAULT, plus the generated
`source_url` columns and the `collection_id` partial index; ship a
`supabase/snippets/10_fk_columns_assertions.sql` mirroring the `05`/`09`
precedent; verify with `supabase db reset` + psql. **Build the HappyWhale
`source_url` from `'https://happywhale.com/individual/' || individual_id || ';enc=' || id`**
(repo-canonical form), not the CONTEXT `/encounter/{id}` guess — or gate it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Add provenance FK columns | Database / Storage | — | Pure schema change; FKs live in Postgres |
| `provider_id` deterministic backfill + default | Database / Storage | — | Slug-join UPDATE + migration-resolved DEFAULT, all server-side |
| `source_url` generation (native/iNat) | Database / Storage | — | `GENERATED ALWAYS AS (col) STORED` — computed in-engine, zero app code |
| HappyWhale `source_url` derivation | Database / Storage | — | Constructed from `individual_id` + `id` in the migration |
| `collection_id` index | Database / Storage | — | Btree on exported tables for Phase 12 join access pattern |
| Forward-population of new rows | Database / Storage (ingest RPCs, **unchanged**) | — | DEFAULT (provider) + GENERATED (source_url) auto-fill; no RPC edit (D-14) |
| Success-criteria verification | Database / Storage (psql snippet) | CI (`supabase db reset`) | Mirrors `05`/`09` assertion-snippet precedent |

There is **no** API, frontend, or client tier in this phase. v1.3 is explicitly a
backend/data-model milestone with no app UI surfaces.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 … D-14 — research HOW, do not re-open)

- **D-01/D-02/D-03 — `provider_id`:** constant per source table
  (native→`direct`, maplify→`maplify`, inat→`inaturalist`, happywhale→`happywhale`).
  Add column → backfill **every row by slug-join**
  (`UPDATE <t> SET provider_id = p.id FROM public.providers p WHERE p.slug='<slug>'`)
  → `SET NOT NULL` → migration-resolved `SET DEFAULT` emitted via dynamic SQL
  resolving slug→id. **Never a hardcoded id literal in source.**
- **D-04 [rejected] — no GENERATED `provider_id`:** generation expressions cannot
  contain a subquery / reference another table; a literal magic-int would break the
  FK on re-seed. D-02/D-03 capture the intent without the fragility. **Verified true**
  (see Code Examples — subquery DEFAULT is rejected by Postgres).
- **D-05 [deviation from SC#1] — `provider_id` is NOT NULL**, deliberately stricter
  than SC#1's "all nullable". Intentional; provider is fully known now.
- **D-06 — `source_url` GENERATED:** `GENERATED ALWAYS AS (url) STORED` on
  `public.observations`; `… AS (uri) STORED` on `inaturalist.observations`.
  Phase 11 can never UPDATE these (correct by construction).
- **D-07/D-08 — Maplify + HappyWhale `source_url` are plain nullable text.**
  Maplify stays **NULL** this phase (Phase 11 resolver derives it from `comments`).
- **D-09 — HappyWhale `source_url` IS backfilled now** from a constructed encounter
  URL derived from the id. **CONTEXT expects `https://happywhale.com/encounter/{id}`
  but flags: "planner MUST verify the exact URL pattern against a live HW encounter
  before writing the UPDATE."** See Pitfall 1 — repo precedent contradicts this pattern.
  Planner option: express as a GENERATED column if the pattern is confirmed stable.
- **D-10/D-11 — `contributor_id` nullable everywhere.** Add nullable on
  maplify/inat/happywhale; **relax native's existing NOT NULL** via
  `ALTER COLUMN contributor_id DROP NOT NULL` (data stays 100% populated).
- **D-12 — `collection_id` nullable on all four**, no NOT NULL this phase.
- **D-13 — index `collection_id` on the two exported tables only**
  (`public.observations`, `maplify.sightings`). **Recommended: partial btree
  `(collection_id) WHERE collection_id IS NOT NULL`**; plain btree acceptable.
- **D-14 — do NOT edit the ingest upsert RPCs** this phase.

### Claude's Discretion
- `collection_id` index form (partial vs plain btree) — lean partial (D-13).
- HappyWhale `source_url` as plain-column-UPDATE vs generated column (D-09),
  pending URL-pattern verification.
- Exact migration structure (single vs split), assertion-snippet shape — follow
  Phase 9 / `05` precedent (`supabase db reset` + psql `\d`/index/insert checks).

### Deferred Ideas (OUT OF SCOPE — Phase 11+)
- Maplify `source_url` derivation from `comments` (Phase 11 resolver).
- `collection_id` / `contributor_id` backfill (Phase 11).
- Ingest-RPC wiring of `collection_id`/`contributor_id` on new rows (Phase 11).
- NOT NULL on `collection_id` (deferred indefinitely).
- Cross-provider contributor unification (out of milestone).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LINK-01 | Each source table carries `provider_id`, `collection_id`, `contributor_id`, `source_url`; `collection_id` indexed | Per-table DDL matrix below (all four columns on all four tables). Note D-05 deviation: `provider_id` is NOT NULL not nullable. Index DDL in Code Examples; both tables verified to accept the partial index (visible in `pg_indexes`). |
| LINK-02 | Records inserted after deploy resolve `collection_id`; constraint applied only after backfill (nullable→backfill→constrain) | This phase only ships the **nullable** `collection_id` column + index. The not-null/constrain step is Phase 11 work (RESOLVE-*). No constraint added now (D-12). Ingest forward-population of `collection_id` is also Phase 11 (D-14). |
| LINK-03 | `source_url` populated from each provider's existing URL (iNat `uri`, native `url`) | Generated columns `AS (url)` / `AS (uri)` populate all existing rows at ADD time (verified: 201/201 iNat rows populated) and auto-populate new rows. Maplify left NULL (D-08, no url sibling); HappyWhale backfilled from constructed URL (D-09 — see Pitfall 1). |
</phase_requirements>

## Standard Stack

No external packages. This phase uses only PostgreSQL DDL via Supabase
migrations. **Package Legitimacy Audit: N/A — no packages installed.**

| Tool | Version (local) | Purpose | Why Standard |
|------|-----------------|---------|--------------|
| PostgreSQL | 17.6 (local Supabase) | Generated columns, dynamic SQL, partial indexes | All idioms below are core Postgres ≥12 features, verified live |
| Supabase CLI | project standard | `supabase db reset` (apply migrations + seed) / `supabase db push` (remote) | Existing project workflow |
| psql | bundled | Run the assertion snippet | Matches `05`/`09` precedent |

**No installation step.** Migration files are plain SQL in
`supabase/migrations/`; verification is `supabase db reset` then
`psql … -v ON_ERROR_STOP=1 -f supabase/snippets/10_fk_columns_assertions.sql`.

## Architecture Patterns

### Per-Table Column Matrix (end state of Phase 10) — DDL sketches

> Live-verified column shapes and PK types (from `\d` on the running DB):

| Table | PK type | URL sibling | RLS? | Pre-existing FK columns |
|-------|---------|-------------|------|-------------------------|
| `public.observations` | `uuid` | `url varchar(2000)` nullable | **YES** (anon SELECT-all; authenticated own-row) | `contributor_id int NOT NULL` (relax), `taxon_id`, `user_uuid` |
| `maplify.sightings` | `integer` | none | **NO** | `taxon_id int → inaturalist.taxa(id)` (cross-schema precedent) |
| `inaturalist.observations` | `bigint` | `uri varchar(200)` **NOT NULL** | **NO** | `taxon_id int NOT NULL` |
| `happywhale.encounters` | `integer` | none (build from `individual_id`+`id`) | **NO** | `individual_id int NOT NULL`, `species_id` |

#### `public.observations` (native)
```sql
ALTER TABLE public.observations
  ADD COLUMN provider_id    INTEGER REFERENCES public.providers(id),
  ADD COLUMN collection_id  INTEGER REFERENCES public.collections(id),
  ADD COLUMN source_url      TEXT GENERATED ALWAYS AS (url) STORED;   -- D-06
-- contributor_id already exists & is NOT NULL (added by 20260204013006); relax it:
ALTER TABLE public.observations ALTER COLUMN contributor_id DROP NOT NULL;  -- D-11
-- provider_id: backfill → not null → migration-resolved default (D-02/D-03)
UPDATE public.observations SET provider_id = p.id FROM public.providers p WHERE p.slug = 'direct';
ALTER TABLE public.observations ALTER COLUMN provider_id SET NOT NULL;
DO $$ BEGIN EXECUTE format(
  'ALTER TABLE public.observations ALTER COLUMN provider_id SET DEFAULT %s',
  (SELECT id FROM public.providers WHERE slug = 'direct')); END $$;
-- collection_id index (D-13, partial recommended)
CREATE INDEX observations_collection_id ON public.observations (collection_id)
  WHERE collection_id IS NOT NULL;
```
Note: do **not** add a separate `contributor_id` column — it exists. SC#1's
"`contributor_id` … nullable" is satisfied by the `DROP NOT NULL` alone.

#### `maplify.sightings` (exported)
NOT NULL columns a synthetic SC#4 insert must satisfy: `id, project_id, trip_id,
scientific_name, location, number_sighted, created_at, in_ocean, moderated,
trusted, is_test, source`.
```sql
ALTER TABLE maplify.sightings
  ADD COLUMN provider_id    INTEGER REFERENCES public.providers(id),
  ADD COLUMN collection_id  INTEGER REFERENCES public.collections(id),
  ADD COLUMN contributor_id INTEGER REFERENCES public.contributors(id),
  ADD COLUMN source_url      TEXT;                                     -- D-07/D-08: plain, stays NULL
UPDATE maplify.sightings SET provider_id = p.id FROM public.providers p WHERE p.slug = 'maplify';
ALTER TABLE maplify.sightings ALTER COLUMN provider_id SET NOT NULL;
DO $$ BEGIN EXECUTE format(
  'ALTER TABLE maplify.sightings ALTER COLUMN provider_id SET DEFAULT %s',
  (SELECT id FROM public.providers WHERE slug = 'maplify')); END $$;
CREATE INDEX sightings_collection_id ON maplify.sightings (collection_id)
  WHERE collection_id IS NOT NULL;
```

#### `inaturalist.observations`
```sql
ALTER TABLE inaturalist.observations
  ADD COLUMN provider_id    INTEGER REFERENCES public.providers(id),
  ADD COLUMN collection_id  INTEGER REFERENCES public.collections(id),
  ADD COLUMN contributor_id INTEGER REFERENCES public.contributors(id),
  ADD COLUMN source_url      TEXT GENERATED ALWAYS AS (uri) STORED;    -- D-06 (uri is NOT NULL → every row populated)
UPDATE inaturalist.observations SET provider_id = p.id FROM public.providers p WHERE p.slug = 'inaturalist';
ALTER TABLE inaturalist.observations ALTER COLUMN provider_id SET NOT NULL;
DO $$ BEGIN EXECUTE format(
  'ALTER TABLE inaturalist.observations ALTER COLUMN provider_id SET DEFAULT %s',
  (SELECT id FROM public.providers WHERE slug = 'inaturalist')); END $$;
-- No collection_id index (not an exported table, D-13).
```

#### `happywhale.encounters`
```sql
ALTER TABLE happywhale.encounters
  ADD COLUMN provider_id    INTEGER REFERENCES public.providers(id),
  ADD COLUMN collection_id  INTEGER REFERENCES public.collections(id),
  ADD COLUMN contributor_id INTEGER REFERENCES public.contributors(id),
  ADD COLUMN source_url      TEXT;                                     -- D-07/D-09: plain, backfilled below
UPDATE happywhale.encounters SET provider_id = p.id FROM public.providers p WHERE p.slug = 'happywhale';
ALTER TABLE happywhale.encounters ALTER COLUMN provider_id SET NOT NULL;
DO $$ BEGIN EXECUTE format(
  'ALTER TABLE happywhale.encounters ALTER COLUMN provider_id SET DEFAULT %s',
  (SELECT id FROM public.providers WHERE slug = 'happywhale')); END $$;
-- D-09 source_url backfill — USE THE REPO-CANONICAL URL FORM (see Pitfall 1):
UPDATE happywhale.encounters
  SET source_url = 'https://happywhale.com/individual/' || individual_id || ';enc=' || id;
-- No collection_id index (not an exported table, D-13).
```
> **Generated-column alternative for HW (D-09 planner option):** because
> `individual_id` is a sibling column on the *same* table (not a subquery),
> `source_url GENERATED ALWAYS AS ('https://happywhale.com/individual/' ||
> individual_id || ';enc=' || id) STORED` is legal and makes every row non-null
> by construction (verified: same-table column refs are allowed in generation
> expressions). This is cleaner than the plain-column + UPDATE if the URL form
> is confirmed. **Do not** use the `/encounter/{id}` form CONTEXT guessed.

### Recommended migration structure
A **single** timestamped migration
(`supabase/migrations/<ts>_source_table_fk_columns.sql`) containing the four
per-table blocks above, ordered ADD → backfill → SET NOT NULL → SET DEFAULT →
index, plus generated columns. Mirrors the Phase 9 single-file precedent.
Companion `supabase/snippets/10_fk_columns_assertions.sql`.

### Pattern: ordering within each table block
1. `ADD COLUMN` (all four; generated columns populate existing rows immediately).
2. `UPDATE … SET provider_id` by slug-join (backfill before constraining).
3. `ALTER … SET NOT NULL` on `provider_id`.
4. Dynamic-SQL `SET DEFAULT` (after data exists; resolves slug→id at migration time).
5. `CREATE INDEX` (exported tables only).
6. For native: `ALTER … DROP NOT NULL` on `contributor_id`.

### Anti-Patterns to Avoid
- **Hardcoding a provider id literal** (`SET DEFAULT 2`) — breaks on re-seed
  (IDENTITY values are not stable). Always resolve slug→id via dynamic SQL (D-02).
- **Subquery in a column DEFAULT** — rejected by Postgres (verified). This is
  *why* dynamic SQL is required, and why GENERATED can't be used for `provider_id`.
- **Trying to UPDATE a generated `source_url`** (e.g. a Phase 11 mistake) — errors
  with "column can only be updated to DEFAULT". This is the intended guard rail.
- **Adding a `contributor_id` column to `public.observations`** — it already
  exists; only relax its NOT NULL.
- **Using `/encounter/{id}` for HappyWhale** — not the form this codebase uses.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Keep `source_url` in sync with `url`/`uri` on new rows | A trigger or ingest-RPC edit | `GENERATED ALWAYS AS (col) STORED` | Zero drift, no backfill UPDATE, auto-fills new rows, can't be wrongly overwritten (D-06/D-14) |
| Auto-set `provider_id` on new rows | Edit each ingest RPC | Migration-resolved column `DEFAULT` (D-03) | New rows get the right provider with no RPC change; survives re-seed because the literal is resolved at migrate time from the slug |
| Stable provider linkage across re-seeds | Hardcode magic ids | Slug-join backfill + slug-resolved default | Slugs are the Phase 9 D-05 natural-key contract; IDENTITY ids are assignment-order-dependent |

**Key insight:** the whole phase leans on two Postgres features (generated
columns + migration-time dynamic DEFAULT) to make new-row population free, which
is exactly why D-14 ("don't touch the RPCs") holds.

## Runtime State Inventory

> Additive-column migration, not a rename. No string is being renamed; the
> inventory below confirms there is no out-of-repo runtime state to migrate.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | The four source tables themselves (prod: native 436, maplify 6,827, inat 8,759, HW 5,601). New columns are populated by the **in-migration** backfill UPDATEs — this is in-repo SQL, not external state. | None beyond the migration's own UPDATEs |
| Live service config | None — no external service stores these column names | None |
| OS-registered state | None — `pg_cron` jobs (`load-recent-maplify-sightings`, etc.) call RPCs that are **not** edited (D-14); the RPCs' explicit INSERT column lists tolerate the new columns | None |
| Secrets / env vars | None — no new env var; deploy uses existing Supabase secrets | None |
| Build artifacts / generated types | `database.types.ts` (Supabase-generated TS types) will be **stale** after the columns are added — but no app code in this phase reads the new columns, and v1.3 has no UI. Regeneration is a Phase 12+ concern when views consume the FKs. | Optional: regenerate types; not required for Phase 10 |

**Verified:** both ingest RPCs that write these tables use explicit INSERT
column lists (`maplify.update_sightings` MERGE INSERT, `public.upsert_observation`
INSERT) — confirmed by reading the latest definitions
(`20250922194148_more_maplify_fix.sql`, `20250915171505_sighting_policies.sql`).
An older `maplify.update_sightings` used a positional `INSERT … SELECT sightings.*`
but it was **superseded** by the explicit-column MERGE. So new columns will not
break ingest. (None — verified by reading every `update_sightings` redefinition.)

## Common Pitfalls

### Pitfall 1: HappyWhale URL pattern (CONTEXT D-09 is likely wrong)
**What goes wrong:** D-09 says the expected pattern is
`https://happywhale.com/encounter/{id}` and instructs the planner to verify it.
Building the backfill on that pattern would emit URLs that don't match how the
rest of the system addresses HappyWhale encounters.
**Why it happens:** the HappyWhale **API** endpoint *is*
`https://happywhale.com/app/cs/encounter/full/{id}` (a JSON endpoint, used by the
ingest fetcher) — which superficially resembles `/encounter/{id}`. But the
**human-viewable** source URL the entire codebase uses is different.
**Evidence (HIGH):** 15+ occurrences across migrations
(`20250915171505`, `20260204175500`, `20260204013006`, `20251015151641`,
`20251002204623`, `20250929064707`, `20250918165924`, …) all build the HW URL as:
`'https://happywhale.com/individual/' || individual_id || ';enc=' || e.id`.
There is **zero** use of `/encounter/{id}` as a viewable URL anywhere in the repo.
The public web app is a JS SPA so an unauthenticated WebFetch could not confirm
the live page format independently.
**How to avoid:** build HappyWhale `source_url` as
`'https://happywhale.com/individual/' || individual_id || ';enc=' || id`
(uses `happywhale.encounters.individual_id`, a same-table NOT NULL column). If the
team wants to confirm the exact viewable form first, **gate the HW backfill on a
checkpoint:human-verify** task; the safe fallback is to leave HW `source_url`
NULL (HW is export-excluded per SRC-01, so this has no archive payoff — only
internal-provenance completeness).
**Warning signs:** any `source_url` containing `/encounter/` is suspect.

### Pitfall 2: SET NOT NULL before backfill
**What goes wrong:** `ALTER … SET NOT NULL` on `provider_id` fails if any row is
still NULL. **How to avoid:** strict ordering — ADD (no default yet) → UPDATE
slug-join → SET NOT NULL → SET DEFAULT. The DEFAULT must come *after* the backfill
(it only governs *future* rows; it does not retro-fill). Verified: the order
above succeeded on 416 live maplify rows.

### Pitfall 3: provider DEFAULT cannot be a subquery
**What goes wrong:** `ALTER … SET DEFAULT (SELECT id FROM public.providers …)` is
rejected with "cannot use subquery in DEFAULT expression" (verified). **How to
avoid:** resolve the id at migration time inside a `DO $$ … EXECUTE format(…) $$`
block so a plain integer literal lands in the catalog (`pg_get_expr` shows e.g.
`2`). This is the entire reason D-04 rejected a GENERATED `provider_id`.

### Pitfall 4: Generated column on a table that later changes the source column
**What goes wrong:** a STORED generated column pins to its source expression; if a
later migration drops/renames `url`/`uri` it must drop the generated column first.
**How to avoid:** out of scope this phase, but note in the migration comment that
`source_url` depends on `url`/`uri`. Low risk — no such change is planned.

### Pitfall 5: Synthetic SC#4 insert and the NOTIFY trigger
**What goes wrong:** `maplify.sightings` carries an AFTER-INSERT trigger
`occurrences_changed_after_maplify_sightings` (NOTIFY). A naive assertion insert
fires it and, if not rolled back, leaves a junk row and changes row counts —
violating SC#4's "row counts unchanged". **How to avoid:** run the SC#4 insert
inside a transaction that **ROLLBACKs** (or DELETE the synthetic row), and assert
counts before/after. The trigger NOTIFY is harmless (no listener in the test).
RLS is **not** a factor — maplify/inat/happywhale tables have **no RLS**, and the
snippet runs as the `postgres` superuser anyway.

### Pitfall 6: `inaturalist.observations.uri` is NOT NULL
Not a problem — a generated column from a NOT NULL source is fine and means SC#3's
"populated … for all rows" holds by construction (every row's `source_url` = its
non-null `uri`). Verified: 201/201 local rows populated on ADD.

## Code Examples

All examples below were executed against the project's running local DB
(Postgres 17.6) and produced the stated results.

### Generated column from a nullable source — populates, shows in \d, can't be UPDATEd
```sql
-- Source: live test against local Supabase (Postgres 17.6)
ALTER TABLE public.observations ADD COLUMN source_url TEXT GENERATED ALWAYS AS (url) STORED;
-- \d public.observations shows:
--   source_url | text | … | generated always as (url) stored
-- UPDATE public.observations SET source_url = 'x';
--   ERROR: column "source_url" can only be updated to DEFAULT
```

### Backfill → NOT NULL → migration-resolved DEFAULT (no literal in source)
```sql
-- Source: live test against local Supabase (Postgres 17.6)
UPDATE maplify.sightings SET provider_id = p.id FROM public.providers p WHERE p.slug = 'maplify';  -- UPDATE 416
ALTER TABLE maplify.sightings ALTER COLUMN provider_id SET NOT NULL;
DO $$ BEGIN
  EXECUTE format('ALTER TABLE maplify.sightings ALTER COLUMN provider_id SET DEFAULT %s',
                 (SELECT id FROM public.providers WHERE slug = 'maplify'));
END $$;
-- pg_get_expr(adbin, adrelid) for provider_id default  →  '2'  (a plain literal, no subquery)
-- A new INSERT omitting provider_id now gets 2 automatically.
```

### Proof a subquery DEFAULT is rejected (justifies D-04)
```sql
-- Source: live test against local Supabase (Postgres 17.6)
ALTER TABLE maplify.sightings ALTER COLUMN provider_id
  SET DEFAULT (SELECT id FROM public.providers WHERE slug='maplify');
--   ERROR: cannot use subquery in DEFAULT expression
```

### SC#4 synthetic insert (NULL collection_id, defaulted provider_id)
```sql
-- Source: live test against local Supabase (Postgres 17.6) — ran inside BEGIN/ROLLBACK
INSERT INTO maplify.sightings
  (id, project_id, trip_id, scientific_name, location, number_sighted,
   created_at, in_ocean, moderated, trusted, is_test, source)
VALUES (999999999, 0, 0, 'Orcinus orca',
        gis.ST_Point(-123,48)::gis.geography, 1, now(), true, 0::smallint, false, true, 'test');
-- → row: provider_id=2 (defaulted), collection_id=NULL, contributor_id=NULL, source_url=NULL
```

## Validation Architecture

> `nyquist_validation` is enabled (config `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | psql assertion snippet (`DO $$ … RAISE EXCEPTION … $$`) mirroring `supabase/snippets/05_dwc_assertions.sql` and the `09` precedent. (Vitest exists for app TS but is **not** the tool for a SQL-schema phase.) |
| Config file | none — snippet is self-contained |
| Quick run command | `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/snippets/10_fk_columns_assertions.sql` |
| Full suite command | same as above (exit 0 = all SC pass; non-zero = first failing block's RAISE message names the SC) |

### Phase Requirements → Test Map (the 4 Success Criteria)
| SC | Behavior | Test Type | Automated assertion | File |
|----|----------|-----------|---------------------|------|
| SC#1 | All four columns exist on all four tables, correct nullability (`provider_id` NOT NULL by D-05; others nullable) | schema | Query `information_schema.columns` for each (schema,table,column); assert presence + `is_nullable` | ❌ Wave 0 — `supabase/snippets/10_fk_columns_assertions.sql` |
| SC#2 | `collection_id` indexed on the two exported tables | schema | Assert a row in `pg_indexes` for `public.observations` and `maplify.sightings` whose `indexdef` includes `collection_id` | ❌ Wave 0 |
| SC#3 | native `source_url` = `url` where url not null; iNat `source_url` = `uri` for all rows | data | `COUNT(*) WHERE url IS NOT NULL AND source_url IS DISTINCT FROM url` = 0 (native); `COUNT(*) WHERE source_url IS DISTINCT FROM uri` = 0 (iNat) | ❌ Wave 0 |
| SC#4 | New Maplify insert with NULL collection_id succeeds; row counts unchanged | data | Capture `COUNT(*)`; `BEGIN`; synthetic insert (NULL collection_id, omit provider_id); assert it succeeded + provider_id defaulted; `ROLLBACK`; assert `COUNT(*)` unchanged | ❌ Wave 0 |

Suggested extra assertions (belt-and-suspenders, cheap):
- `provider_id` fully backfilled: `COUNT(*) WHERE provider_id IS NULL` = 0 on each table.
- `provider_id` default is set: `pg_attrdef` has a default for each table's `provider_id`.
- HappyWhale `source_url` non-null for all rows **if** D-09 backfill ran (and matches the `individual/…;enc=…` shape, not `/encounter/`).

### Sampling Rate
- **Per task commit:** `supabase db reset` then run the assertion snippet.
- **Per wave merge / phase gate:** full snippet green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `supabase/snippets/10_fk_columns_assertions.sql` — covers SC#1–SC#4 (new file; model on `05_dwc_assertions.sql` header/run-block style).
- [ ] No framework install needed (psql is bundled with the Supabase stack).

### Concrete assertion sketch (drop-in starting point)
```sql
\set ON_ERROR_STOP on
\echo === Phase 10 source-table FK column verification ===

-- SC#1: presence + nullability of all four columns on all four tables
DO $$
DECLARE r RECORD; tbls TEXT[][] := ARRAY[
  ARRAY['public','observations'], ARRAY['maplify','sightings'],
  ARRAY['inaturalist','observations'], ARRAY['happywhale','encounters']];
  t TEXT[]; n INT;
BEGIN
  FOREACH t SLICE 1 IN ARRAY tbls LOOP
    -- four columns present
    SELECT count(*) INTO n FROM information_schema.columns
      WHERE table_schema=t[1] AND table_name=t[2]
        AND column_name IN ('provider_id','collection_id','contributor_id','source_url');
    IF n <> 4 THEN RAISE EXCEPTION 'SC#1 FAIL: %.% missing FK columns (found %/4)', t[1],t[2],n; END IF;
    -- provider_id NOT NULL (D-05 deviation)
    PERFORM 1 FROM information_schema.columns
      WHERE table_schema=t[1] AND table_name=t[2] AND column_name='provider_id' AND is_nullable='NO';
    IF NOT FOUND THEN RAISE EXCEPTION 'SC#1 FAIL: %.%.provider_id is nullable (expected NOT NULL, D-05)', t[1],t[2]; END IF;
    -- collection_id + contributor_id nullable
    PERFORM 1 FROM information_schema.columns
      WHERE table_schema=t[1] AND table_name=t[2] AND column_name='collection_id' AND is_nullable='YES';
    IF NOT FOUND THEN RAISE EXCEPTION 'SC#1 FAIL: %.%.collection_id not nullable', t[1],t[2]; END IF;
    PERFORM 1 FROM information_schema.columns
      WHERE table_schema=t[1] AND table_name=t[2] AND column_name='contributor_id' AND is_nullable='YES';
    IF NOT FOUND THEN RAISE EXCEPTION 'SC#1 FAIL: %.%.contributor_id not nullable', t[1],t[2]; END IF;
  END LOOP;
END $$;

-- SC#2: collection_id indexed on the two exported tables
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM pg_indexes
    WHERE ((schemaname='public' AND tablename='observations')
        OR (schemaname='maplify' AND tablename='sightings'))
      AND indexdef ILIKE '%collection_id%';
  IF n < 2 THEN RAISE EXCEPTION 'SC#2 FAIL: collection_id index missing on an exported table (found %)', n; END IF;
END $$;

-- SC#3: source_url tracks url/uri
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM public.observations WHERE url IS NOT NULL AND source_url IS DISTINCT FROM url;
  IF n > 0 THEN RAISE EXCEPTION 'SC#3 FAIL: % native rows where source_url <> url', n; END IF;
  SELECT count(*) INTO n FROM inaturalist.observations WHERE source_url IS DISTINCT FROM uri;
  IF n > 0 THEN RAISE EXCEPTION 'SC#3 FAIL: % iNat rows where source_url <> uri', n; END IF;
END $$;

-- SC#4: NULL-collection insert succeeds; counts unchanged
DO $$
DECLARE before_n BIGINT; after_n BIGINT; defaulted INT;
BEGIN
  SELECT count(*) INTO before_n FROM maplify.sightings;
  INSERT INTO maplify.sightings
    (id, project_id, trip_id, scientific_name, location, number_sighted,
     created_at, in_ocean, moderated, trusted, is_test, source)
  VALUES (999999999, 0, 0, 'Orcinus orca',
          gis.ST_Point(-123,48)::gis.geography, 1, now(), true, 0::smallint, false, true, 'test');
  SELECT provider_id INTO defaulted FROM maplify.sightings WHERE id=999999999;
  IF defaulted IS NULL THEN RAISE EXCEPTION 'SC#4 FAIL: provider_id default did not apply'; END IF;
  DELETE FROM maplify.sightings WHERE id=999999999;             -- restore (or wrap caller in ROLLBACK)
  SELECT count(*) INTO after_n FROM maplify.sightings;
  IF before_n <> after_n THEN RAISE EXCEPTION 'SC#4 FAIL: row count changed % -> %', before_n, after_n; END IF;
END $$;

\echo === All Phase 10 assertions passed ===
```
> Note: run this against a freshly `supabase db reset` DB. Locally
> `public.observations` and `happywhale.encounters` have **0 rows** (so SC#3
> native + any HW assertion is trivially satisfied locally) — the assertions are
> structurally correct and become load-bearing against prod data. Confirmed local
> counts: native 0, iNat 201, HW 0, maplify 416.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Maintained duplicate column kept in sync via trigger | `GENERATED ALWAYS AS (col) STORED` | Postgres 12 (2019) | No drift, no trigger, no backfill UPDATE — used for `source_url` (D-06) |
| Positional `INSERT … SELECT t.*` in `maplify.update_sightings` | Explicit-column `MERGE … INSERT (cols) VALUES (…)` | `20250922194148_more_maplify_fix.sql` | Adding columns no longer breaks ingest — D-14 is safe |

**Deprecated/outdated:** none relevant.

## Schema Push / Deploy

- **Local apply / verify:** `supabase db reset` (re-applies all migrations + seed
  in order), then run the assertion snippet via psql.
- **Remote apply:** pushes to `main` **auto-deploy to production** via
  `.github/workflows/deploy.yml`; migrations are applied as part of that deploy
  (project convention — see project MEMORY). The planner's apply step should be
  "add the migration file + snippet, verify locally with `supabase db reset`,
  commit; deploy happens on merge to main." **No new env var or GitHub Actions
  secret is required** for this phase (pure schema change) — so no
  pre-push secret coordination is needed (contrast: only matters when a deploy
  needs a new env var).
- Do **not** prescribe editing ingest RPCs (D-14).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | HappyWhale viewable encounter URL is `https://happywhale.com/individual/{individual_id};enc={id}` (repo-canonical), **not** CONTEXT's `/encounter/{id}` | Pitfall 1, HW DDL, D-09 | If the team actually wants a different viewable form, HW `source_url` values are wrong. Mitigation: gate the HW backfill on human-verify, or fall back to leaving HW `source_url` NULL (HW is export-excluded, no archive impact). This is the single decision needing user confirmation. |
| A2 | Prod row counts (native 436, maplify 6,827, iNat 8,759, HW 5,601) from the executive summary still hold at deploy time | Runtime State Inventory | Counts only inform expectations; the migration is count-agnostic. Low risk. |

## Open Questions

1. **HappyWhale `source_url` exact form** — see A1 / Pitfall 1.
   - What we know: every in-repo HW URL is `individual/{individual_id};enc={id}`;
     the API is `app/cs/encounter/full/{id}`. No `/encounter/{id}` viewable URL exists in the repo.
   - What's unclear: whether the team specifically wants the bare encounter
     permalink form CONTEXT guessed (unverifiable via unauthenticated fetch — SPA).
   - Recommendation: use the repo-canonical form; if any doubt, gate with
     `checkpoint:human-verify` before the HW UPDATE, fallback = leave NULL.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL (local Supabase) | apply + verify migration | ✓ | 17.6 | — |
| psql | run assertion snippet | ✓ | bundled | — |
| Supabase CLI | `db reset` / `db push` | ✓ (project standard) | — | — |
| `gis` (PostGIS) extension | synthetic insert `gis.ST_Point` | ✓ | in schema `gis` | — |

**No missing dependencies.** All four source tables, `public.providers`
(ids 1=direct, 2=maplify, 3=inaturalist, 4=happywhale), and the FK targets exist
in the local DB (Phase 9 applied).

## Security Domain

> `security_enforcement` not set to `false` in config → included. This is a
> schema-only, server-side DDL phase with no new external input surface.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface touched |
| V3 Session Management | no | — |
| V4 Access Control | yes (minor) | New columns inherit each table's existing RLS. `public.observations` keeps its anon SELECT-all + authenticated-own-row policies; maplify/inat/happywhale have **no RLS** (server-fetched data, not user-writable) — adding columns does not change that. No new policy needed. |
| V5 Input Validation | yes (minor) | FK constraints (`REFERENCES public.{providers,collections,contributors}`) are the validation: a bad id is rejected at write time. `provider_id` backfill uses parameterless slug-join (no injection surface). The dynamic-SQL DEFAULT interpolates an **integer** id (`%s` of a `SELECT id`), not user input — no injection risk. |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Dynamic SQL (`EXECUTE format`) injection | Tampering | Interpolated value is a server-side `SELECT id` (integer), never user input — safe. Use `format('%s', …)` with an integer, or `quote_literal` if ever a string. |
| Cross-schema FK exposing private rows | Information Disclosure | FK targets (`public.providers/collections`) are already anon-readable reference tables (Phase 9 RLS = public SELECT). No new exposure. |
| Stale generated TS types masking a column rename | Tampering | Out of scope; no app reads these columns this phase. |

## Sources

### Primary (HIGH confidence)
- **Live local Supabase DB (Postgres 17.6)** — executed: generated-column add +
  populate + UPDATE-rejection; backfill→NOT NULL→dynamic DEFAULT; subquery-DEFAULT
  rejection; full phase-10 DDL on real `maplify.sightings` (416 rows); SC#4
  synthetic insert; partial-index visibility; `\d` output for the generated column.
- `supabase/migrations/20250903172708_initial_schema.sql` — original source-table shapes.
- `supabase/migrations/20260619184037_reference_tables.sql` — FK targets + slugs (Phase 9).
- `supabase/migrations/20260204013006_sightings_uses_contributors.sql` — existing native NOT NULL `contributor_id`.
- `supabase/migrations/20250922194148_more_maplify_fix.sql` — current `maplify.update_sightings` (explicit-column MERGE).
- `supabase/migrations/20250915171505_sighting_policies.sql` — `public.upsert_observation` (explicit-column INSERT) + rename.
- `supabase/migrations/20260617203900_dwc_schema.sql` — dwc views (explicit columns; no `SELECT *` from source tables; only touch native+maplify).
- 15+ migrations (`20250915171505`, `20260204175500`, `20251015151641`, `20251002204623`, `20250929064707`, `20250918165924`, `20250906222306`, `20250914033241`, `20250919044543`, `20250921045207`, `20250924160210`) — HappyWhale URL form `individual/{individual_id};enc={id}`.
- `supabase/snippets/05_dwc_assertions.sql` — assertion-snippet precedent.
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` §2 — prod row counts.

### Secondary (MEDIUM confidence)
- WebSearch (open-oceans/happywhale CLI docs) — confirms HW **API** endpoint
  `https://critterspot.happywhale.com/v1/cs/encounter/full/{id}` /
  `https://happywhale.com/app/cs/encounter/full/{id}` (API, not viewable page).

### Tertiary (LOW confidence)
- WebFetch of `https://happywhale.com/encounter/123456` — inconclusive (SPA; no
  server-rendered content). Used only to confirm the page can't be verified
  unauthenticated → drives the "gate it" recommendation for A1.

## Metadata

**Confidence breakdown:**
- Standard stack / SQL idioms: **HIGH** — every idiom executed live on the project DB.
- Architecture / per-table DDL: **HIGH** — full DDL run against real tables.
- Pitfalls: **HIGH** for ordering, generated-column, dynamic-DEFAULT, ingest-RPC
  safety, RLS, NOTIFY trigger; **MEDIUM-flagged** for the HappyWhale URL form
  (repo precedent is strong but live page unverifiable → A1).

**Research date:** 2026-06-19
**Valid until:** ~2026-07-19 (stable; pure Postgres DDL). Re-verify the HW URL
form (A1) before the HappyWhale backfill ships.
