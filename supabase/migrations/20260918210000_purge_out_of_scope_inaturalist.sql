-- Purge iNaturalist observations outside the ingest scope (decision 044, salish-a4y.4).
--
-- The rule, unchanged from decision 036 and now applied to the second source:
-- killer whales are kept from the whole fetch box (the Southern Resident range),
-- everything else only inside the Salish Sea + Strait of Juan de Fuca. From this
-- deploy the ingest function enforces it in isIngestable
-- (scripts/ingest/inaturalist.ts); this one-time DELETE applies the same rule to
-- what was already held, so the corpus is not split by the date the filter
-- shipped. Same shape as migration 20260830200000, which did this for Maplify.
--
-- Dry-run against production on 2026-09-18, with this exact predicate: 81,785
-- observations, 51,637 of them out of scope and 30,148 kept — 63% of everything we
-- held from iNaturalist, against 35% for Maplify. 905 killer whales outside the box
-- are kept. 42,493 of the doomed rows are Californian (latitude under 42), the
-- largest single cluster being 1,894 observations at Pier 39 in San Francisco;
-- 99,348 photo rows travel with them. No public.identifications row referenced any
-- of them (the table is empty in production). Ingest runs every five minutes, so
-- the counts at deploy time will be a little larger; the proportions are the point.
--
-- The box literal is salishSeaExtent from src/extents.ts — [-126, 47, -122, 50.5],
-- inclusive of its edges, as extentContains is. The live rule has one definition
-- (TypeScript); this is a one-shot copy of it, not a second one.
--
-- The killer-whale test differs from the Maplify purge's on purpose. Maplify ships
-- free text, so its migration had to match names with a regex. iNaturalist ships a
-- taxon id and we hold the taxonomy, so this walks inaturalist.taxa from the genus
-- Orcinus (41520) and keeps anything under it — exact rather than approximate, and
-- it picks up the three subspecies without naming them. It descends from the genus
-- rather than testing each row's ancestry because ancestry is not a stored column
-- here; the recursive CTE is the same closure the live predicate reads off
-- ancestor_ids.
--
-- observation_photos has no ON DELETE CASCADE, so its rows go first.

DO $$
DECLARE
  n_photos integer;
  n_deleted integer;
BEGIN
  -- Materialized rather than repeated as a CTE in both DELETEs: the two statements
  -- must name exactly the same set, and a predicate written twice can drift. Dropped
  -- explicitly so the block does not depend on whether a transaction wraps it.
  CREATE TEMP TABLE doomed AS
  WITH RECURSIVE orca AS (
    SELECT id FROM inaturalist.taxa WHERE id = 41520
    UNION ALL
    SELECT t.id FROM inaturalist.taxa t JOIN orca o ON t.parent_id = o.id
  )
  SELECT obs.id
  FROM inaturalist.observations obs
  WHERE NOT (
    gis.ST_X(obs.location::gis.geometry) BETWEEN -126 AND -122
    AND gis.ST_Y(obs.location::gis.geometry) BETWEEN 47 AND 50.5
  )
  AND obs.taxon_id NOT IN (SELECT id FROM orca);

  WITH photos AS (
    DELETE FROM inaturalist.observation_photos
    WHERE observation_id IN (SELECT id FROM doomed)
    RETURNING 1
  )
  SELECT count(*) INTO n_photos FROM photos;

  WITH gone AS (
    DELETE FROM inaturalist.observations
    WHERE id IN (SELECT id FROM doomed)
    RETURNING 1
  )
  SELECT count(*) INTO n_deleted FROM gone;

  DROP TABLE doomed;

  RAISE NOTICE 'purged % out-of-scope inaturalist.observations rows and % of their photos (decision 044)',
    n_deleted, n_photos;
END $$;
