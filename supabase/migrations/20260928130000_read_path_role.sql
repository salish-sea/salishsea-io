-- Least-privilege login role for the read-path build (decision 056): the hourly
-- snapshot that turns what a signed-out visitor reads into static files. It reads
-- exactly the relations those files publish, and nothing else — in particular not
-- contributors' email addresses or feedback, which the build machine never needs.
--
-- NO password here, as for the ingest role: secrets never ship in migrations, so
-- the role cannot log in until one is set out of band in production:
--   ALTER ROLE read_path PASSWORD '...';
-- and delivered to the build as its SUPABASE_DB_URL secret.
--
-- Grow the grants one relation at a time as the build publishes more, and pin
-- each in supabase/read-path-grants.test.ts in the same PR.
--
-- Privilege surface (scripts/read-path/snapshot.ts):
--   public.occurrences   SELECT — the day files. A view owned by the migration
--                        role, so reading it needs no grant on derived.*.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'read_path') THEN
    -- NOINHERIT: only its direct grants. One build at a time, and DuckDB's
    -- Postgres scanner opens a few connections; the limit is a guardrail.
    CREATE ROLE read_path LOGIN NOINHERIT CONNECTION LIMIT 4;
  END IF;
END $$;

-- The snapshot reads the whole relation in one statement. anon's 3 s budget is
-- for a visitor's page load; this is a batch read that runs once an hour.
ALTER ROLE read_path SET statement_timeout = '60s';

GRANT USAGE ON SCHEMA public TO read_path;
GRANT SELECT ON public.occurrences TO read_path;

COMMENT ON ROLE read_path IS
  'Least-privilege login role for the read-path build (decision 056). Password set out of band; reads only what the static files publish.';
