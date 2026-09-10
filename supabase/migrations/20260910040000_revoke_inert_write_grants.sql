-- Take the write grants off everything a client has no business writing
-- (bd salish-6j6).
--
-- Production grants anon and authenticated INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER on 22 relations in `public`. No migration asked for
-- that: it comes from Supabase's ALTER DEFAULT PRIVILEGES, which grants the
-- lot on every new table created in the schema. The local stack has had those
-- defaults narrowed and production has not, so this is invisible from a laptop
-- (see 20260910040000's sibling, 20260910020000, where that gap let a real hole
-- into production).
--
-- Today the grants are inert, and that was checked rather than assumed. Every
-- policy in `public` except three is FOR SELECT; the exceptions are
-- `feedback` (INSERT, anon — deliberate) and `observations` /
-- `observation_photos` (ALL, scoped to authenticated with ownership
-- predicates). No policy permits an anonymous write anywhere. The views are
-- UNION/aggregate views and are not auto-updatable, so a write fails whatever
-- the grant says.
--
-- The reason to remove them anyway: they are a loaded footgun. A permissive
-- policy added later — entirely reasonable in isolation — is enough on its own
-- to make a table client-writable, because the grant is already sitting there.
-- Defence in depth wants a policy mistake to be insufficient by itself.

DO $$
DECLARE
  rel record;
BEGIN
  FOR rel IN
    SELECT c.oid::regclass AS ident, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    -- anon writes nothing, anywhere.
    --
    -- `feedback` is skipped rather than included: its INSERT is a COLUMN-level
    -- grant (20260910020000), and `REVOKE INSERT ON <table>` takes column-level
    -- grants with it. Revoking here would quietly disable the feedback form —
    -- which is the failure that whole table exists to prevent.
    IF rel.relname <> 'feedback' THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %s FROM anon', rel.ident);
    END IF;

    -- authenticated writes only through the sighting form, which touches
    -- exactly two tables. Everything else it holds is unused.
    --
    -- `feedback` is excluded here for the same reason as above, and it is worth
    -- saying twice because the narrower-looking version of this line is wrong:
    -- dropping 'feedback' from this list would revoke `authenticated`'s
    -- column-level INSERT and break feedback submission for anyone signed in.
    -- Verified rather than assumed — `REVOKE INSERT ON <table>` removes a
    -- column-level grant:
    --
    --     GRANT INSERT (a) ON t TO anon;   -- column privileges: a
    --     REVOKE INSERT ON t FROM anon;    -- column privileges: (none)
    --
    -- The residual risk that skipping it hides a *table-level* grant on
    -- feedback is covered: 20260910020000 does REVOKE ALL before granting
    -- columns, so none survives, and public-grants.test.ts fails if one ever
    -- does — its allowlist is the two sighting tables and nothing else.
    IF rel.relname NOT IN ('feedback', 'observations', 'observation_photos') THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %s FROM authenticated', rel.ident);
    END IF;
  END LOOP;
END $$;

-- Now declare the one write path that is real, because nothing ever has.
--
-- This is the find that made the whole exercise worth doing: **no migration has
-- ever granted INSERT, UPDATE or DELETE on public.observations**. 20260730120000
-- grants SELECT and that is all. Contribution works in production purely
-- because Supabase's default privileges handed the writes over at CREATE TABLE
-- — and it has never worked on the local stack at all, whose defaults are
-- narrow, which is why nobody noticed.
--
-- So the sighting form's permissions were an accident of the schema default in
-- one environment and absent in the other. Revoking the inert grants around
-- them without saying this out loud would leave contribution resting on the
-- same accident, one `ALTER DEFAULT PRIVILEGES` away from breaking with no
-- migration to blame.
--
-- `upsert_observation` is SECURITY INVOKER, so it runs as the signed-in
-- contributor and genuinely needs these; `obs-summary.ts` deletes an
-- observation directly, so DELETE is not optional either. Both paths are
-- exercised by a test in this commit, because breaking them is silent for
-- readers and loud only for someone logged in — which no smoke test that stays
-- logged out will ever catch.
GRANT INSERT, UPDATE, DELETE ON public.observations, public.observation_photos TO authenticated;

-- And nothing beyond them.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.observations, public.observation_photos FROM authenticated;

-- Never read by anything, and there is no policy on the table at all, so the
-- grant is default-denied today. It was reproduced in 20260730120000 purely to
-- match production; it should not exist in either.
REVOKE SELECT ON public.contributor_email_addresses FROM anon, authenticated;
