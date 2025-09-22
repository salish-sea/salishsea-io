CREATE VIEW public.presence (
  id,
  attribution,
  body,
  count,
  direction,
  latitude,
  accuracy,
  longitude,
  photos,
  observed_at,
  taxon,
  individuals
) AS
  SELECT
    'maplify:' || s.id AS id,
    usernm || ' on ' || source AS attribution,
    comments AS body,
    CASE WHEN number_sighted BETWEEN 1 AND 1000 THEN number_sighted ELSE null END AS count,
    public.extract_travel_direction(comments) AS direction,
    gis.ST_Y(location::gis.geometry) AS latitude,
    null AS accuracy,
    gis.ST_X(location::gis.geometry) AS longitude,
    CASE WHEN photo_url IS NOT NULL THEN array[row(null, null, photo_url, null)::public.presence_photo] END,
    s.created_at AT TIME ZONE 'PST8PDT' AS observed_at,
    row(coalesce(t.scientific_name, s.scientific_name), t.vernacular_name)::public.taxon,
    array[]::varchar[] AS individuals
  FROM maplify.sightings s
  LEFT JOIN inaturalist.taxa t ON s.scientific_name = t.scientific_name
  WHERE NOT is_test

  UNION ALL

  SELECT
    uri,
    username || ' on iNaturalist',
    description,
    null AS count,
    public.extract_travel_direction(description) AS direction,
    gis.ST_Y(location::gis.geometry) AS latitude,
    public_positional_accuracy AS accuracy,
    gis.ST_X(location::gis.geometry) AS longitude,
    (SELECT
      array_agg(row(attribution, null, url, null)::presence_photo ORDER BY seq ASC)
      FROM inaturalist.observation_photos
      WHERE observation_id = id AND NOT hidden
    ) AS photos,
    observed_at,
    row(t.scientific_name, t.vernacular_name)::taxon,
    array[]::varchar[] AS individuals
  FROM inaturalist.observations
  JOIN inaturalist.taxa t ON taxon_id = t.id

  UNION ALL

  SELECT
    'https://happywhale.com/individual/' || individual_id || ';enc=' || e.id,
    coalesce(u.display_name, 'a user') || ' on HappyWhale',
    comments,
    min_count AS count,
    public.extract_travel_direction(comments) AS direction,
    gis.ST_Y(location::gis.geometry),
    CASE accuracy WHEN 'GENERAL' THEN 161 WHEN 'APPROX' THEN 16 ELSE 2 END,
    gis.ST_X(location::gis.geometry),
    (SELECT
      array_agg(row(u.display_name, mimetype, url, thumb_url)::presence_photo ORDER BY m.id ASC)
      FROM happywhale.media m
      LEFT JOIN happywhale.users u ON m.user_id = u.id
      WHERE public AND encounter_id = e.id
    ),
    (start_date + coalesce(start_time, '12:00:00'::time)) AT TIME ZONE timezone,
    row(coalesce(t.scientific_name, s.scientific), coalesce(t.vernacular_name, s.name))::taxon,
    array[]::varchar[] AS individuals
  FROM happywhale.encounters AS e
  JOIN happywhale.users AS u ON e.user_id = u.id
  JOIN happywhale.species AS s ON e.species_id = s.id
  LEFT JOIN inaturalist.taxa AS t ON s.scientific = t.scientific_name

  UNION ALL

  SELECT
    '/api/sightings/' || s.id,
    u.name || ' on SalishSea.io',
    body,
    count,
    direction,
    gis.ST_Y(subject_location::gis.geometry),
    null,
    gis.ST_X(subject_location::gis.geometry),
    (SELECT array_agg(row(u.name, null, href, null)::presence_photo ORDER BY seq ASC) FROM sighting_photos WHERE sighting_id = s.id),
    observed_at,
    row(t.scientific_name, t.vernacular_name)::public.taxon,
    array[]::varchar[] AS individuals
  FROM sightings AS s
  LEFT JOIN users AS u ON s.user_id = u.id
  JOIN inaturalist.taxa t ON t.id = s.taxon_id;

CREATE FUNCTION public.presence_on_date(date date) RETURNS SETOF public.presence LANGUAGE SQL STABLE STRICT SECURITY DEFINER SET search_path='' AS $$
SELECT * FROM public.presence WHERE date(observed_at at time zone 'PST8PDT') = "date";
$$;
