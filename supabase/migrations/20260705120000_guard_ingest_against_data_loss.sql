-- Urgent in-place stopgaps for two ingest data-integrity bugs, ahead of the
-- TypeScript ingest rewrite (epic salishsea-io-89d / decision 011).
--
--   (A) salishsea-io-t4v — maplify.update_sightings deletes ~10 days of live
--       sightings on any failed/empty upstream fetch. Its MERGE ends with
--       WHEN NOT MATCHED BY SOURCE ... THEN DELETE, and the source is
--       maplify.fetch_date_range, which returns ZERO rows on any non-200
--       (it filters WHERE status = 200) and one empty-array row on a 200 with
--       no results. Either way the MERGE source is empty, so every sighting in
--       the window becomes NOT MATCHED BY SOURCE and is DELETEd. Runs every
--       5 min, so a transient Maplify outage repeatedly wipes the live map.
--
--   (B) salishsea-io-biz — inaturalist.update_observations fetches only page 1
--       (200 records) and ignores the total_results it already receives, so any
--       window with >200 in-scope observations silently drops the overflow.
--
-- Both are converted from LANGUAGE sql to plpgsql to get the explicit control
-- flow (a guard / a loop) that raw SQL cannot express here. This is a stopgap:
-- decision 011 moves all of this into a TypeScript imperative shell with proper
-- fetch-completeness validation, retry, and logging.

-- =====================================================================
-- (A) maplify.update_sightings — guard the reconcile DELETE on a
--     successful, non-empty fetch.
--
-- Behaviour vs. the previous version: identical MERGE (same taxon mapping,
-- rwsas/wras filters, resolve_collection, MATCHED/INSERT clauses, RETURNING)
-- EXCEPT it now fetches once into a variable and skips the whole MERGE when the
-- fetch failed (results IS NULL) or returned nothing (length 0), leaving
-- existing sightings intact until the next good fetch.
--
-- This is intentionally MORE conservative than decision 011, which treats an
-- empty-200 as authoritative (reconcile the window to empty). Raw SQL cannot
-- validate that a 200 with an empty body is a genuine "no sightings" answer
-- rather than a soft upstream failure, so the stopgap never deletes on empty.
-- The TS rewrite restores authoritative-empty behind real completeness checks.
-- =====================================================================
CREATE OR REPLACE FUNCTION maplify.update_sightings(
  start_date date DEFAULT CURRENT_DATE,
  end_date date DEFAULT CURRENT_DATE
) RETURNS TABLE(sighting_id integer, action text)
LANGUAGE plpgsql AS $$
DECLARE
  results jsonb;
BEGIN
  -- fetch_date_range returns SETOF jsonb: exactly one row (the `results` array)
  -- on HTTP 200, and ZERO rows on any non-200. So `results` is left NULL by a
  -- failed fetch and an empty array by a successful-but-empty fetch.
  SELECT fetched
    INTO results
    FROM maplify.fetch_date_range(
           start_date, end_date,
           gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54))
         ) AS fetched;

  -- DATA-LOSS GUARD (salishsea-io-t4v): only reconcile when the fetch
  -- demonstrably succeeded AND returned rows. A failed or empty fetch is never
  -- interpreted as "upstream deleted everything".
  IF results IS NULL OR jsonb_array_length(results) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  MERGE INTO maplify.sightings AS s
  USING (
    SELECT
      v.id,
      project_id,
      trip_id,
      v.scientific_name,
      number_sighted,
      created,
      NULLIF(TRIM(photo_url), '') AS photo_url,
      "comments",
      in_ocean,
      moderated,
      "trusted",
      is_test,
      "source",
      usernm,
      "name",
      gis.ST_Point(longitude, latitude)::gis.geography AS location,
      t.id AS taxon_id
    FROM
      jsonb_to_recordset(results) AS v (
        id int,
        project_id int,
        trip_id int,
        scientific_name varchar,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        number_sighted int,
        created timestamp,
        photo_url varchar,
        comments varchar,
        in_ocean boolean,
        moderated smallint,
        trusted boolean,
        is_test boolean,
        source varchar,
        usernm VARCHAR,
        "name" VARCHAR
      )
      LEFT JOIN inaturalist.taxa AS t ON t.scientific_name = COALESCE(
        NULLIF(TRIM(v.scientific_name), ''),
        CASE v.name
          WHEN 'Killer Whale (Orca)' THEN 'Orcinus orca'
          WHEN 'Southern Resident Killer Whale' THEN 'Orcinus orca ater'
          WHEN 'Grey' THEN 'Eschrichtius robustus'
          WHEN 'California Sea Lion' THEN 'Zalophus californianus'
          WHEN 'Pacific White-sided Dolphin' THEN 'Sagmatias obliquidens'
        END
      )
    WHERE source != 'rwsas'
      AND source IS DISTINCT FROM 'wras'
  ) AS v ON v.id = s.id
  WHEN MATCHED THEN UPDATE SET
    "name" = v.name,
    scientific_name = v.scientific_name,
    "location" = v.location,
    number_sighted = v.number_sighted,
    photo_url = v.photo_url,
    "comments" = v.comments,
    moderated = v.moderated,
    "trusted" = v.trusted,
    is_test = v.is_test,
    "source" = v.source,
    usernm = v.usernm,
    taxon_id = v.taxon_id
  WHEN NOT MATCHED BY TARGET
    THEN INSERT (
      id, project_id, trip_id, scientific_name, location, number_sighted, created_at, photo_url,
      "comments", in_ocean, moderated, trusted, is_test, "source", usernm, "name", taxon_id,
      collection_id
    ) VALUES (
      v.id, v.project_id, v.trip_id, v.scientific_name, v.location, v.number_sighted, v.created, v.photo_url,
      v.comments, v.in_ocean, v.moderated, v.trusted, v.is_test, v.source, v.usernm, v.name, v.taxon_id,
      maplify.resolve_collection(v.comments, v.source)
    )
  WHEN NOT MATCHED BY SOURCE
    AND s.created_at BETWEEN start_date::TIMESTAMP AND (end_date + 1)::TIMESTAMP
    THEN DELETE
  RETURNING s.id, MERGE_ACTION();
END;
$$;

-- =====================================================================
-- (B) inaturalist.update_observations — paginate through total_results
--     instead of fetching only page 1.
--
-- iNaturalist has no window-wide reconcile DELETE (upsert_observation_page
-- upserts observations and reconciles photos only within each page's ids), so
-- the failure mode here is silent truncation, not data loss. A partial fetch
-- (a mid-pagination error) just upserts fewer pages; the idempotent upsert
-- makes the next 5-minute run re-fetch and fill in. Loop until we've retrieved
-- all in-window observations or hit an empty page.
-- =====================================================================
CREATE OR REPLACE FUNCTION inaturalist.update_observations(from_date date, to_date date)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  page_no int := 1;
  per_page constant int := 200;
  v_total int;
  v_results jsonb;
  fetched int := 0;
BEGIN
  LOOP
    SELECT p.total_results, p.results
      INTO v_total, v_results
      FROM inaturalist.fetch_observation_page(
             from_date, to_date,
             gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)),
             array[152871, 372843, 526556],
             page_no, per_page
           ) AS p;

    -- Empty or malformed/failed page: stop. (fetch_observation_page does not
    -- filter on status, so a non-200 typically yields NULL results here.)
    EXIT WHEN v_results IS NULL OR jsonb_array_length(v_results) = 0;

    PERFORM inaturalist.upsert_observation_page(v_results);

    fetched := fetched + jsonb_array_length(v_results);
    EXIT WHEN v_total IS NULL OR fetched >= v_total;

    page_no := page_no + 1;
    -- Safety backstop: iNat page-based pagination caps at 10 000 records
    -- (page * per_page <= 10 000); never loop past it.
    EXIT WHEN page_no > 50;
  END LOOP;
END;
$$;
