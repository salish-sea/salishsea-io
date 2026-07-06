-- Dedicated least-privilege login role for the ingest Edge Function
-- (decision 011 / salishsea-io-wco). The shell currently falls back to the
-- platform superuser DSN (SUPABASE_DB_URL); this role carries exactly what
-- fetch → reconcile → persist touches, and nothing else.
--
-- NO password here — secrets never ship in migrations, so the role cannot log
-- in until one is set out-of-band in prod:
--   ALTER ROLE ingest PASSWORD '...';
-- and delivered to the function as the INGEST_DB_URL secret (which index.ts
-- already prefers over the superuser fallback).
--
-- Privilege surface (from scripts/ingest/persist.ts + functions/ingest/index.ts):
--   ingest.runs                     SELECT, INSERT, UPDATE (audit row protocol)
--   maplify.sightings               SELECT, INSERT, UPDATE, DELETE (reconcile)
--   maplify.collection_rule         SELECT — read via maplify.resolve_collection,
--                                   which is SECURITY INVOKER (LANGUAGE SQL STABLE)
--   inaturalist.taxa                SELECT, INSERT, UPDATE (mirror upsert; no delete)
--   inaturalist.observations        SELECT, INSERT, UPDATE, DELETE (reconcile)
--   inaturalist.observation_photos  SELECT, INSERT, UPDATE, DELETE (reconcile)
-- Not needed:
--   public.collections — the sightings.collection_id FK check runs as the table
--     owner, not the inserting role.
--   realtime.* — notify_occurrences_changed triggers are SECURITY DEFINER.
--   sequences — id columns are GENERATED ... AS IDENTITY (no separate USAGE).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest') THEN
    -- NOINHERIT: the role holds only its direct grants. Connection limit is a
    -- guardrail: the function opens max 2 conns per invocation, two sources.
    CREATE ROLE ingest LOGIN NOINHERIT CONNECTION LIMIT 10;
  END IF;
END $$;

-- gis: persist.ts builds location values via gis.ST_Point(...)::gis.geography,
-- and the geography TYPE itself lives in schema gis — both need schema USAGE
-- (function EXECUTE stays at its PUBLIC default).
GRANT USAGE ON SCHEMA ingest, maplify, inaturalist, gis TO ingest;

GRANT SELECT, INSERT, UPDATE ON ingest.runs TO ingest;
GRANT SELECT, INSERT, UPDATE, DELETE ON maplify.sightings TO ingest;
GRANT SELECT ON maplify.collection_rule TO ingest;
GRANT SELECT, INSERT, UPDATE ON inaturalist.taxa TO ingest;
GRANT SELECT, INSERT, UPDATE, DELETE ON inaturalist.observations TO ingest;
GRANT SELECT, INSERT, UPDATE, DELETE ON inaturalist.observation_photos TO ingest;

-- Explicit (EXECUTE defaults to PUBLIC, but document the dependency).
GRANT EXECUTE ON FUNCTION maplify.resolve_collection(text, text) TO ingest;

-- inaturalist.taxa is the one ingest-touched table with RLS enabled (its only
-- policy is anon/authenticated SELECT); without this, the taxa mirror upsert
-- would silently see zero rows / fail its WITH CHECK.
CREATE POLICY "Ingest worker may maintain the taxa mirror."
  ON inaturalist.taxa FOR ALL TO ingest
  USING (true) WITH CHECK (true);

COMMENT ON ROLE ingest IS
  'Least-privilege login role for the ingest Edge Function (decision 011). Password set out-of-band; reaches only the mirror schemas + ingest.runs.';
