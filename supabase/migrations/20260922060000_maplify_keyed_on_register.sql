-- Maplify sightings are keyed on the register entity their names resolve to (salish-53t.3,
-- decision 049).
--
-- maplify.sightings.taxon_id was an iNaturalist integer the ingest derived by turning
-- Whale Alert's labels into iNaturalist scientific names (a hand-kept dictionary in
-- scripts/ingest/maplify.ts) and joining inaturalist.taxa on the result: iNaturalist as a
-- dictionary for a source that is not iNaturalist's. The register is that dictionary now.
-- The ingest matches both of a record's names against every name the register publishes,
-- by the register's own fold (ADR-0019, scripts/register/fold.ts), and stores the entity.
--
-- Measured on production's 28,434 records against edition 2026.09.5 (which added the
-- names and three vagrant taxa this needed, animals#42): 23,854 resolve to the entity they
-- resolve to today, 9 gain one they lacked, 0 lose one, and 4,571 move — every "Southern
-- Resident Killer Whale" report, from Resident generally (SSA:0000003, the ater crosswalk)
-- to the Southern Resident community (SSA:0000010) the report actually names.
--
-- THIS MIGRATION backfills entity_id in SQL with exactly the resolution the view applied
-- until now, so nothing on the map changes when it lands. Deploy then runs register-refresh,
-- whose new step (scripts/register/resolve-maplify.ts) re-resolves every row with the real
-- resolver — and does so after every register load from now on.

-- ============================================================================
-- inaturalist_taxon_for: the NEAREST crosswalked entity, not the entity or its species.
-- ============================================================================
-- The entity's own mapping, then its ancestors' nearest first, then its taxon entity's
-- (which is how a merged-away identifier, whose ancestry is gone, still resolves). For
-- SSA:0000010 Southern Resident that is Resident's closeMatch to Orcinus orca ater — so the
-- 4,571 Southern Resident records keep publishing as ater instead of falling to the species.
-- Every entity with a mapping of its own resolves exactly as before; our own sightings
-- (decision 048) all have one.
CREATE OR REPLACE FUNCTION register.inaturalist_taxon_for(p_entity_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT split_part(m.object_id, ':', 2)::integer
  FROM (
    SELECT p_entity_id AS entity_id, 0 AS depth
    UNION ALL
    SELECT a.ancestor_id, a.depth FROM register.ancestor a WHERE a.entity_id = p_entity_id
    UNION ALL
    SELECT register.taxon_entity_for(p_entity_id), 2147483647
  ) c
  JOIN register.mappings m ON m.subject_id = c.entity_id
  WHERE m.predicate_id IN ('skos:exactMatch', 'skos:closeMatch')
    AND m.object_id ~ '^inaturalist\.taxon:[0-9]{1,9}$'
  ORDER BY c.depth,
           (m.predicate_id = 'skos:exactMatch') DESC,
           m.object_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION register.inaturalist_taxon_for(text) IS
  'The iNaturalist taxon id an entity corresponds to: its own exact or close match, else its nearest crosswalked ancestor''s, else its taxon entity''s. NULL where none is crosswalked or the register is not loaded.';

-- ============================================================================
-- maplify.sightings.entity_id, backfilled as the view resolved it.
-- ============================================================================
-- Nullable, unlike observations.entity_id: ~1,770 records carry no identification at all
-- ("Unspecified", "Other"). No foreign key, as with observations and individuals (the
-- register is reloaded wholesale each edition).
ALTER TABLE maplify.sightings
  ADD COLUMN entity_id text,
  ADD CONSTRAINT sightings_entity_id_format CHECK (entity_id ~ '^SSA:[0-9]{7}$');

UPDATE maplify.sightings s
SET entity_id = COALESCE(reg.entity_id, par.entity_id)
FROM inaturalist.taxa t_recorded
JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
LEFT JOIN register.inaturalist_taxon_name par
  ON par.inat_taxon_id = t.parent_id
 AND t.rank = 'subspecies'
 AND t.scientific_name NOT LIKE 'Orcinus orca %'
 AND t.scientific_name NOT LIKE 'Delphinus delphis %'
WHERE t_recorded.id = s.taxon_id;

-- ============================================================================
-- public.occurrences: the Maplify branch reads entity_id. Otherwise the definition as it
-- stood (20260922040000, via pg_get_viewdef), unchanged; CREATE OR REPLACE keeps every
-- dependant in place.
--
-- `s.entity_id IS NOT NULL` keeps what the old INNER JOIN onto inaturalist.taxa did: a
-- record with no identification was never on the map, and still is not. The taxa joins
-- are LEFT, so an identified record whose entity has no iNaturalist crosswalk still shows,
-- under its upstream scientific name.
-- ============================================================================
CREATE OR REPLACE VIEW public.occurrences AS
 SELECT ('maplify:'::text || s.id) AS id,
    NULL::character varying AS url,
    (((s.usernm)::text || ' on '::text) || (s.source)::text) AS attribution,
    s.comments AS body,
        CASE
            WHEN ((s.number_sighted >= 1) AND (s.number_sighted <= 1000)) THEN s.number_sighted
            ELSE NULL::integer
        END AS count,
    extract_travel_direction((s.comments)::text) AS direction,
    ROW(gis.st_x((s.location)::gis.geometry), gis.st_y((s.location)::gis.geometry))::lon_lat AS location,
    NULL::integer AS accuracy,
        CASE
            WHEN (s.photo_url IS NOT NULL) THEN ARRAY[ROW(NULL::character varying, NULL::character varying, (s.photo_url)::character varying, NULL::character varying, NULL::license)::occurrence_photo]
            ELSE '{}'::occurrence_photo[]
        END AS photos,
    (s.created_at AT TIME ZONE 'GMT'::text) AS observed_at,
    NULL::lon_lat AS observed_from,
    ROW(COALESCE(t.scientific_name, s.scientific_name), (COALESCE(( SELECT n.name
           FROM register.names n
          WHERE ((n.entity_id = s.entity_id) AND (n.type = 'common'::text))
          ORDER BY (n.language = 'en'::text) DESC NULLS LAST, (length(n.name)), n.name
         LIMIT 1), (t.vernacular_name)::text))::character varying, inaturalist.species_id(t.*), s.entity_id)::taxon AS taxon,
    COALESCE(extract_identifiers((s.comments)::text), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    NULL::text AS observer,
    col.name AS collection,
    s.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug,
    NULL::timestamp with time zone AS observed_until
   FROM (((((maplify.sightings s
     LEFT JOIN inaturalist.taxa t_recorded ON ((t_recorded.id = register.inaturalist_taxon_for(s.entity_id))))
     LEFT JOIN inaturalist.taxa t ON ((t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id))))
     LEFT JOIN providers prov ON ((prov.id = s.provider_id)))
     LEFT JOIN collections col ON ((col.id = s.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)))
  WHERE ((NOT s.is_test) AND (s.entity_id IS NOT NULL))
UNION ALL
 SELECT ('inaturalist:'::text || observations.id) AS id,
    observations.uri AS url,
    ((observations.username)::text || ' on iNaturalist'::text) AS attribution,
    observations.description AS body,
    NULL::integer AS count,
    extract_travel_direction(observations.description) AS direction,
    ROW(gis.st_x((observations.location)::gis.geometry), gis.st_y((observations.location)::gis.geometry))::lon_lat AS location,
    observations.public_positional_accuracy AS accuracy,
    COALESCE(( SELECT array_agg(ROW((observation_photos.attribution)::character varying, NULL::character varying, (observation_photos.url)::character varying, NULL::character varying, observation_photos.license)::occurrence_photo ORDER BY observation_photos.seq) AS array_agg
           FROM inaturalist.observation_photos
          WHERE ((observation_photos.observation_id = observations.id) AND (NOT observation_photos.hidden) AND (observation_photos.license IS NOT NULL))), ARRAY[]::occurrence_photo[]) AS photos,
    observations.observed_at,
    NULL::lon_lat AS observed_from,
    ROW((t.scientific_name)::character varying, (COALESCE(reg.common_name, par.common_name, (t.vernacular_name)::text))::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
    COALESCE(extract_identifiers(observations.description), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    observations.username AS observer,
    col.name AS collection,
    observations.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug,
    NULL::timestamp with time zone AS observed_until
   FROM (((((((inaturalist.observations
     JOIN inaturalist.taxa t_recorded ON ((observations.taxon_id = t_recorded.id)))
     JOIN inaturalist.taxa t ON ((t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id))))
     LEFT JOIN register.inaturalist_taxon_name reg ON ((reg.inat_taxon_id = t.id)))
     LEFT JOIN register.inaturalist_taxon_name par ON (((par.inat_taxon_id = t.parent_id) AND (t.rank = 'subspecies'::inaturalist.rank) AND ((t.scientific_name)::text !~~ 'Orcinus orca %'::text) AND ((t.scientific_name)::text !~~ 'Delphinus delphis %'::text))))
     LEFT JOIN providers prov ON ((prov.id = observations.provider_id)))
     LEFT JOIN collections col ON ((col.id = observations.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)))
UNION ALL
 SELECT ('happywhale:'::text || e.id) AS id,
    ((('https://happywhale.com/individual/'::text || e.individual_id) || ';enc='::text) || e.id) AS url,
    ((COALESCE(u.display_name, 'a user'::character varying))::text || ' on HappyWhale'::text) AS attribution,
    concat_ws('

'::text, (((((('['::text || (i.primary_id)::text) || ']('::text) || 'https://happywhale.com/individual/'::text) || e.individual_id) || ')'::text) ||
        CASE i.sex
            WHEN 'male'::sex THEN '♂'::text
            WHEN 'female'::sex THEN '♀'::text
            ELSE ''::text
        END), ('📍 '::text || (e.verbatim_location)::text), e.comments) AS body,
    e.min_count AS count,
    extract_travel_direction((e.comments)::text) AS direction,
    ROW(gis.st_x((e.location)::gis.geometry), gis.st_y((e.location)::gis.geometry))::lon_lat AS location,
        CASE e.accuracy
            WHEN 'GENERAL'::happywhale.accuracy THEN 161
            WHEN 'APPROX'::happywhale.accuracy THEN 16
            ELSE 2
        END AS accuracy,
    COALESCE(( SELECT array_agg(ROW((media_user.display_name)::character varying, (m.mimetype)::character varying, (m.url)::character varying, (m.thumb_url)::character varying, NULL::license)::occurrence_photo ORDER BY m.id) AS array_agg
           FROM (happywhale.media m
             LEFT JOIN happywhale.users media_user ON ((m.user_id = media_user.id)))
          WHERE (m.public AND (m.encounter_id = e.id) AND (((m.license_level)::text ~~ 'CC_%'::text) OR ((m.license_level)::text = 'PUBLIC_DOMAIN'::text)))), ARRAY[]::occurrence_photo[]) AS photos,
    ((e.start_date + COALESCE(e.start_time, '12:00:00'::time without time zone)) AT TIME ZONE e.timezone) AS observed_at,
    NULL::lon_lat AS observed_from,
    ROW((COALESCE(t.scientific_name, s.scientific))::character varying, (COALESCE(reg.common_name, par.common_name, (t.vernacular_name)::text, (s.name)::text))::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
    COALESCE(extract_identifiers((e.comments)::text), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    u.display_name AS observer,
    col.name AS collection,
    e.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug,
        CASE
            WHEN (e.end_time > e.start_time) THEN ((e.start_date + e.end_time) AT TIME ZONE e.timezone)
            ELSE NULL::timestamp with time zone
        END AS observed_until
   FROM ((((((((((happywhale.encounters e
     LEFT JOIN happywhale.users u ON ((e.user_id = u.id)))
     JOIN happywhale.individuals i ON ((e.individual_id = i.id)))
     JOIN happywhale.species s ON ((e.species_id = s.id)))
     LEFT JOIN inaturalist.taxa t_recorded ON (((s.scientific)::text = (t_recorded.scientific_name)::text)))
     LEFT JOIN inaturalist.taxa t ON ((t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id))))
     LEFT JOIN register.inaturalist_taxon_name reg ON ((reg.inat_taxon_id = t.id)))
     LEFT JOIN register.inaturalist_taxon_name par ON (((par.inat_taxon_id = t.parent_id) AND (t.rank = 'subspecies'::inaturalist.rank) AND ((t.scientific_name)::text !~~ 'Orcinus orca %'::text) AND ((t.scientific_name)::text !~~ 'Delphinus delphis %'::text))))
     LEFT JOIN providers prov ON ((prov.id = e.provider_id)))
     LEFT JOIN collections col ON ((col.id = e.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)))
  WHERE e.public
UNION ALL
 SELECT (o.id)::text AS id,
    o.url,
    ((con.name)::text || ' on SalishSea.io'::text) AS attribution,
    o.body,
    o.count,
    o.direction,
    ROW(gis.st_x((o.subject_location)::gis.geometry), gis.st_y((o.subject_location)::gis.geometry))::lon_lat AS location,
    NULL::integer AS accuracy,
    COALESCE(( SELECT array_agg(ROW('someone'::character varying, NULL::character varying, (observation_photos.href)::character varying, NULL::character varying, (observation_photos.license_code)::license)::occurrence_photo ORDER BY observation_photos.seq) AS array_agg
           FROM observation_photos
          WHERE (observation_photos.observation_id = o.id)), ARRAY[]::occurrence_photo[]) AS photos,
    o.observed_at,
        CASE
            WHEN (o.observer_location IS NOT NULL) THEN ROW(gis.st_x((o.observer_location)::gis.geometry), gis.st_y((o.observer_location)::gis.geometry))::lon_lat
            ELSE NULL::lon_lat
        END AS observed_from,
    ROW((t.scientific_name)::character varying, (COALESCE(( SELECT n.name
           FROM register.names n
          WHERE ((n.entity_id = o.entity_id) AND (n.type = 'common'::text))
          ORDER BY (n.language = 'en'::text) DESC NULLS LAST, (length(n.name)), n.name
         LIMIT 1), (t.vernacular_name)::text))::character varying, inaturalist.species_id(t.*), o.entity_id)::taxon AS taxon,
    COALESCE(extract_identifiers((o.body)::text), ARRAY[]::character varying[]) AS identifiers,
    o.contributor_id,
    con.name AS observer,
    col.name AS collection,
    o.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug,
    NULL::timestamp with time zone AS observed_until
   FROM ((((((observations o
     JOIN contributors con ON ((con.id = o.contributor_id)))
     LEFT JOIN inaturalist.taxa t_recorded ON ((t_recorded.id = register.inaturalist_taxon_for(o.entity_id))))
     LEFT JOIN inaturalist.taxa t ON ((t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id))))
     LEFT JOIN providers prov ON ((prov.id = o.provider_id)))
     LEFT JOIN collections col ON ((col.id = o.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)));

-- ============================================================================
-- The archive classifies Maplify records through the entity too. Bodies as they stood
-- (pg_get_viewdef) except the taxon join.
-- ============================================================================
CREATE OR REPLACE VIEW dwc._maplify_occurrences AS
 SELECT ('maplify:'::text || (s.id)::text) AS "occurrenceID",
    'HumanObservation'::text AS "basisOfRecord",
    (((s.created_at AT TIME ZONE 'GMT'::text))::date)::text AS "eventDate",
    (tc.scientific_name)::text AS "scientificName",
    tc.taxon_rank AS "taxonRank",
    tc.kingdom,
    tc.phylum,
    tc.class,
    tc.order_ AS "order",
    tc.family,
    tc.genus,
    gis.st_y((s.location)::gis.geometry) AS "decimalLatitude",
    gis.st_x((s.location)::gis.geometry) AS "decimalLongitude",
    'WGS84'::text AS "geodeticDatum",
    NULL::integer AS "coordinateUncertaintyInMeters",
    s.number_sighted AS "individualCount",
    'present'::text AS "occurrenceStatus",
    NULLIF(TRIM(BOTH FROM regexp_replace((s.comments)::text, '<[^>]+>'::text, ''::text, 'g'::text)), ''::text) AS "occurrenceRemarks",
    NULLIF(
        CASE
            WHEN (((regexp_match(split_part((s.comments)::text, '<br>'::text, 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'::text))[1] ~ '[,]'::text) OR ((regexp_match(split_part((s.comments)::text, '<br>'::text, 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'::text))[1] ~ '^IDs?\s'::text)) THEN NULL::text
            ELSE (regexp_match(split_part((s.comments)::text, '<br>'::text, 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'::text))[1]
        END, NULL::text) AS "recordedBy",
    'SalishSea'::text AS "institutionCode",
    'SalishSea.io'::text AS "rightsHolder",
    ('SalishSea.io — '::text || (COALESCE(c_coll.name, 'Whale Alert (Global)'::character varying))::text) AS "datasetName",
    'https://salishsea.io/datasets/occurrences-v1'::text AS "datasetID",
    'https://creativecommons.org/licenses/by/4.0/legalcode'::text AS license,
    NULLIF((jsonb_strip_nulls(jsonb_build_object('travelDirection', (extract_travel_direction((s.comments)::text))::text, 'aggregatorSource', COALESCE(c_coll.name, 'Whale Alert (Global)'::character varying), 'aggregatorChain', ('Whale Alert / Maplify (WASEAK) > '::text || (COALESCE(c_coll.name, 'Whale Alert (Global)'::character varying))::text), 'unvalidatedIdentifiers', NULLIF(extract_identifiers((s.comments)::text), ARRAY[]::character varying[]))))::text, '{}'::text) AS "dynamicProperties",
    NULL::text AS "informationWithheld",
    NULL::text AS "recordedByID"
   FROM ((maplify.sightings s
     JOIN dwc.taxa_classification tc ON ((tc.taxon_id = register.inaturalist_taxon_for(s.entity_id))))
     LEFT JOIN collections c_coll ON ((c_coll.id = s.collection_id)))
  WHERE ((NOT s.is_test) AND ((s.number_sighted >= 1) AND (s.number_sighted <= 1000)) AND ((s.source)::text <> 'rwsas'::text) AND s.trusted);

CREATE OR REPLACE VIEW dwc.export_coverage AS
 WITH native AS (
         SELECT count(*) AS source_rows,
            count(*) FILTER (WHERE (NOT (EXISTS ( SELECT 1
                   FROM contributors c
                  WHERE (c.id = o.contributor_id))))) AS no_contributor,
            count(*) FILTER (WHERE (NOT (EXISTS ( SELECT 1
                   FROM dwc.taxa_classification tc
                  WHERE (tc.taxon_id = register.inaturalist_taxon_for(o.entity_id)))))) AS no_taxon,
            count(*) FILTER (WHERE (NOT (EXISTS ( SELECT 1
                   FROM collections cc
                  WHERE (cc.id = o.collection_id))))) AS no_collection
           FROM observations o
        ), maplify AS (
         SELECT count(*) AS source_rows,
            count(*) FILTER (WHERE (NOT (EXISTS ( SELECT 1
                   FROM dwc.taxa_classification tc
                  WHERE (tc.taxon_id = register.inaturalist_taxon_for(s.entity_id)))))) AS no_taxon
           FROM maplify.sightings s
          WHERE ((NOT s.is_test) AND ((s.number_sighted >= 1) AND (s.number_sighted <= 1000)) AND ((s.source)::text <> 'rwsas'::text) AND s.trusted)
        )
 SELECT 'native'::text AS branch,
    native.source_rows,
    ( SELECT count(*) AS count
           FROM dwc._native_occurrences) AS exported_rows,
    native.no_contributor,
    native.no_taxon,
    native.no_collection
   FROM native
UNION ALL
 SELECT 'maplify'::text AS branch,
    maplify.source_rows,
    ( SELECT count(*) AS count
           FROM dwc._maplify_occurrences) AS exported_rows,
    NULL::bigint AS no_contributor,
    maplify.no_taxon,
    NULL::bigint AS no_collection
   FROM maplify;

-- ============================================================================
-- taxon_id goes. The ingest (deployed before this migration) no longer writes it.
-- ============================================================================
ALTER TABLE maplify.sightings DROP COLUMN taxon_id;
