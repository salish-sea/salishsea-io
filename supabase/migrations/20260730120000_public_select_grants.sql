-- Reproduce production's SELECT grants in migrations (salish-0ew).
--
-- These 17 relations carry SELECT for anon/authenticated in production, but no
-- migration ever granted them. Production has 48 such grants; a database built
-- from migrations alone had 14 -- the 34 below (17 relations x 2 roles) were
-- missing entirely -- and its REST API answered
--
--   permission denied for view occurrences
--
-- so a rebuild from migrations would come up unable to serve the frontend at
-- all. Production works only because the grants were applied out of band, and
-- because every subsequent migration touches the views with CREATE OR REPLACE
-- VIEW, which preserves existing grants -- so nothing ever disturbed them
-- there, and nothing ever recreated them anywhere else.
--
-- This is the convention in CLAUDE.md ("SELECT grants ship in the same
-- migration that creates a table") applied retroactively to the relations that
-- predate it.
--
-- Applying this to production is a no-op: GRANT is idempotent and prod already
-- holds every grant below. The point is that local, CI and any future rebuild
-- now match.
--
-- Access itself is unchanged. Every table listed here has RLS enabled, so a
-- grant only opens what a policy already permits.

GRANT SELECT ON public.collections                  TO anon, authenticated;
GRANT SELECT ON public.contributors                 TO anon, authenticated;
GRANT SELECT ON public.designations                 TO anon, authenticated;
GRANT SELECT ON public.group_memberships            TO anon, authenticated;
GRANT SELECT ON public.identifications              TO anon, authenticated;
GRANT SELECT ON public.individuals                  TO anon, authenticated;
GRANT SELECT ON public.observation_photos           TO anon, authenticated;
GRANT SELECT ON public.observations                 TO anon, authenticated;
GRANT SELECT ON public.organizations                TO anon, authenticated;
GRANT SELECT ON public.parties                      TO anon, authenticated;
GRANT SELECT ON public.providers                    TO anon, authenticated;
GRANT SELECT ON public.social_groups                TO anon, authenticated;
GRANT SELECT ON public.user_contributor             TO anon, authenticated;

-- Views over the above.
GRANT SELECT ON public.occurrences                  TO anon, authenticated;
GRANT SELECT ON public.occurrence_identifications   TO anon, authenticated;
GRANT SELECT ON public.occurrence_unresolved_codes  TO anon, authenticated;

-- contributor_email_addresses is granted in production too, and is reproduced
-- here so that a rebuilt database matches it exactly rather than diverging in a
-- way nobody would notice until it mattered.
--
-- The grant is inert: RLS is enabled on this table with ZERO policies, and RLS
-- defaults to deny, so anon and authenticated both read nothing. Verified
-- against production 2026-07-30.
--
-- It should nevertheless not exist. Revoking it in both places is filed
-- separately -- doing it here would mean this migration both restores parity
-- and changes production's permissions, and those belong in different changes.
GRANT SELECT ON public.contributor_email_addresses  TO anon, authenticated;
