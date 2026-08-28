-- Carry the register's identifier onto the occurrence (salish-ayb.6, decision 029).
--
-- Migration 20260828110000 brought the register's NAME onto every occurrence. This brings
-- its IDENTIFIER, which is a different thing and is needed for a different reason.
--
-- Decision 029 puts a short form on the map — `Humpback` where the register says
-- `Humpback whale` — and animals ADR-0011 makes that ours to compose: the label is
-- "input to display, not display", and truncation is named as a consumer concern. But a
-- short form has to be keyed on something, and the only stable key is the register's
-- `SSA:` identifier. ADR-0002 makes it opaque and therefore permanent, which is exactly
-- what a display override needs: the name it shortens may be revised edition to edition,
-- and the override must follow the animal rather than the string.
--
-- The two rejected keys, recorded so they are not proposed again:
--
--   * The register's common name. Keying a short form on the string it shortens means a
--     name revision silently drops the override, and it invites a join on a display
--     string — the thing decision 008 and ADR-0012 both exist to prevent.
--   * `scientific_name`, which the occurrence already carries. It comes from the
--     iNaturalist mirror and moves with iNaturalist's taxonomy: migration 20260828000000
--     exists precisely because taxa get retired and merged upstream. A key that changes
--     when someone else reclassifies an animal is not a key.
--
-- COALESCE(reg, par) mirrors the name resolution one column over, so a subspecies that
-- displays its species' name is keyed by its species' entity too. Without that the two
-- would disagree — a harbour seal reading `Harbour seal` from the register while carrying
-- no identifier to look a short form up by.
--
-- Orcinus and Delphinus subspecies still resolve to nothing here, as they do for the
-- name: 20260828120000 excludes them deliberately, because their qualifier is the ecotype
-- the map most wants to show. Killer whales get their label from the pod branch instead.
--
-- ALTER TYPE ADD ATTRIBUTE is legal here because `taxon` appears in no stored column —
-- only in this view's output (verified against pg_attribute). It is not legal to do this
-- and leave the view alone: every ROW(...)::taxon in it would then be casting a 3-field
-- row to a 4-attribute type, which fails at query time. The two statements are one
-- change, and a migration runs in a transaction, so no reader sees the gap.
--
-- SCOPE. Additive: the column list is unchanged, so CREATE OR REPLACE keeps the
-- three-level dependency chain (occurrence_index, occurrence_identifier_candidates, and
-- group_occurrences/ecotype_occurrences above them) intact. Nothing in `dwc` reads the
-- view and the archive emits no vernacularName, so the DwC-A is untouched. The
-- Lambda@Edge card renderer reads taxon.vernacular_name and is indifferent to a new
-- attribute beside it.
ALTER TYPE public.taxon ADD ATTRIBUTE entity_id text;

COMMENT ON TYPE public.taxon IS
  'What the app is told an occurrence is. scientific_name and vernacular_name are for '
  'display; species_id chains sightings of one species into a track; entity_id is the '
  'register entity the name was resolved through (register.inaturalist_taxon_name), and '
  'is NULL where the register has no exact match. Key presentation overrides on '
  'entity_id, never on either name.';

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
    ROW(COALESCE(t.scientific_name, s.scientific_name), COALESCE(reg.common_name, par.common_name, t.vernacular_name::text)::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
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
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = COALESCE(t.current_taxon_id, t.id)
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id
       AND t.rank = 'subspecies'::inaturalist.rank
       AND t.scientific_name::text !~~ 'Orcinus orca %'::text
       AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
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
    ROW(t.scientific_name::character varying, COALESCE(reg.common_name, par.common_name, t.vernacular_name::text)::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
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
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = COALESCE(t.current_taxon_id, t.id)
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id
       AND t.rank = 'subspecies'::inaturalist.rank
       AND t.scientific_name::text !~~ 'Orcinus orca %'::text
       AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
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
    ROW(COALESCE(t.scientific_name, s.scientific)::character varying, COALESCE(reg.common_name, par.common_name, t.vernacular_name::text, s.name::text)::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
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
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = COALESCE(t.current_taxon_id, t.id)
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id
       AND t.rank = 'subspecies'::inaturalist.rank
       AND t.scientific_name::text !~~ 'Orcinus orca %'::text
       AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
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
    ROW(t.scientific_name::character varying, COALESCE(reg.common_name, par.common_name, t.vernacular_name::text)::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
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
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = COALESCE(t.current_taxon_id, t.id)
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id
       AND t.rank = 'subspecies'::inaturalist.rank
       AND t.scientific_name::text !~~ 'Orcinus orca %'::text
       AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
     LEFT JOIN providers prov ON prov.id = o.provider_id
     LEFT JOIN collections col ON col.id = o.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id;
;

GRANT SELECT ON public.occurrences TO anon, authenticated;
