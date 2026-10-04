-- Postgres stops ingesting Orcasound and iNaturalist (decision 061, salish-xv35.9).
--
-- The read-path build fetches both itself every five minutes, into its own mirrors, and
-- since 2026-10-03 salishsea.io serves what it builds (salish-xv35.16): the map, the
-- calendar, the profile pages, link previews and map cards all read the build's files,
-- and the heartbeat reads the build's run log (decision 012, amended). Nothing that
-- reads Postgres needs these two sources fresh: identifications name an occurrence by
-- id with no foreign key, and the Darwin Core export reads native and Maplify
-- sightings only.
--
-- The rows already stored stay, frozen: inaturalist.observations, its photos and taxa,
-- and public.acoustic_bouts with its entities. inaturalist.taxa is still read by the
-- build, for taxa the register names that no ingest of its own reaches, and the weekly
-- taxa refresh keeps those current. The `ingest` Edge Function keeps serving Maplify's
-- job until that one is retired too.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('ingest-orcasound', 'ingest-inaturalist');
