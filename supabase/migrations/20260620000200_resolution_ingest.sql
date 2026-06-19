-- Phase 11: Resolution Ingest Function Edits (RESOLVE-04)
-- Implements RESOLVE-04 from .planning/REQUIREMENTS.md.
--
-- Edits two LIVE production ingest functions:
--   (A) maplify.update_sightings — add collection_id to WHEN NOT MATCHED INSERT
--       and wras filter to the USING subquery (operator decision 2026-06-19).
--       Calls maplify.resolve_collection(v.comments, v.source) in the INSERT VALUES (D-02).
--       NOTE: The PLAN.md referenced an older `BEGIN ATOMIC` / DELETE+INSERT version of this
--       function (20250904165159_fetch_data.sql lines 189-199). The ACTUAL live function
--       (after Phase 1 taxon-mapping rewrites in 20250919-20250922 migrations) is a
--       MERGE-based dollar-quoted SQL function returning TABLE(sighting_id, action).
--       This migration correctly targets the actual live form (Rule 1 auto-fix).
--   (B) inaturalist.upsert_observation_page — add contributor_id wiring in the
--       WHEN NOT MATCHED INSERT clause only (D-16, RESEARCH Pitfall 6).
--       Base: 20251027062024_fix_blank_license.sql (most recent version before Phase 11).
--
-- Intentional deviations / locked decisions honoured:
--   D-02:      resolve_collection(v.comments, v.source) added to MERGE INSERT VALUES.
--   D-12/SC#2: maplify.sightings.comments is never written; it is only READ by
--              resolve_collection in the VALUES expression.
--   D-13/SC#3: contributor_id NOT set in update_sightings (Maplify contributor stays NULL).
--              collection_id NOT added to WHEN MATCHED UPDATE (existing rows keep backfill).
--   D-16:      inaturalist.mint_contributor(v.username) added ONLY to WHEN NOT MATCHED
--              INSERT (new rows get contributor_id); NOT to WHEN MATCHED UPDATE
--              (existing rows keep their backfilled values — RESEARCH Pitfall 6).
--   D-05:      collection_id absent from iNat INSERT → DEFAULT fires for new rows.
--
-- Deliberately departs from Phase-10 D-14 ("don't touch ingest RPCs"):
--   That decision was scoped to Phase 10. Phase 11 RESOLVE-04 explicitly requires editing
--   these functions to enable ongoing collection_id and contributor_id resolution at ingest.
--
-- This migration MUST run AFTER 20260620000000_resolution_schema.sql (plan 11-03) because
-- it calls maplify.resolve_collection and inaturalist.mint_contributor (RESEARCH Pitfall 3).
--
-- RISK MITIGATION (RESEARCH Pitfall 4):
--   - Tested locally via `npx supabase db reset` before prod deploy.
--   - The `maplify.update_sightings` cron runs every 5 min; a bug would break live ingest.
--   - All three migrations (schema + backfill + ingest) land in one deploy (Pitfall 4).
--
-- wras filter: added to the USING subquery WHERE clause (alongside existing 'rwsas' filter).
--   The one-time DELETE in 20260620000100_resolution_backfill.sql removes existing wras rows;
--   this filter prevents new wras rows from being inserted.

-- =====================================================================
-- (A) maplify.update_sightings — add collection_id + wras filter
--
-- Base: live function confirmed via pg_get_functiondef (most recent version from
-- 20250922194148_more_maplify_fix.sql + later minor fixes applied).
-- TWO changes vs the base:
--   1. `AND source IS DISTINCT FROM 'wras'` added to the USING subquery WHERE clause.
--   2. `collection_id` added to WHEN NOT MATCHED BY TARGET INSERT column list.
--   3. `maplify.resolve_collection(v.comments, v.source)` added to INSERT VALUES.
-- WHEN MATCHED UPDATE does NOT include collection_id (preserve backfilled values, D-07).
-- contributor_id NOT in INSERT (Maplify contributor stays NULL, D-13/SC#3).
-- =====================================================================
CREATE OR REPLACE FUNCTION maplify.update_sightings (
  start_date date = current_date,
  end_date date = current_date
) RETURNS TABLE (
  sighting_id INTEGER,
  "action" text
) LANGUAGE SQL VOLATILE AS $$
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
      gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)) AS bbox,
      maplify.fetch_date_range(start_date, end_date, bbox) AS fetched,
      jsonb_to_recordset(fetched) AS v (
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
    AND s.created_at BETWEEN $1::TIMESTAMP AND ($2 + 1)::TIMESTAMP
    THEN DELETE
  RETURNING s.id, MERGE_ACTION();
$$;

-- =====================================================================
-- (B) inaturalist.upsert_observation_page — contributor_id in NOT MATCHED INSERT
--
-- Base: 20251027062024_fix_blank_license.sql (most recent live version, confirmed via
-- pg_get_functiondef). ONE addition: contributor_id column added to WHEN NOT MATCHED
-- INSERT and inaturalist.mint_contributor(v.username) added to VALUES.
--
-- Key differences from 20250914232212_cron.sql (RESEARCH reference):
--   - license_code declared as varchar in recordsets (not inaturalist.license)
--   - Cast to public.license (not inaturalist.license)
--   - observation_photos MERGE uses ON v.id = p.id (photo-level unique key)
--   - observation_photos MATCHED UPDATE includes seq = v.seq
--
-- collection_id is intentionally ABSENT from the INSERT → DEFAULT fires (D-05).
-- contributor_id is intentionally ABSENT from the WHEN MATCHED UPDATE (D-16/Pitfall 6).
-- The second MERGE (observation_photos) and ensure_taxa call are unchanged.
-- =====================================================================
CREATE OR REPLACE FUNCTION inaturalist.upsert_observation_page (
  page jsonb
) RETURNS void LANGUAGE SQL VOLATILE STRICT
BEGIN ATOMIC
  SELECT inaturalist.ensure_taxa(array_agg(taxon_id::integer))
  FROM
    jsonb_to_recordset(page) AS obs (taxon jsonb),
    jsonb_array_elements(taxon->'ancestor_ids') AS taxon_id;

  MERGE INTO inaturalist.observations AS o USING (
    SELECT
      o.id AS id,
      NULLIF(trim(description), '') AS description,
      gis.ST_Point(geojson.coordinates[1], geojson.coordinates[2]) AS location,
      time_observed_at AS observed_at,
      NULLIF(license_code, '')::public.license AS license_code,
      uri,
      o.user->>'login' AS username,
      taxon.id AS taxon_id,
      current_timestamp AS fetched_at,
      public_positional_accuracy,
      updated_at
    FROM
      jsonb_to_recordset(page) AS o (
        id bigint,
        taxon jsonb,
        description text,
        geojson jsonb,
        time_observed_at timestamptz,
        license_code varchar,
        uri varchar,
        "user" jsonb,
        observation_photos jsonb,
        public_positional_accuracy integer,
        updated_at timestamp
      ), jsonb_to_record(o.geojson) as geojson (coordinates double precision[2]),
      jsonb_to_record(taxon) AS taxon (id integer)
    WHERE time_observed_at IS NOT NULL
  ) AS v ON v.id = o.id
  WHEN MATCHED AND v.updated_at > o.updated_at THEN UPDATE SET
      description = v.description,
      location = v.location,
      observed_at = v.observed_at,
      license_code = v.license_code,
      username = v.username,
      taxon_id = v.taxon_id,
      fetched_at = v.fetched_at,
      public_positional_accuracy = v.public_positional_accuracy,
      updated_at = v.updated_at
  WHEN NOT MATCHED BY TARGET THEN INSERT (id, description, location, observed_at, license_code, uri, username, taxon_id, fetched_at, public_positional_accuracy, updated_at, contributor_id)
    VALUES (v.id, v.description, v.location, v.observed_at, v.license_code, v.uri, v.username, v.taxon_id, v.fetched_at, v.public_positional_accuracy, v.updated_at, inaturalist.mint_contributor(v.username));

  MERGE INTO inaturalist.observation_photos AS p USING (
    SELECT
      observation_photo.id AS id,
      o.id AS observation_id,
      observation_photo.position AS seq,
      photo.attribution,
      photo.hidden,
      NULLIF(photo.license_code, '')::public.license AS license,
      dims::public.dimensions original_dimensions,
      photo.url
    FROM jsonb_to_recordset(page) AS o (id bigint, observation_photos jsonb) JOIN inaturalist.observations AS existing ON existing.id = o.id,
      jsonb_to_recordset(observation_photos) AS observation_photo (id bigint, position smallint, photo jsonb),
      jsonb_to_record(observation_photo.photo) AS photo (id bigint, attribution varchar, hidden boolean, license_code varchar, original_dimensions jsonb, url varchar),
      jsonb_to_record(photo.original_dimensions) AS dims (height int, width int)
  ) AS v ON v.id = p.id
  WHEN NOT MATCHED BY SOURCE
    AND observation_id IN (SELECT DISTINCT id FROM jsonb_to_recordset(page) AS o (id bigint))
    THEN DELETE
  WHEN NOT MATCHED BY TARGET THEN INSERT (
    id, observation_id, seq, attribution, hidden, license, original_dimensions, url
  ) VALUES (v.id, v.observation_id, v.seq, v.attribution, v.hidden, v.license, v.original_dimensions, v.url)
  WHEN MATCHED THEN UPDATE SET
    attribution = v.attribution,
    hidden = v.hidden,
    license = v.license,
    original_dimensions = v.original_dimensions,
    url = v.url,
    seq = v.seq;
END;
