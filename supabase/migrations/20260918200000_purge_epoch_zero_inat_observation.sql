-- Purge the iNaturalist observation whose date is the Unix epoch (decision 043, salish-4bi).
--
-- One row: observation 386594579, an elephant seal photographed at Pescadero and
-- uploaded on 2026-07-30, whose observed_on_string is
-- 'Wed Dec 31 1969 16:00:00 GMT -0800 (PST)' — new Date(0).toString() in Pacific
-- time. The observer's client stringified a missing date; iNaturalist stored it
-- as observed and still serves it research-grade and unflagged. It is not a 1969
-- sighting, and it made min(observed_at) over the mirror 1970-01-01 when the
-- genuine earliest record is 1976-02-01 (203014813, an elephant seal at Año
-- Nuevo, dated by hand by an observer in 2024).
--
-- From this deploy scripts/ingest/inaturalist.ts skips the same instant at parse
-- time, under the rule that already skips time_observed_at = null: an undated
-- observation is out of scope, and this is that absence with a value in front of
-- it. This DELETE applies the rule to what was already held, so the corpus is
-- not split by the date the filter shipped — the same shape as the Maplify scope
-- purge (migration 20260830200000, decision 036) and the wras purge before it.
--
-- Measured against production on 2026-09-18: exactly one row at the epoch across
-- all four sources. maplify.sightings begins 2014-04-20, happywhale.encounters
-- 2012-07-11, public.observations 2025-06-16; none carries the artifact.
--
-- The predicate is equality with the epoch, not a plausibility floor. A floor
-- would have to guess where real history stops and would silently drop a
-- scanned 1960s photograph if one were ever uploaded; equality can only drop a
-- record dated to the one second that is indistinguishable from the artifact.
-- It is written as an INSTANT comparison, so it catches the value whatever zone
-- rendered it.
--
-- observation_photos has no ON DELETE CASCADE, so its row goes first. The doomed
-- observation carries one photo and no public.identifications row references it.

DO $$
DECLARE
  n_photos integer;
  n_deleted integer;
BEGIN
  WITH doomed AS (
    SELECT id FROM inaturalist.observations
    WHERE observed_at = timestamptz 'epoch'
  ), photos AS (
    DELETE FROM inaturalist.observation_photos
    WHERE observation_id IN (SELECT id FROM doomed)
    RETURNING 1
  )
  SELECT count(*) INTO n_photos FROM photos;

  WITH gone AS (
    DELETE FROM inaturalist.observations
    WHERE observed_at = timestamptz 'epoch'
    RETURNING 1
  )
  SELECT count(*) INTO n_deleted FROM gone;

  RAISE NOTICE 'purged % epoch-zero inaturalist.observations rows and % of their photos (decision 043)',
    n_deleted, n_photos;
END $$;
