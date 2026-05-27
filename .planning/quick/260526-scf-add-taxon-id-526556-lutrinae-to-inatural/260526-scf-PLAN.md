---
phase: quick-260526-scf-add-taxon-id-526556-lutrinae-to-inatural
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - supabase/migrations/20260526000000_inat_add_lutrinae.sql
autonomous: true
requirements:
  - GH-267
must_haves:
  truths:
    - "Cron-scheduled iNaturalist fetch (every 5 min) queries taxon 526556 (Lutrinae) in addition to existing taxa 152871 and 372843"
    - "Running `supabase db reset` (or applying the new migration) succeeds without error against current local schema"
    - "After the migration is applied, `inaturalist.update_observations(current_date - 1, current_date)` runs without error and the function source includes 526556"
  artifacts:
    - path: "supabase/migrations/20260526000000_inat_add_lutrinae.sql"
      provides: "CREATE OR REPLACE of inaturalist.update_observations with taxon_ids = [152871, 372843, 526556]"
      contains: "526556"
  key_links:
    - from: "inaturalist.update_observations"
      to: "inaturalist.fetch_observation_page"
      via: "taxon_ids integer[] argument"
      pattern: "array\\[152871,\\s*372843,\\s*526556\\]"
---

<objective>
Add iNaturalist taxon 526556 (Lutrinae — otters) to the recurring observation fetch so river/sea otter sightings near the Salish Sea show up alongside cetaceans.

Purpose: Close GitHub issue #267. The cron job `load-recent-inaturalist-observations` calls `inaturalist.update_observations`, which currently fetches only taxa 152871 and 372843. Adding 526556 expands coverage to Lutrinae.

Output: A single new Supabase migration file under `supabase/migrations/` that redefines `inaturalist.update_observations` with the expanded taxon list.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@supabase/migrations/20250914232212_cron.sql

<interfaces>
<!-- Current definition of the function being updated. Extracted from supabase/migrations/20250914232212_cron.sql lines 141-151. -->
<!-- Note: no later migration redefines `inaturalist.update_observations` (verified by grep across supabase/migrations/). -->

```sql
CREATE OR REPLACE FUNCTION inaturalist.update_observations(from_date date, to_date date) RETURNS void VOLATILE LANGUAGE SQL AS $$
  SELECT *
  FROM inaturalist.fetch_observation_page(
    from_date,
    to_date,
    gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)),
    array[152871, 372843],
    1,
    200),
  inaturalist.upsert_observation_page(results) ups;
$$;
```

Signature of the callee (from same file, lines 107-138):
```
inaturalist.fetch_observation_page(
  earliest date,
  latest date,
  extent gis.box2d,
  taxon_ids integer[],
  page_no integer,
  per_page integer = 200,
  out total_results integer,
  out results jsonb
)
```

Cron schedule that drives the function (line 160):
```
SELECT cron.schedule('load-recent-inaturalist-observations', '*/5 * * * *',
  'SELECT * FROM inaturalist.update_observations(current_date - 10, current_date)');
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create migration that adds taxon 526556 (Lutrinae) to inaturalist.update_observations</name>
  <files>supabase/migrations/20260526000000_inat_add_lutrinae.sql</files>
  <action>
Create a new Supabase migration file at exactly `supabase/migrations/20260526000000_inat_add_lutrinae.sql`. Migration timestamp `20260526000000` follows the existing `YYYYMMDDHHMMSS` convention used in this directory (latest tracked migration is `20260330000000_occurrences_realtime_notify.sql`) and is greater than that timestamp so ordering is preserved.

The migration contains exactly one statement: a `CREATE OR REPLACE FUNCTION inaturalist.update_observations(from_date date, to_date date) RETURNS void VOLATILE LANGUAGE SQL AS $$ ... $$;` block. The body is identical to the current definition in `supabase/migrations/20250914232212_cron.sql` (lines 141-151) EXCEPT the `taxon_ids` array literal changes from `array[152871, 372843]` to `array[152871, 372843, 526556]`.

Do NOT touch `fetch_observation_page`, `upsert_observation_page`, `ensure_taxa`, or the cron schedule — those already accept `integer[]` and need no changes. Do NOT modify the existing `20250914232212_cron.sql` file; create a brand-new migration as is conventional in this repo (see prior `fix_inat_upsert`, `tweak_upsert_observation`, etc.). Include a one-line SQL comment at the top of the file referencing GitHub issue #267 and naming Lutrinae so future readers know why 526556 was added.
  </action>
  <verify>
    <automated>test -f supabase/migrations/20260526000000_inat_add_lutrinae.sql && grep -q "CREATE OR REPLACE FUNCTION inaturalist.update_observations" supabase/migrations/20260526000000_inat_add_lutrinae.sql && grep -Eq "array\[152871,\s*372843,\s*526556\]" supabase/migrations/20260526000000_inat_add_lutrinae.sql && ! grep -v '^--' supabase/migrations/20260526000000_inat_add_lutrinae.sql | grep -Eq "array\[152871,\s*372843\][^,]"</automated>
  </verify>
  <done>
Migration file exists at the exact path above. It contains a single `CREATE OR REPLACE FUNCTION inaturalist.update_observations` statement whose `taxon_ids` argument to `inaturalist.fetch_observation_page` is the literal `array[152871, 372843, 526556]`. No other functions or schedules are modified. Top-of-file comment references issue #267 / Lutrinae.
  </done>
</task>

<task type="auto">
  <name>Task 2: Apply the migration locally and confirm the function works</name>
  <files>(no files modified — verification only)</files>
  <action>
Apply the new migration against the local Supabase instance and confirm `inaturalist.update_observations` is callable with the new taxon list. Prefer `supabase migration up` for a non-destructive apply; if the local DB state is incompatible with incremental apply, fall back to `supabase db reset` (acceptable in this project — local DB is reproducible from migrations).

After applying, run a quick smoke query via `supabase db execute` / `psql` to confirm: (a) the function source contains `526556`, and (b) calling `SELECT inaturalist.update_observations(current_date - 1, current_date);` returns without error. The smoke call performs a real HTTP fetch against api.inaturalist.org via `pg_net`/`http`; that is expected behavior — it is the same call the cron job makes every five minutes.

If the local Supabase stack is not running (`supabase status` reports stopped), surface that to the user and stop — do not start it unprompted. Do not push to remote / production from this task; deployment of migrations is handled separately.
  </action>
  <verify>
    <automated>supabase migration up 2>&1 | tail -5 && supabase db execute --local "SELECT pg_get_functiondef('inaturalist.update_observations(date,date)'::regprocedure) ~ '526556' AS has_lutrinae;" | grep -q "t"</automated>
  </verify>
  <done>
`supabase migration up` (or `supabase db reset` fallback) completes without error. `pg_get_functiondef('inaturalist.update_observations(date,date)'::regprocedure)` contains `526556`. A manual `SELECT inaturalist.update_observations(current_date - 1, current_date);` invocation returns without raising a SQL error. (Network-dependent timing of the iNat HTTP call is not asserted.)
  </done>
</task>

</tasks>

<verification>
- New migration file exists at `supabase/migrations/20260526000000_inat_add_lutrinae.sql` and is the only changed file.
- `grep -E "array\[152871,\s*372843,\s*526556\]" supabase/migrations/20260526000000_inat_add_lutrinae.sql` finds exactly the new literal.
- Local DB, after applying migrations, has `inaturalist.update_observations` whose definition contains `526556`.
- Existing cron schedule `load-recent-inaturalist-observations` remains unchanged (still resolves to `inaturalist.update_observations(current_date - 10, current_date)`).
</verification>

<success_criteria>
- Issue #267 is closeable: the cron-driven iNaturalist fetch now includes Lutrinae (taxon 526556) along with the existing cetacean taxa.
- No other migrations are edited; no other functions are altered.
- Migration applies cleanly on a fresh `supabase db reset`.
</success_criteria>

<output>
On completion, create `.planning/quick/260526-scf-add-taxon-id-526556-lutrinae-to-inatural/260526-scf-SUMMARY.md` summarizing: migration filename, before/after taxon list, and confirmation that the function definition contains 526556 after apply. Note that production deploy happens when changes are pushed to `main` (per project memory) — do not push from this task.
</output>
