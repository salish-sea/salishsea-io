CREATE OR REPLACE FUNCTION public.upsert_sighting(
  up_id sightings.id%TYPE,
  count sightings.count%TYPE,
  direction sightings.direction%TYPE,
  observed_at sightings.observed_at%TYPE,
  observer_location double precision[2],
  photos varchar(2000)[],
  photo_license sighting_photos.license_code%TYPE,
  subject_location double precision[2],
  taxon inaturalist.taxa.scientific_name%TYPE,
  url sightings.url%TYPE
) RETURNS uuid LANGUAGE SQL VOLATILE SET search_path=''
BEGIN ATOMIC
  INSERT INTO sightings (id, count, direction, observed_at, observer_location, subject_location, taxon_id, url, created_at, updated_at)
  SELECT
    up_id,
    count,
    direction,
    observed_at,
    gis.ST_Point(observer_location[0], observer_location[1]),
    gis.ST_Point(subject_location[0], subject_location[1]),
    taxa.id,
    url,
    current_timestamp,
    current_timestamp
  FROM inaturalist.taxa WHERE taxa.scientific_name = taxon
  ON CONFLICT (id) DO UPDATE SET
    body=EXCLUDED.body,
    count=EXCLUDED.count,
    direction=EXCLUDED.direction,
    observed_at=EXCLUDED.observed_at,
    observer_location=EXCLUDED.observer_location,
    subject_location=EXCLUDED.subject_location,
    taxon_id=EXCLUDED.taxon_id,
    url=EXCLUDED.url,
    updated_at=EXCLUDED.updated_at;

  WITH v(photo_url, ordinality) AS (SELECT photo_url, row_number() over () FROM unnest(photos) photo_url)
  MERGE INTO public.sighting_photos AS p
  USING v
    ON ordinality = seq AND p.sighting_id=up_id
  WHEN MATCHED THEN UPDATE SET href=photo_url, license_code=photo_license
  WHEN NOT MATCHED BY SOURCE AND p.sighting_id = up_id THEN DELETE
  WHEN NOT MATCHED BY TARGET THEN
    INSERT (sighting_id, seq, href, license_code)
    VALUES (up_id, ordinality, photo_url, photo_license);

  SELECT up_id;
END;
