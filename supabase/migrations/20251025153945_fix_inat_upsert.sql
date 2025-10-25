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
        license_code public.license,
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
      jsonb_to_record(observation_photo.photo) AS photo (id bigint, attribution varchar, hidden boolean, license_code public.license, original_dimensions jsonb, url varchar),
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
