---
phase: 10-source-table-fk-columns
reviewed: 2026-06-19T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - supabase/migrations/20260619203013_source_table_fk_columns.sql
  - supabase/snippets/10_fk_columns_assertions.sql
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-06-19
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed the Phase 10 FK-column migration and its verification snippet. I traced
the migration against the actual upstream schema:

- `public.observations` (renamed from `public.sightings` in
  `20250915171505_sighting_policies.sql`) has nullable `url varchar(2000)` →
  `source_url GENERATED ALWAYS AS (url)` is valid.
- `inaturalist.observations.uri` is `varchar(200) NOT NULL` → generated
  `source_url` non-null on every row, as documented.
- `happywhale.encounters.individual_id` is `integer NOT NULL` and `id` is the
  integer PK → the concatenated generated `source_url` expression is legal.
- All four FK targets (`providers.id`, `collections.id`, `contributors.id`) are
  `INTEGER` and the new columns are `INTEGER` — types match.
- `public.occurrences` is a plain VIEW and the realtime trigger only calls
  `pg_notify` (no table writes), so the SC#4 synthetic insert/delete of
  `id=999999999` leaves the database pristine. Cleanup is sound.
- The SC#4 insert supplies all 12 NOT NULL maplify.sightings columns in correct
  positional order; `gis.ST_Point(...)::gis.geography` matches repo convention.

The locked design decisions (provider_id NOT NULL, dynamic-DEFAULT idiom,
generated source_url forms, unmodified ingest RPCs, nullable collection_id) are
implemented correctly and are not re-litigated here.

Core correctness — column-add → backfill → SET NOT NULL → DEFAULT ordering, FK
target/type compatibility, and idempotency-of-effect — is sound. The findings
below concern robustness and re-runnability, not correctness of the happy path.

## Warnings

### WR-01: Migration is not re-runnable — bare `ADD COLUMN` / `CREATE INDEX` without `IF NOT EXISTS`

**File:** `supabase/migrations/20260619203013_source_table_fk_columns.sql:38-41, 65-67, 77-81, 101-103, 112-116, 152-161`
**Issue:** Every `ADD COLUMN` and `CREATE INDEX` is unguarded. If this migration
partially applies and a retry occurs, or if it is replayed against a dev database
where some of these columns/indexes were created manually, it aborts with
"column already exists" / "relation already exists". This is inconsistent with the
immediately-preceding Phase 9 migration
(`20260619184037_reference_tables.sql:147`), which deliberately uses
`ADD COLUMN IF NOT EXISTS orcid` and documents the idempotency intent. Supabase's
migration tracker normally prevents replay, but partial-failure recovery (e.g.,
the DEFAULT DO-block failing mid-migration on prod) leaves the migration row
un-recorded while columns already exist, forcing a manual cleanup before retry.
**Fix:** Make the structural statements idempotent to match the Phase 9 convention:
```sql
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS provider_id   INTEGER REFERENCES public.providers(id),
  ADD COLUMN IF NOT EXISTS collection_id INTEGER REFERENCES public.collections(id),
  ADD COLUMN IF NOT EXISTS source_url    TEXT GENERATED ALWAYS AS (url) STORED;
...
CREATE INDEX IF NOT EXISTS observations_collection_id
  ON public.observations (collection_id)
  WHERE collection_id IS NOT NULL;
```
Apply the same to the other three tables.

### WR-02: DEFAULT DO-block fails with an opaque syntax error if a provider slug is unseeded

**File:** `supabase/migrations/20260619203013_source_table_fk_columns.sql:56-61, 93-98, 128-133, 173-178`
**Issue:** Each DEFAULT block interpolates the slug→id subquery result directly into
`format('... SET DEFAULT %s', (SELECT id FROM public.providers WHERE slug = '...'))`.
If the matching provider row is absent, the subquery returns NULL, `%s` renders an
empty string, and the executed text becomes `ALTER TABLE ... SET DEFAULT ` — a bare
syntax error rather than an actionable message. In the current flow the preceding
`ALTER COLUMN provider_id SET NOT NULL` would already fail (every row would be NULL),
so this is latent, not live. But the migration's own header comment (lines 25-27)
asserts robustness "if a slug is missing," and this block does not deliver it.
**Fix:** Resolve the id into a guarded variable and raise a clear error:
```sql
DO $$
DECLARE pid INT;
BEGIN
  SELECT id INTO pid FROM public.providers WHERE slug = 'direct';
  IF pid IS NULL THEN
    RAISE EXCEPTION 'provider slug "direct" not found — seed providers before this migration';
  END IF;
  EXECUTE format(
    'ALTER TABLE public.observations ALTER COLUMN provider_id SET DEFAULT %s', pid);
END $$;
```
Apply the same guard to the maplify/inaturalist/happywhale blocks.

## Info

### IN-01: SC#2 index assertion can over-count and pass even if the intended index is missing

**File:** `supabase/snippets/10_fk_columns_assertions.sql:99-106`
**Issue:** SC#2 counts `pg_indexes` rows on the two exported tables whose `indexdef`
matches `ILIKE '%collection_id%'` and requires `n >= 2`. This matches *any* index
whose definition string contains the substring `collection_id` (e.g., a future
composite index, or an index whose name happens to contain that token), not
specifically the two partial `*_collection_id` indexes this phase creates. In
principle the assertion could reach 2 from unrelated indexes while one of the
intended partial indexes is absent, yielding a false pass.
**Fix:** Assert each named index explicitly:
```sql
PERFORM 1 FROM pg_indexes
  WHERE schemaname='public' AND tablename='observations' AND indexname='observations_collection_id';
IF NOT FOUND THEN RAISE EXCEPTION 'SC#2 FAIL: observations_collection_id index missing'; END IF;
PERFORM 1 FROM pg_indexes
  WHERE schemaname='maplify' AND tablename='sightings' AND indexname='sightings_collection_id';
IF NOT FOUND THEN RAISE EXCEPTION 'SC#2 FAIL: sightings_collection_id index missing'; END IF;
```

### IN-02: SC#4 leaves the synthetic row behind if a later assertion-block statement throws before DELETE

**File:** `supabase/snippets/10_fk_columns_assertions.sql:161-189`
**Issue:** The SC#4 block guards the two early RAISE paths with an explicit
`DELETE` before raising, but the trailing logic (the `SELECT provider_id ...` and
the final count comparison) is not wrapped in `BEGIN ... EXCEPTION`. If any
statement between the INSERT and the final `DELETE` raised unexpectedly (e.g., the
NOTIFY trigger erroring, or a future edit adding a check), the inserted
`id=999999999` row would persist and pollute the database the snippet claims to
leave pristine. This is defensive only — the current statements cannot realistically
throw — but the manual `DELETE`-before-`RAISE` pattern already signals the author's
intent to always clean up.
**Fix:** Wrap the insert-through-assertions body in a sub-block with an
`EXCEPTION WHEN OTHERS` handler that deletes the synthetic row and re-raises:
```sql
BEGIN
  INSERT INTO maplify.sightings (...) VALUES (999999999, ...);
  ... assertions ...
EXCEPTION WHEN OTHERS THEN
  DELETE FROM maplify.sightings WHERE id = 999999999;
  RAISE;
END;
DELETE FROM maplify.sightings WHERE id = 999999999;
```

---

_Reviewed: 2026-06-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
