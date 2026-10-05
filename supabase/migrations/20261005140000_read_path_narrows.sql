-- The read-path build's role narrows to what the build still reads from Postgres
-- (decision 064, salish-9uu.2.5).
--
-- Since the build fetches Maplify, iNaturalist and Orcasound itself (decision 061), takes
-- the reference tables and the catalogue from checked-in files, fetches the register's
-- release, and reads Happywhale's frozen tables from a file on its volume (064), its
-- snapshot reads only what users write: native sightings, their photos, contributors
-- and the identifications people assert. read_path keeps those, with the columns it had,
-- and gis, whose st_x and st_y the snapshot calls.
--
-- One deliberate exception: Happywhale's tables, which nothing reads each build but which
-- the runbook's recovery re-exports from Postgres as this role if the volume's frozen file
-- is ever lost (happywhale-export.ts). They go with Postgres at the cutover.
--
-- Revoking a privilege on a table revokes the matching column privileges too.

REVOKE SELECT ON
  public.animal_names, public.designations, public.ecotype_occurrences, public.group_occurrences,
  public.group_parents, public.haulout_occurrences, public.haulouts, public.individual_occurrences,
  public.individuals, public.matriline_members, public.nicknames, public.occurrences, public.parties,
  public.social_groups, public.acoustic_bouts, public.acoustic_bout_entities, public.collections,
  public.organizations, public.providers
FROM read_path;

REVOKE SELECT ON ALL TABLES IN SCHEMA derived, inaturalist, maplify, register FROM read_path;
REVOKE USAGE ON SCHEMA derived, inaturalist, maplify, register FROM read_path;
