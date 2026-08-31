-- Purge Maplify records outside the ingest scope (decision 036, salish-a4y.2).
--
-- The rule: killer whales are kept from the whole fetch bbox (the Southern
-- Resident range), everything else only inside the Salish Sea + Strait of Juan
-- de Fuca. From this deploy the ingest function enforces it in isIngestable
-- (scripts/ingest/maplify.ts); this one-time DELETE applies the same rule to
-- what was already held, so the corpus is not split by the date the filter
-- shipped. Same shape as the wras purge of 2026-06-20 (CONTEXT.md).
--
-- Measured against production on 2026-08-30: 40,792 rows, 14,146 of them
-- out of scope (mostly Californian humpbacks and gray whales); 242 killer
-- whales outside the box are kept. No public.identifications row referenced
-- any of the doomed rows (0 of 0).
--
-- The box literal is salishSeaExtent from src/extents.ts — [-126, 47, -122,
-- 50.5], inclusive of its edges, as extentContains is. The live rule has one
-- definition (TypeScript); this is a one-shot copy of it, not a second one.
-- The killer-whale test mirrors isKillerWhale: an Orcinus scientific name, or
-- one of the orca common names NAME_TO_SCIENTIFIC maps. The two can differ
-- when a correcting `name` overrides an orca `scientific_name` (isKillerWhale
-- drops it, this keeps it); no out-of-box row in production had that shape
-- on 2026-08-30, so the two readings delete the same rows.

DO $$
DECLARE
  n_deleted integer;
BEGIN
  WITH doomed AS (
    DELETE FROM maplify.sightings
    WHERE NOT (
      gis.ST_X(location::gis.geometry) BETWEEN -126 AND -122
      AND gis.ST_Y(location::gis.geometry) BETWEEN 47 AND 50.5
    )
    AND NOT (
      scientific_name ILIKE 'orcinus%'
      OR lower(name) IN (
        'killer whale (orca)', 'killer whale', 'orca', 'orca (ballena asesina)',
        'southern resident killer whale'
      )
    )
    RETURNING 1
  )
  SELECT count(*) INTO n_deleted FROM doomed;
  RAISE NOTICE 'purged % out-of-scope maplify.sightings rows (decision 036)', n_deleted;
END $$;
