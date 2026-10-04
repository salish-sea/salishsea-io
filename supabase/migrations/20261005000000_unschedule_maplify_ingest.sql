-- Postgres stops ingesting Maplify (decision 061, salish-xv35.9) — the last of the three.
--
-- The read-path build has fetched Maplify itself since 2026-10-02 (salish-xv35.7), into
-- its own mirror, and since 2026-10-03 everything a visitor sees reads what the build
-- publishes (salish-xv35.16); since 2026-10-04 so does the Darwin Core archive. Nothing
-- that reads Postgres needs this source fresh any more: the map, the calendar, the
-- profile pages, the link previews, the map cards and the archive all come from the
-- build's files, and the register-refresh workflow refuses an edition that would un-name
-- Maplify sightings against the build's own published answer, before loading it.
--
-- The rows already stored stay, frozen: maplify.sightings, with the entity_id and
-- collection_id Postgres's ingest resolved. The build no longer reads them except for
-- its twin test (snapshot.ts --answers). The `ingest` Edge Function has no job left to
-- serve and is retired in the migration that follows, with its Vault secrets.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'ingest-maplify';
