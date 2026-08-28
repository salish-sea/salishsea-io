-- Resolve the display name through the register (salish-ayb.5, decision 029).
--
-- Until now every branch of public.occurrences took vernacular_name from
-- inaturalist.taxa — including the branches for Maplify and for our own native
-- submissions, neither of which iNaturalist has anything to do with. Decision 008
-- forbids exactly that: a mirror's vocabulary must not surface in the UI as if it were
-- ours. It is why the map says "North American River Otter".
--
-- The register says "River otter", and animals ADR-0012 makes it authoritative for
-- animal identity here. This joins the crosswalk and prefers its common name, falling
-- back to iNaturalist's where the register has no exact match.
--
-- MATCHING IS BY EXACT iNaturalist TAXON ID, which covers 85.2% of occurrences. The
-- remainder is almost entirely subspecies (Orcinus orca ater, Phoca vitulina richardii),
-- where the register holds a related entity but not an exactMatch — its ecotypes are
-- deliberately skos:broadMatch to their species. Resolving those through a broader match
-- would put a wider claim on the map than the data supports, so they keep iNaturalist's
-- name and are tracked separately. No occurrence loses a name it had.
--
-- Column list and types are unchanged, so CREATE OR REPLACE is legal and the two
CREATE OR REPLACE VIEW public.occurrences AS
 SELECT 'maplify:'::text || s.id AS id,
    NULL::character varying AS url,
    (s.usernm::text || ' on '::text) || s.source::text AS attribution,
    s.comments AS body,
        CASE
            WHEN s.number_sighted >= 1 AND s.number_sighted <= 1000 THEN s.number_sighted
            ELSE NULL::integer
        END AS count,
    extract_travel_direction(s.comments::text) AS direction,
    ROW(gis.st_x(s.location::gis.geometry), gis.st_y(s.location::gis.geometry))::lon_lat AS location,
    NULL::integer AS accuracy,
        CASE
            WHEN s.photo_url IS NOT NULL THEN ARRAY[ROW(NULL::character varying, NULL::character varying, s.photo_url::character varying, NULL::character varying, NULL::license)::occurrence_photo]
            ELSE '{}'::occurrence_photo[]
        END AS photos,
    (s.created_at AT TIME ZONE 'GMT'::text) AS observed_at,
    NULL::lon_lat AS observed_from,
    ROW(COALESCE(t.scientific_name, s.scientific_name), COALESCE(reg.common_name, t.vernacular_name::text)::character varying, inaturalist.species_id(t.*))::taxon AS taxon,
    COALESCE(extract_identifiers(s.comments::text), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    NULL::text AS observer,
    col.name AS collection,
    s.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
   FROM maplify.sightings s
     JOIN inaturalist.taxa t ON s.taxon_id = t.id
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN providers prov ON prov.id = s.provider_id
     LEFT JOIN collections col ON col.id = s.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id
  WHERE NOT s.is_test
UNION ALL
 SELECT 'inaturalist:'::text || observations.id AS id,
    observations.uri AS url,
    observations.username::text || ' on iNaturalist'::text AS attribution,
    observations.description AS body,
    NULL::integer AS count,
    extract_travel_direction(observations.description) AS direction,
    ROW(gis.st_x(observations.location::gis.geometry), gis.st_y(observations.location::gis.geometry))::lon_lat AS location,
    observations.public_positional_accuracy AS accuracy,
    COALESCE(( SELECT array_agg(ROW(observation_photos.attribution::character varying, NULL::character varying, observation_photos.url::character varying, NULL::character varying, observation_photos.license)::occurrence_photo ORDER BY observation_photos.seq) AS array_agg
           FROM inaturalist.observation_photos
          WHERE observation_photos.observation_id = observations.id AND NOT observation_photos.hidden AND observation_photos.license IS NOT NULL), ARRAY[]::occurrence_photo[]) AS photos,
    observations.observed_at,
    NULL::lon_lat AS observed_from,
    ROW(t.scientific_name::character varying, COALESCE(reg.common_name, t.vernacular_name::text)::character varying, inaturalist.species_id(t.*))::taxon AS taxon,
    COALESCE(extract_identifiers(observations.description), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    observations.username AS observer,
    col.name AS collection,
    observations.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
   FROM inaturalist.observations
     JOIN inaturalist.taxa t ON observations.taxon_id = t.id
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN providers prov ON prov.id = observations.provider_id
     LEFT JOIN collections col ON col.id = observations.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id
UNION ALL
 SELECT 'happywhale:'::text || e.id AS id,
    (('https://happywhale.com/individual/'::text || e.individual_id) || ';enc='::text) || e.id AS url,
    COALESCE(u.display_name, 'a user'::character varying)::text || ' on HappyWhale'::text AS attribution,
    concat_ws('

'::text, ((((('['::text || i.primary_id::text) || ']('::text) || 'https://happywhale.com/individual/'::text) || e.individual_id) || ')'::text) ||
        CASE i.sex
            WHEN 'male'::sex THEN '♂'::text
            WHEN 'female'::sex THEN '♀'::text
            ELSE ''::text
        END, '📍 '::text || e.verbatim_location::text, e.comments) AS body,
    e.min_count AS count,
    extract_travel_direction(e.comments::text) AS direction,
    ROW(gis.st_x(e.location::gis.geometry), gis.st_y(e.location::gis.geometry))::lon_lat AS location,
        CASE e.accuracy
            WHEN 'GENERAL'::happywhale.accuracy THEN 161
            WHEN 'APPROX'::happywhale.accuracy THEN 16
            ELSE 2
        END AS accuracy,
    COALESCE(( SELECT array_agg(ROW(media_user.display_name::character varying, m.mimetype::character varying, m.url::character varying, m.thumb_url::character varying, NULL::license)::occurrence_photo ORDER BY m.id) AS array_agg
           FROM happywhale.media m
             LEFT JOIN happywhale.users media_user ON m.user_id = media_user.id
          WHERE m.public AND m.encounter_id = e.id AND (m.license_level::text ~~ 'CC_%'::text OR m.license_level::text = 'PUBLIC_DOMAIN'::text)), ARRAY[]::occurrence_photo[]) AS photos,
    ((e.start_date + COALESCE(e.start_time, '12:00:00'::time without time zone)) AT TIME ZONE e.timezone) AS observed_at,
    NULL::lon_lat AS observed_from,
    ROW(COALESCE(t.scientific_name, s.scientific)::character varying, COALESCE(reg.common_name, t.vernacular_name::text, s.name::text)::character varying, inaturalist.species_id(t.*))::taxon AS taxon,
    COALESCE(extract_identifiers(e.comments::text), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    u.display_name AS observer,
    col.name AS collection,
    e.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
   FROM happywhale.encounters e
     LEFT JOIN happywhale.users u ON e.user_id = u.id
     JOIN happywhale.individuals i ON e.individual_id = i.id
     JOIN happywhale.species s ON e.species_id = s.id
     LEFT JOIN inaturalist.taxa t ON s.scientific::text = t.scientific_name::text
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN providers prov ON prov.id = e.provider_id
     LEFT JOIN collections col ON col.id = e.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id
  WHERE e.public
UNION ALL
 SELECT o.id::text AS id,
    o.url,
    con.name::text || ' on SalishSea.io'::text AS attribution,
    o.body,
    o.count,
    o.direction,
    ROW(gis.st_x(o.subject_location::gis.geometry), gis.st_y(o.subject_location::gis.geometry))::lon_lat AS location,
    NULL::integer AS accuracy,
    COALESCE(( SELECT array_agg(ROW('someone'::character varying, NULL::character varying, observation_photos.href::character varying, NULL::character varying, observation_photos.license_code::license)::occurrence_photo ORDER BY observation_photos.seq) AS array_agg
           FROM observation_photos
          WHERE observation_photos.observation_id = o.id), ARRAY[]::occurrence_photo[]) AS photos,
    o.observed_at,
        CASE
            WHEN o.observer_location IS NOT NULL THEN ROW(gis.st_x(o.observer_location::gis.geometry), gis.st_y(o.observer_location::gis.geometry))::lon_lat
            ELSE NULL::lon_lat
        END AS observed_from,
    ROW(t.scientific_name::character varying, COALESCE(reg.common_name, t.vernacular_name::text)::character varying, inaturalist.species_id(t.*))::taxon AS taxon,
    COALESCE(extract_identifiers(o.body::text), ARRAY[]::character varying[]) AS identifiers,
    o.contributor_id,
    con.name AS observer,
    col.name AS collection,
    o.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
   FROM observations o
     JOIN contributors con ON con.id = o.contributor_id
     JOIN inaturalist.taxa t ON t.id = o.taxon_id
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN providers prov ON prov.id = o.provider_id
     LEFT JOIN collections col ON col.id = o.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id;
;

GRANT SELECT ON public.occurrences TO anon, authenticated;
