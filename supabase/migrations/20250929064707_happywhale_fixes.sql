CREATE OR REPLACE FUNCTION public.extract_travel_direction(body text) RETURNS public.travel_direction LANGUAGE SQL IMMUTABLE STRICT SET search_path='' AS $$
  SELECT regexp_replace(lower(substring(body FROM '(?i)\m(north(\W*(east|west)|)|(south(\W*(east|west)|))|west|east)(\W*bound)?\M')), '\W', '', 'g')::public.travel_direction;
$$;

DROP VIEW public.occurrences cascade;

ALTER TABLE happywhale.encounters ALTER COLUMN verbatim_location TYPE VARCHAR(2000);


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
  identifiers,
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
    row(coalesce(t.scientific_name, s.scientific_name), t.vernacular_name, inaturalist.species_id(t))::public.taxon,
    COALESCE(extract_identifiers("comments"), ARRAY[]::VARCHAR[]) AS identifiers,
    false AS is_own_observation
  FROM maplify.sightings s
  JOIN inaturalist.taxa t ON s.taxon_id = t.id
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
      WHERE observation_id = observations.id AND NOT hidden AND license IS NOT NULL
    ) AS photos,
    observed_at,
    null::lon_lat AS observed_from,
    row(t.scientific_name, t.vernacular_name, inaturalist.species_id(t))::taxon,
    COALESCE(extract_identifiers("description"), ARRAY[]::VARCHAR[]) AS identifiers,
    false AS is_own_observation
  FROM inaturalist.observations
  JOIN inaturalist.taxa t ON taxon_id = t.id

  UNION ALL

  SELECT
  	'happywhale:' || e.id AS id,
    'https://happywhale.com/individual/' || individual_id || ';enc=' || e.id AS url,
    coalesce(u.display_name, 'a user') || ' on HappyWhale',
    concat_ws('\n', verbatim_location, "comments"),
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
    row(coalesce(t.scientific_name, s.scientific), coalesce(t.vernacular_name, s.name), inaturalist.species_id(t))::taxon,
    COALESCE(extract_identifiers("comments"), ARRAY[]::VARCHAR[]) AS identifiers,
    false AS is_own_observation
  FROM happywhale.encounters AS e
  LEFT JOIN happywhale.users AS u ON e.user_id = u.id
  JOIN happywhale.species AS s ON e.species_id = s.id
  LEFT JOIN inaturalist.taxa AS t ON s.scientific = t.scientific_name

  UNION ALL

  SELECT
    o.id::text AS id,
    o.url,
    COALESCE(u.raw_user_meta_data->>'name', 'someone') || ' on SalishSea.io' AS attribution,
    body,
    count,
    direction,
    row(gis.ST_X(subject_location::gis.geometry), gis.ST_Y(subject_location::gis.geometry))::lon_lat AS "location",
    null,
    (SELECT array_agg(row('someone', null, href, NULL, license_code)::occurrence_photo ORDER BY seq ASC) FROM public.observation_photos WHERE observation_id = o.id),
    observed_at,
    row(gis.ST_X(observer_location::gis.geometry), gis.ST_Y(observer_location::gis.geometry))::lon_lat AS observed_from,
    row(t.scientific_name, t.vernacular_name, inaturalist.species_id(t))::public.taxon,
    COALESCE(extract_identifiers("body"), ARRAY[]::VARCHAR[]) AS identifiers,
    user_id = auth.uid() AS is_own_observation
  FROM public.observations AS o
  JOIN auth.users AS u ON u.id = user_id
  JOIN inaturalist.taxa t ON t.id = o.taxon_id;

DROP FUNCTION happywhale.fetch_encounter;
DROP FUNCTION happywhale.upsert_encounter;


CREATE FUNCTION happywhale.fetch_encounter (IN id integer, OUT encounter jsonb, OUT media jsonb) STRICT
LANGUAGE SQL
STABLE
SET search_path = ''
BEGIN
  ATOMIC
  SELECT
    encounter, media
  FROM
    http.http (('GET', 'https://happywhale.com/app/cs/encounter/full/' || id::text, ARRAY[http.http_header ('Accept', 'application/json')], NULL, NULL)::http.http_request), jsonb_to_record(content::jsonb) AS payload (encounter jsonb,
    media jsonb,
    comments jsonb,
    contributors jsonb,
    sighters jsonb,
    "externalIds" jsonb)
WHERE
  status = 200;

END;

CREATE OR REPLACE FUNCTION happywhale.upsert_encounter (
  encounter jsonb, media jsonb
) RETURNS integer 
LANGUAGE SQL VOLATILE set search_path=''
BEGIN ATOMIC
  INSERT INTO happywhale.encounters (
    id, start_date, start_time, end_date, end_time, timezone, verbatim_location, location,
    accuracy, precision_source, individual_id, species_id, min_count, max_count, comments,
    user_id, public, fetched_at
  ) SELECT
    e.id,
    "startDate" AS start_date,
    "startTime" AS start_time,
    "endDate",
    "endTime",
    timezone,
    "verbatimLocation",
    gis.ST_Point((loc.latLng).lng, (loc.latLng).lat) AS location,
    accuracy,
    "precisionSource",
    happywhale.upsert_individual(ind.id, ind."speciesKey", ind."primaryId", ind.nickname, lower(NULLIF(sex, ''))::public.sex) AS individual_id,
    sp.id AS species_id,
    "minCount",
    "maxCount",
    "adminComments",
    happywhale.upsert_user(u.id, u."displayName"),
    public,
    current_timestamp
  FROM
    jsonb_to_record(encounter) AS e (
      id integer,
      "dateRange" jsonb,
      location jsonb,
      individual jsonb,
      species varchar,
      "minCount" integer,
      "maxCount" integer,
      "adminComments" text,
      "user" jsonb,
      "public" boolean
    ) LEFT JOIN happywhale.species AS sp ON sp.code = species,
    jsonb_to_record("dateRange") AS dr ("startDate" date, "startTime" time, "endDate" date, "endTime" time, timezone varchar),
    jsonb_to_record(location) AS loc ("verbatimLocation" varchar, latLng public.lat_lng, accuracy happywhale.accuracy, "precisionSource" varchar),
    jsonb_to_record(individual) AS ind (id integer, "speciesKey" varchar, "primaryId" varchar, nickname varchar, sex varchar),
    jsonb_to_record("user") AS u (id integer, "displayName" varchar)
  ON CONFLICT (id) DO UPDATE SET
    start_date = EXCLUDED.start_date,
    start_time = EXCLUDED.start_time,
    end_date = EXCLUDED.end_date,
    end_time = EXCLUDED.end_time,
    timezone = EXCLUDED.timezone,
    verbatim_location = EXCLUDED.verbatim_location,
    fetched_at = EXCLUDED.fetched_at;
  
  INSERT INTO happywhale.media (id, encounter_id, thumb_url, url, "timestamp", timezone, user_id, license_level, mimetype, public)
  SELECT
    m.id,
    (encounter->'id')::INTEGER,
    "thumbUrl",
    "url",
    "timestamp" AT TIME ZONE 'UTC',
    "timezone",
    happywhale.upsert_user(("user"->'id')::integer, "user"->>'displayName'),
    "licenseLevel",
    "mimetype",
    "public"
  FROM jsonb_to_recordset($2) AS mm (media jsonb), jsonb_to_record(mm.media) AS m (
    id INTEGER,
    "thumbUrl" VARCHAR,
    "url" VARCHAR,
    "timestamp" timestamp,
    "timezone" VARCHAR,
    "type" VARCHAR,
    "user" jsonb,
    "licenseLevel" VARCHAR,
    "origFilename" VARCHAR,
    "mimetype" VARCHAR,
    "public" BOOLEAN
  )
  ON CONFLICT (id) DO UPDATE SET
    license_level=EXCLUDED.license_level,
    "public"=EXCLUDED.public;
  
  SELECT (encounter->'id')::integer;
END;
CREATE FUNCTION local_date (occurrence occurrences)
  RETURNS date
  LANGUAGE SQL
  STABLE STRICT
  AS $$
  SELECT
    date($1.observed_at at time zone 'PST8PDT')
$$;