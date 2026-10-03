-- The read-path build derives Maplify, iNaturalist and Orcasound sightings from its own
-- mirrors (decision 061, salish-xv35.9), which hold only what upstream said. What Postgres
-- adds when it stores one of their rows, the build adds the way Postgres does: an
-- iNaturalist observation's and an Orcasound bout's collection is a column default chosen
-- by the collection's slug (20260620000000_resolution_schema.sql, scripts/ingest/persist.ts).
-- So the build reads the slug too.
--
-- Pinned in supabase/read-path-grants.test.ts.

GRANT SELECT (slug) ON public.collections TO read_path;
