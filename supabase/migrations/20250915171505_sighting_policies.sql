DROP TABLE IF EXISTS profiles;
CREATE TABLE public.profiles (
  id integer primary key generated always as identity,
  sub varchar(200) not null unique,
  iat timestamp not null,
  email varchar(100) not null,
  nickname varchar(50) not null,
  name varchar(100),
  family_name varchar(100),
  given_name varchar(100),
  picture varchar(200)
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Access own profile" ON public.profiles
  FOR ALL TO authenticated
    USING (sub = (
      SELECT
        current_setting('request.jwt.claims', TRUE)::json ->> 'sub'));

ALTER TYPE inaturalist.license SET SCHEMA public;
ALTER TYPE occurrence_photo
  ADD attribute license public.license;
ALTER TYPE license
  ADD value 'none';

ALTER TABLE public.sightings DROP COLUMN user_id CASCADE;
ALTER TABLE public.sightings ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users (id);


--DROP FUNCTION upsert_sighting;
--DROP FUNCTION occurrences_on_date;
--DROP VIEW public.occurrences;
DROP TABLE public.users;

ALTER TABLE public.sightings RENAME TO observations;
ALTER TABLE public.sighting_photos RENAME TO observation_photos;
ALTER TABLE public.observation_photos RENAME COLUMN sighting_id TO observation_id;


CREATE POLICY "Observations are visible to everyone."
ON public.observations FOR SELECT
TO anon USING ( true );

CREATE POLICY "Observation photos are visible to everyone."
ON public.observation_photos FOR SELECT
TO anon USING ( true );

CREATE POLICY "Authenticated users may manage their own observations."
ON public.observations FOR ALL
TO authenticated USING (user_id = (select auth.uid()));

CREATE POLICY "Authenticated users may manage their own observation photos."
ON public.observation_photos FOR ALL
TO authenticated USING (EXISTS(SELECT true FROM public.observations AS o WHERE o.id = observation_id AND o.user_id = auth.uid()));


ALTER TABLE inaturalist.taxa SET SCHEMA public;

ALTER TABLE public.taxa ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users may look up taxa." ON public.taxa
  FOR SELECT TO authenticated, anon
    USING (TRUE);


CREATE TYPE lon_lat AS (
  lon double precision,
  lat double precision
);


ALTER TABLE observations ADD COLUMN accuracy INTEGER;
GRANT usage ON SCHEMA inaturalist TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_observation(
  accuracy observations.accuracy%TYPE,
  up_id observations.id%TYPE,
  body VARCHAR,
  count observations.count%TYPE,
  direction public.travel_direction,
  observed_at observations.observed_at%TYPE,
  observed_from lon_lat,
  photos public.occurrence_photo[],
  "location" lon_lat,
  taxon public.taxon,
  url observations.url%TYPE
) RETURNS uuid LANGUAGE SQL VOLATILE SET search_path=''
BEGIN ATOMIC
  INSERT INTO observations (id, body, count, direction, observed_at, observer_location, subject_location, taxon_id, url, created_at, updated_at, user_id)
  SELECT
    up_id,
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
    auth.uid()
  FROM public.taxa AS t WHERE t.scientific_name = taxon.scientific_name
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
    ON ordinality = seq AND p.observation_id=up_id
  WHEN MATCHED THEN UPDATE SET href=v.src, license_code=v.license
  WHEN NOT MATCHED BY SOURCE AND p.observation_id = up_id THEN DELETE
  WHEN NOT MATCHED BY TARGET THEN
    INSERT (observation_id, seq, href, license_code)
    VALUES (up_id, ordinality, v.src, v.license);

  SELECT up_id;
END;

CREATE OR REPLACE VIEW public.occurrences (
  id,
  url,
  attribution,
  body,
  count,
  direction,
  location,
  accuracy,
  photos,
  observed_at,
  observed_from,
  taxon,
  individuals,
  is_own_observation
) AS
  SELECT
    'maplify:' || s.id AS id,
    null AS url,
    usernm || ' on ' || source AS attribution,
    comments AS body,
    CASE WHEN number_sighted BETWEEN 1 AND 1000 THEN number_sighted ELSE null END AS count,
    public.extract_travel_direction(comments) AS direction,
    row(gis.ST_X(location::gis.geometry), gis.ST_Y(location::gis.geometry))::lon_lat AS location,
    null AS accuracy,
    CASE WHEN photo_url IS NOT NULL THEN array[row(null, null, photo_url, NULL, NULL)::public.occurrence_photo] ELSE '{}'::occurrence_photo[] END,
    s.created_at AT TIME ZONE 'GMT' AS observed_at,
    null::lon_lat AS observed_from,
    row(coalesce(t.scientific_name, s.scientific_name), t.vernacular_name)::public.taxon,
    array[]::varchar[] AS individuals,
    false AS is_own_observation
  FROM maplify.sightings s
  JOIN public.taxa t ON s.scientific_name = t.scientific_name
  WHERE NOT is_test

  UNION ALL

  SELECT
  	'inaturalist:' || observations.id,
    uri AS url,
    username || ' on iNaturalist',
    description,
    null AS count,
    public.extract_travel_direction(description) AS direction,
    row(gis.ST_X(location::gis.geometry), gis.ST_Y(location::gis.geometry))::lon_lat AS location,
    public_positional_accuracy AS accuracy,
    (SELECT
      array_agg(row(attribution, null, url, null, license)::occurrence_photo ORDER BY seq ASC)
      FROM inaturalist.observation_photos
      WHERE observation_id = observations.id AND NOT hidden
    ) AS photos,
    observed_at,
    null::lon_lat AS observed_from,
    row(t.scientific_name, t.vernacular_name)::taxon,
    array[]::varchar[] AS individuals,
    false AS is_own_observation
  FROM inaturalist.observations
  JOIN public.taxa t ON taxon_id = t.id

  UNION ALL

  SELECT
  	'happywhale:' || e.id AS id,
    'https://happywhale.com/individual/' || individual_id || ';enc=' || e.id AS url,
    coalesce(u.display_name, 'a user') || ' on HappyWhale',
    comments,
    min_count AS count,
    public.extract_travel_direction(comments) AS direction,
    row(gis.ST_X(location::gis.geometry), gis.ST_Y(location::gis.geometry))::lon_lat AS location,
    CASE accuracy WHEN 'GENERAL' THEN 161 WHEN 'APPROX' THEN 16 ELSE 2 END,
    (SELECT
      array_agg(row(u.display_name, mimetype, url, thumb_url, null)::occurrence_photo ORDER BY m.id ASC)
      FROM happywhale.media m
      LEFT JOIN happywhale.users u ON m.user_id = u.id
      WHERE public AND encounter_id = e.id
    ),
    (start_date + coalesce(start_time, '12:00:00'::time)) AT TIME ZONE timezone,
    null::lon_lat AS observed_from,
    row(coalesce(t.scientific_name, s.scientific), coalesce(t.vernacular_name, s.name))::taxon,
    array[]::varchar[] AS individuals,
    false AS is_own_observation
  FROM happywhale.encounters AS e
  JOIN happywhale.users AS u ON e.user_id = u.id
  JOIN happywhale.species AS s ON e.species_id = s.id
  LEFT JOIN public.taxa AS t ON s.scientific = t.scientific_name

  UNION ALL

  SELECT
    o.id::text AS id,
    o.url,
    'someone on SalishSea.io' AS attribution,
    body,
    count,
    direction,
    row(gis.ST_X(subject_location::gis.geometry), gis.ST_Y(subject_location::gis.geometry))::lon_lat AS "location",
    null,
    (SELECT array_agg(row('someone', null, href, NULL, license_code)::occurrence_photo ORDER BY seq ASC) FROM public.observation_photos WHERE observation_id = o.id),
    observed_at,
    row(gis.ST_X(observer_location::gis.geometry), gis.ST_Y(observer_location::gis.geometry))::lon_lat AS observed_from,
    row(t.scientific_name, t.vernacular_name)::public.taxon,
    array[]::varchar[] AS individuals,
    user_id = auth.uid() AS is_own_observation
  FROM public.observations AS o
  JOIN auth.users AS u ON u.id = user_id
  JOIN public.taxa t ON t.id = o.taxon_id;

CREATE OR REPLACE FUNCTION public.occurrences_on_date (date date)
  RETURNS SETOF public.occurrences
  LANGUAGE SQL
  STABLE STRICT
  SECURITY DEFINER
  SET search_path = ''
  AS $$
  SELECT
    *
  FROM
    public.occurrences
  WHERE
    date(observed_at at time zone 'PST8PDT') = "date"
  ORDER BY
    observed_at ASC;

$$;
