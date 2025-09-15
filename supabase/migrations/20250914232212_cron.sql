ALTER TABLE inaturalist.observations ADD COLUMN updated_at timestamp;
UPDATE inaturalist.observations SET updated_at=fetched_at;
ALTER TABLE inaturalist.observations ALTER COLUMN updated_at SET NOT NULL;

DROP FUNCTION inaturalist.upsert_observation_page CASCADE;

DROP FUNCTION IF EXISTS inaturalist.ensure_taxa;
CREATE FUNCTION inaturalist.ensure_taxa(taxon_ids integer[]) RETURNS void LANGUAGE SQL VOLATILE STRICT AS $$
  WITH taxa_to_fetch AS (
    SELECT DISTINCT needed, dense_rank() over (order by needed) / 10 AS chunk
    FROM unnest(taxon_ids) AS needed
    LEFT JOIN inaturalist.taxa AS existing ON needed = existing.id
    WHERE existing.id IS NULL
  ), taxon_chunks_to_fetch AS (
    SELECT array_agg(needed) AS ids
    FROM taxa_to_fetch
    GROUP BY chunk
  )
  SELECT inaturalist.upsert_taxon(id, parent_id, name, preferred_common_name, rank) id
  FROM taxon_chunks_to_fetch,
    inaturalist.fetch_taxa(ids);
$$;

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
      license_code,
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
        license_code inaturalist.license,
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
      taxon_Id = v.taxon_id,
      fetched_at = v.fetched_at,
      public_positional_accuracy = v.public_positional_accuracy,
      updated_at = v.updated_at
  WHEN NOT MATCHED BY TARGET THEN INSERT (id, description, location, observed_at, license_code, uri, username, taxon_id, fetched_at, public_positional_accuracy, updated_at)
    VALUES (v.id, v.description, v.location, v.observed_at, v.license_code, v.uri, v.username, v.taxon_id, v.fetched_at, v.public_positional_accuracy, v.updated_at);

  MERGE INTO inaturalist.observation_photos AS p USING (
    SELECT
      observation_photo.id AS id,
      o.id AS observation_id,
      observation_photo.position AS seq,
      photo.attribution,
      photo.hidden,
      photo.license_code AS license,
      dims::public.dimensions original_dimensions,
      photo.url
    FROM jsonb_to_recordset(page) AS o (id bigint, observation_photos jsonb) JOIN inaturalist.observations AS existing ON existing.id = o.id,
      jsonb_to_recordset(observation_photos) AS observation_photo (id bigint, position smallint, photo jsonb),
      jsonb_to_record(observation_photo.photo) AS photo (id bigint, attribution varchar, hidden boolean, license_code inaturalist.license, original_dimensions jsonb, url varchar),
      jsonb_to_record(photo.original_dimensions) AS dims (height int, width int)
  ) AS v ON v.observation_id = p.observation_id AND p.seq = v.seq
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
    url = v.url;
END;

COMMENT ON COLUMN inaturalist.observation_photos.id IS 'iNaturalist ObservationPhoto id, not a Photo id';

CREATE OR REPLACE FUNCTION inaturalist.fetch_observation_page (
  earliest date,
  latest date,
  extent gis.box2d,
  taxon_ids integer[],
  page_no integer,
  per_page integer = 200,
  out total_results integer,
  out results jsonb
) AS $$
  SELECT total_results, results
  FROM
    http.http_get('https://api.inaturalist.org/v2/observations', jsonb_build_object(
      'd1', earliest,
      'd2', latest,
      'licensed', true,
      'nelat', gis.ST_YMax(extent),
      'nelng', gis.ST_XMax(extent),
      'swlat', gis.ST_YMin(extent),
      'swlng', gis.ST_XMin(extent),
      'taxon_id', array_to_string(taxon_ids, ','),
      'geoprivacy', 'open',
      'taxon_geoprivacy', 'open',
      'per_page', per_page,
      'page', page_no,
      'fields', '(id:!t,description:!t,geojson:!t,license_code:!t,time_observed_at:!t,uri:!t,public_positional_accuracy:!t,updated_at:!t,' ||
        'observation_photos:(position:!t,photo:(id:!t,attribution:!t,hidden:!t,license_code:!t,original_dimensions:(height:!t,width:!t),url:!t)),' ||
        'taxon:(id:!t,ancestor_ids:!t),' ||
        'user:(id:!t,login:!t,name:!t))'
    )),
    jsonb_to_record(content::jsonb) AS page (total_results integer, results jsonb)
$$ LANGUAGE SQL STABLE STRICT;


CREATE OR REPLACE FUNCTION inaturalist.update_observations(from_date date, to_date date) RETURNS void VOLATILE LANGUAGE SQL AS $$
  SELECT *
  FROM inaturalist.fetch_observation_page(
    from_date,
    to_date,
    gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)),
    array[152871, 372843],
    1,
    200),
  inaturalist.upsert_observation_page(results) ups;
$$;


CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

SELECT cron.schedule('load-recent-maplify-sightings', '*/5 * * * *', 'SELECT * FROM maplify.update_sightings(current_date - 10, current_date)');
SELECT cron.schedule('load-recent-inaturalist-observations', '*/5 * * * *', 'SELECT * FROM inaturalist.update_observations(current_date - 10, current_date)');
SELECT cron.schedule('nightly-vacuum', '0 11 * * *', 'VACUUM');
