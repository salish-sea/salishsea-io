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
      v.*,
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
          WHEN 'Pacific White-sided Dolphin' THEN 'Lagenorhynchus obliquidens'
        END
      )
    WHERE source != 'rwsas'
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
    THEN INSERT VALUES (
      v.id, v.project_id, v.trip_id, v.scientific_name, v.location, v.number_sighted, v.created, v.photo_url,
      v.comments, v.in_ocean, v.moderated, v.trusted, v.is_test, v.source, v.usernm, v.name, v.taxon_id
    )
  WHEN NOT MATCHED BY SOURCE
    AND created_at BETWEEN start_date::TIMESTAMP AND (end_date + 1)::TIMESTAMP
    THEN DELETE
  RETURNING s.id, MERGE_ACTION();
$$;
