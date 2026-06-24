-- Surface the v1.3 provenance graph in the in-app occurrences view.
--
-- The DwC-A export view (dwc.occurrences) was rebuilt in v1.3 to use the new
-- providers/collections/organizations reference tables, but the in-app
-- public.occurrences view still emitted the old flat `attribution` string
-- ("<username> on <source>"). This appends structured provenance columns so the
-- sidebar can render the sketch in issue #73: "Observed by {observer} · via
-- {collection}" plus an "Added via {provider}" provenance line.
--
-- Additive only: the existing 14 columns are unchanged in name/type/order, so
-- CREATE OR REPLACE VIEW suffices (no DROP, no cascade to the realtime triggers
-- which live on the base tables). New columns are appended at the end:
--   observer          human observer name, NULL when none/opaque
--   collection        resolved channel name (collections.name)
--   source_url        per-record source URL (NULL where the source carries none)
--   organization      backing institution name (organizations.name)
--   organization_url  backing institution homepage
--   provider          ingest pipeline name (providers.name)
--
-- Per-branch observer rule mirrors the v1.3 contributor model:
--   maplify    → NULL. Every usernm is an opaque app/API code (whalealertoa,
--                cascadiaWebMap, farallon, …); attribution resolves to the
--                collection/org, never a person (D-13).
--   inaturalist→ username
--   happywhale → display_name (nullable)
--   native     → contributor name

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
  contributor_id,
  observer,
  collection,
  source_url,
  organization,
  organization_url,
  provider,
  provider_slug
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
    NULL::INTEGER AS contributor_id,
    NULL::TEXT AS observer,
    col.name AS collection,
    s.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
  FROM maplify.sightings s
  JOIN inaturalist.taxa t ON s.taxon_id = t.id
  LEFT JOIN public.providers prov ON prov.id = s.provider_id
  LEFT JOIN public.collections col ON col.id = s.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id
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
    COALESCE((SELECT
      array_agg(row(attribution, null, url, null, license)::occurrence_photo ORDER BY seq ASC)
      FROM inaturalist.observation_photos
      WHERE observation_id = observations.id AND NOT hidden AND license IS NOT NULL
    ), ARRAY[]::occurrence_photo[]) AS photos,
    observed_at,
    null::lon_lat AS observed_from,
    row(t.scientific_name, t.vernacular_name, inaturalist.species_id(t))::taxon,
    COALESCE(extract_identifiers("description"), ARRAY[]::VARCHAR[]) AS identifiers,
    null AS contributor_id,
    observations.username AS observer,
    col.name AS collection,
    observations.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
  FROM inaturalist.observations
  JOIN inaturalist.taxa t ON taxon_id = t.id
  LEFT JOIN public.providers prov ON prov.id = observations.provider_id
  LEFT JOIN public.collections col ON col.id = observations.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id

  UNION ALL

  SELECT
  	'happywhale:' || e.id AS id,
    'https://happywhale.com/individual/' || individual_id || ';enc=' || e.id AS url,
    coalesce(u.display_name, 'a user') || ' on HappyWhale',
    concat_ws(
      E'\n\n',
      '[' || i.primary_id || '](' || 'https://happywhale.com/individual/' || individual_id || ')' ||
        CASE i.sex WHEN 'male' THEN '♂' WHEN 'female' THEN '♀' ELSE '' END,
      '📍 ' || verbatim_location,
      "comments"
    ),
    min_count AS count,
    public.extract_travel_direction(comments) AS direction,
    row(gis.ST_X(location::gis.geometry), gis.ST_Y(location::gis.geometry))::lon_lat AS location,
    CASE accuracy WHEN 'GENERAL' THEN 161 WHEN 'APPROX' THEN 16 ELSE 2 END,
    COALESCE((SELECT
      array_agg(row(u.display_name, mimetype, url, thumb_url, null)::occurrence_photo ORDER BY m.id ASC)
      FROM happywhale.media m
      LEFT JOIN happywhale.users u ON m.user_id = u.id
      WHERE public AND encounter_id = e.id AND (license_level LIKE 'CC_%' OR license_level = 'PUBLIC_DOMAIN')
    ), ARRAY[]::occurrence_photo[]),
    (start_date + coalesce(start_time, '12:00:00'::time)) AT TIME ZONE timezone,
    null::lon_lat AS observed_from,
    row(coalesce(t.scientific_name, s.scientific), coalesce(t.vernacular_name, s.name), inaturalist.species_id(t))::taxon,
    COALESCE(extract_identifiers("comments"), ARRAY[]::VARCHAR[]) AS identifiers,
    null AS contributor_id,
    u.display_name AS observer,
    col.name AS collection,
    e.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
  FROM happywhale.encounters AS e
  LEFT JOIN happywhale.users AS u ON e.user_id = u.id
  JOIN happywhale.individuals AS i ON e.individual_id = i.id
  JOIN happywhale.species AS s ON e.species_id = s.id
  LEFT JOIN inaturalist.taxa AS t ON s.scientific = t.scientific_name
  LEFT JOIN public.providers prov ON prov.id = e.provider_id
  LEFT JOIN public.collections col ON col.id = e.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id
  WHERE e.public

  UNION ALL

  SELECT
    o.id::text AS id,
    o.url,
    con.name || ' on SalishSea.io' AS attribution,
    body,
    count,
    direction,
    row(gis.ST_X(subject_location::gis.geometry), gis.ST_Y(subject_location::gis.geometry))::lon_lat AS "location",
    null,
    coalesce((SELECT array_agg(row('someone', null, href, NULL, license_code)::occurrence_photo ORDER BY seq ASC) FROM public.observation_photos WHERE observation_id = o.id), ARRAY[]::occurrence_photo[]),
    observed_at,
    CASE WHEN observer_location IS NOT NULL THEN row(gis.ST_X(observer_location::gis.geometry), gis.ST_Y(observer_location::gis.geometry))::lon_lat END AS observed_from,
    row(t.scientific_name, t.vernacular_name, inaturalist.species_id(t))::public.taxon,
    COALESCE(extract_identifiers("body"), ARRAY[]::VARCHAR[]) AS identifiers,
    contributor_id,
    con.name AS observer,
    col.name AS collection,
    o.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
  FROM public.observations AS o
  JOIN public.contributors AS con ON con.id = contributor_id
  JOIN inaturalist.taxa t ON t.id = o.taxon_id
  LEFT JOIN public.providers prov ON prov.id = o.provider_id
  LEFT JOIN public.collections col ON col.id = o.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id;
