-- The frontend's routine occurrences query filters on a timestamptz range over
-- `observed_at` (see fetchOccurrences in src/salish-sea.ts). The `occurrences`
-- view is a 4-way UNION ALL; Postgres pushes that range predicate into each
-- branch using the branch's own `observed_at` expression. Two branches had no
-- matching index and were sequentially scanned:
--
--   maplify.sightings     -> created_at AT TIME ZONE 'GMT'
--   happywhale.encounters -> (start_date + coalesce(start_time,'12:00')) AT TIME ZONE timezone
--
-- (inaturalist.observations and public.observations were already covered by
-- plain btree indexes on their raw observed_at columns.)
--
-- These expression indexes match the pushed-down predicates exactly. Both
-- expressions are IMMUTABLE (explicit-zone timezone(text, ...)), so they are
-- valid for indexing.
--
-- NB: not using CREATE INDEX CONCURRENTLY here -- `supabase db push` runs each
-- migration in a pipeline, where CONCURRENTLY raises SQLSTATE 25001. These build
-- takes a brief lock on each table for the duration of the index build.

CREATE INDEX IF NOT EXISTS sightings_observed_at_gmt
  ON maplify.sightings ((created_at AT TIME ZONE 'GMT'));

CREATE INDEX IF NOT EXISTS encounters_observed_at
  ON happywhale.encounters
  (((start_date + COALESCE(start_time, '12:00:00'::time)) AT TIME ZONE timezone));

-- Drop the now-vestigial local-date indexes from 20251026000219. They index
-- date(... AT TIME ZONE 'PST8PDT'), which only serves a date(x) = ... predicate.
-- The query now filters by timestamp range, so nothing uses them.
-- (media_encounter and species_name from that migration are still in use.)

DROP INDEX IF EXISTS maplify.sighting_date;
DROP INDEX IF EXISTS public.observation_date;
DROP INDEX IF EXISTS inaturalist.observation_date;
DROP INDEX IF EXISTS happywhale.encounter_date;
