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
      WHERE observation_id = observations.id AND NOT hidden
    ) AS photos,
    observed_at,
    null::lon_lat AS observed_from,
    row(t.scientific_name, t.vernacular_name)::taxon,
    array[]::varchar[] AS individuals,
    false AS is_own_observation
  FROM inaturalist.observations
  JOIN inaturalist.taxa t ON taxon_id = t.id

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
    row(t.scientific_name, t.vernacular_name)::public.taxon,
    array[]::varchar[] AS individuals,
    user_id = auth.uid() AS is_own_observation
  FROM public.observations AS o
  JOIN auth.users AS u ON u.id = user_id
  JOIN inaturalist.taxa t ON t.id = o.taxon_id;