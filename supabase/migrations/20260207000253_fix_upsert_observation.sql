ALTER TABLE public.observations ADD COLUMN user_uuid uuid REFERENCES auth.users (id);
UPDATE public.observations
SET user_uuid = uc.user_uuid
FROM public.user_contributor AS uc WHERE uc.contributor_id = observations.contributor_id;

DROP POLICY "Authenticated users may manage their own observations." ON public.observations;
DROP POLICY "Authenticated users may manage their own observation photos." ON public.observation_photos;
CREATE POLICY "Authenticated users may manage their own observation photos."
ON public.observation_photos FOR ALL
TO authenticated USING (
  EXISTS(
    SELECT TRUE
    FROM public.observations AS o
    WHERE o.id = observation_id
      AND o.user_uuid = (SELECT auth.uid())
  )
);

CREATE POLICY "Authenticated users may manage their own observations."
ON public.observations FOR ALL
TO authenticated USING (
  user_uuid = (SELECT auth.uid())
);


CREATE OR REPLACE FUNCTION public.upsert_observation(
  id observations.id%TYPE,
  accuracy observations.accuracy%TYPE,
  body VARCHAR,
  count observations.count%TYPE,
  direction public.travel_direction,
  observed_at observations.observed_at%TYPE,
  observed_from lon_lat,
  photos public.occurrence_photo[],
  "location" lon_lat,
  taxon varchar,
  url observations.url%TYPE
) RETURNS uuid LANGUAGE SQL VOLATILE SET search_path=''
AS $$
  INSERT INTO public.observations (id, body, count, direction, observed_at, observer_location, subject_location, taxon_id, url, created_at, updated_at, contributor_id, user_uuid)
  SELECT
    $1,
    NULLIF(TRIM(body), ''),
    count,
    direction,
    observed_at,
    gis.ST_Point(observed_from.lon, observed_from.lat),
    gis.ST_Point("location".lon, "location".lat),
    t.id,
    url,
    current_timestamp,
    current_timestamp,
    (SELECT contributor_id FROM public.user_contributor WHERE user_uuid = auth.uid()),
    auth.uid()
  FROM inaturalist.taxa AS t WHERE t.scientific_name = taxon
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

  MERGE INTO public.observation_photos AS p
  USING (SELECT photo.*, row_number() over () AS ordinality FROM unnest(photos) AS photo) AS v
    ON ordinality = seq AND p.observation_id=$1
  WHEN MATCHED THEN UPDATE SET href=v.src, license_code=v.license
  WHEN NOT MATCHED BY SOURCE AND p.observation_id = $1 THEN DELETE
  WHEN NOT MATCHED BY TARGET THEN
    INSERT (observation_id, seq, href, license_code)
    VALUES ($1, ordinality, v.src, v.license);

  SELECT $1;
$$;
