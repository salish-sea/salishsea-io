-- Our own sightings are keyed on a register entity, not an iNaturalist taxon (salish-53t.3).
--
-- public.observations.taxon_id held an iNaturalist integer that upsert_observation looked
-- up from the sighting form's scientific-name string. iNaturalist was being used as a
-- dictionary for data that is not iNaturalist's, and the key could not say what the form
-- actually asks: "Bigg's killer whale" is an ecotype, SSA:0000002, and iNaturalist can
-- only approximate it with the subspecies Orcinus orca rectipinnus. Production, 2026-09-22:
-- 579 rows; 222 Bigg's and 195 Resident among them.
--
-- WHAT CHANGES
--   * observations.entity_id (text, NOT NULL, an SSA: identifier) replaces taxon_id.
--     No foreign key into register.entities, following individuals.entity_id: the
--     register is reloaded wholesale each edition and CI never loads it.
--   * upsert_observation takes entity_id instead of a scientific name, and INSERTs
--     unconditionally. The old body selected FROM inaturalist.taxa WHERE scientific_name =
--     taxon, so an unrecognised name inserted nothing and reported success.
--   * public.occurrences' observations branch reads the entity it was given. Its
--     scientific_name still comes from iNaturalist — via the entity's own mapping — because
--     src/symbology.ts groups and labels by it ('Orcinus orca rectipinnus' -> "Biggs"), and
--     that is a separate question from what we key on.
--   * dwc._native_occurrences and dwc.export_coverage classify through the same mapping,
--     so the archive keeps publishing O. o. rectipinnus / ater for those records.
--   * public.animal_names gains inaturalist_scientific_name — the scientific name
--     public.occurrences will show for a sighting of that entity. The sighting form draws
--     its marker before the sighting is saved, and src/symbology.ts groups and labels by
--     that name, so the draft has to read the same one the saved record will.
--
-- WHAT IS LOST. Three form options were iNaturalist subspecies the register does not hold
-- — Phoca vitulina richardii (20 rows), Eumetopias jubatus monteriensis (2) and Enhydra
-- lutris kenyoni (0). They roll up to their species' entity, the same roll-up the view
-- already applied to their names (migration 20260828120000). The archive now publishes
-- those 22 at species rank.

-- ============================================================================
-- The iNaturalist taxon a register entity corresponds to.
-- ============================================================================
-- The entity's own exactMatch or closeMatch first, so an ecotype resolves to the subspecies
-- it is crosswalked to (SSA:0000002 -> 1602533 rectipinnus) rather than to its species;
-- then its taxon entity's, for anything with no mapping of its own. exactMatch before
-- closeMatch, then object_id, so a tie resolves the same way every time.
--
-- Unlike register.taxon_for, which names the taxon an entity BELONGS to, this answers what
-- the entity IS in iNaturalist's vocabulary, as precisely as the crosswalk allows. NULL
-- where neither the entity nor its taxon is crosswalked, or where the register is not
-- loaded at all.
--
-- search_path is empty, not register.taxon_for's `register, public, pg_catalog`: this is
-- definer-rights, and listing public ahead of pg_catalog would let an object created in
-- public shadow split_part or an operator. Every relation below is schema-qualified.
CREATE FUNCTION register.inaturalist_taxon_for(p_entity_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT split_part(m.object_id, ':', 2)::integer
  FROM register.mappings m
  WHERE m.subject_id IN (p_entity_id, register.taxon_entity_for(p_entity_id))
    AND m.predicate_id IN ('skos:exactMatch', 'skos:closeMatch')
    AND m.object_id ~ '^inaturalist\.taxon:[0-9]{1,9}$'
  ORDER BY (m.subject_id = p_entity_id) DESC,
           (m.predicate_id = 'skos:exactMatch') DESC,
           m.object_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION register.inaturalist_taxon_for(text) IS
  'The iNaturalist taxon id an entity corresponds to: its own exact or close match, else its taxon entity''s. NULL where neither is crosswalked or the register is not loaded.';

REVOKE ALL ON FUNCTION register.inaturalist_taxon_for(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register.inaturalist_taxon_for(text) TO anon, authenticated;

-- ============================================================================
-- observations.entity_id, backfilled from taxon_id.
-- ============================================================================
-- The backfill is the resolution the view applied at read time until now, so no record
-- changes identity: the recorded taxon's current version, its register entity, and for a
-- subspecies other than an orca or a common dolphin, its species' entity.
ALTER TABLE public.observations ADD COLUMN entity_id text;

UPDATE public.observations o
SET entity_id = COALESCE(reg.entity_id, par.entity_id)
FROM inaturalist.taxa t_recorded
JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
LEFT JOIN register.inaturalist_taxon_name par
  ON par.inat_taxon_id = t.parent_id
 AND t.rank = 'subspecies'
 AND t.scientific_name NOT LIKE 'Orcinus orca %'
 AND t.scientific_name NOT LIKE 'Delphinus delphis %'
WHERE t_recorded.id = o.taxon_id;

-- Refuse rather than guess. Production resolves all 579 (checked 2026-09-22); a row that
-- does not would otherwise fail the NOT NULL below with no hint of which one.
DO $$
DECLARE
  unresolved text;
BEGIN
  SELECT string_agg(id::text || ' (taxon ' || taxon_id || ')', ', ')
    INTO unresolved
    FROM public.observations WHERE entity_id IS NULL;
  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'observations with no register entity: %', unresolved;
  END IF;
END $$;

ALTER TABLE public.observations
  ALTER COLUMN entity_id SET NOT NULL,
  ADD CONSTRAINT observations_entity_id_format CHECK (entity_id ~ '^SSA:[0-9]{7}$');

-- ============================================================================
-- animal_names gains the scientific name an entity reads as (appended: CREATE OR REPLACE
-- VIEW may only add columns at the end). Body otherwise as 20260922010000. Resolved
-- exactly as the observations branch below resolves it — the entity's crosswalk, then
-- iNaturalist's current version of that taxon — so a draft marker and the saved sighting
-- cannot disagree. For SSA:0000002 that is 'Orcinus orca rectipinnus', which is what makes
-- a Bigg's track label read "Biggs".
-- ============================================================================
CREATE OR REPLACE VIEW public.animal_names AS
SELECT
  e.entity_id,
  (SELECT n.name FROM register.names n
    WHERE n.entity_id = e.entity_id AND n.type = 'common'
    ORDER BY (n.language = 'en') DESC NULLS LAST, length(n.name), n.name
    LIMIT 1) AS common_name,
  t.entity_id AS taxon_entity_id,
  t.vernacular_name AS taxon_common_name,
  (SELECT cur.scientific_name::text
     FROM inaturalist.taxa rec
     JOIN inaturalist.taxa cur ON cur.id = COALESCE(rec.current_taxon_id, rec.id)
    WHERE rec.id = register.inaturalist_taxon_for(e.entity_id)) AS inaturalist_scientific_name
FROM register.entities e
LEFT JOIN LATERAL register.taxon_for(e.entity_id) t ON true;

-- Restated: REVOKE before GRANT, for the reason 20260922010000 gives.
REVOKE ALL ON public.animal_names FROM anon, authenticated;
GRANT SELECT ON public.animal_names TO anon, authenticated;

-- ============================================================================
-- public.occurrences: the observations branch reads entity_id. The body is otherwise
-- the definition as it stood (20260920200000), unchanged; CREATE OR REPLACE keeps
-- occurrence_index and everything else that depends on the view in place.
--
-- The taxa joins become LEFT: with the register unloaded (CI, a fresh local stack) a
-- sighting should still appear, unnamed, rather than vanish from the map.
--
-- The common name is read from register.names directly, with animal_names' tie-break,
-- rather than by joining animal_names: that view calls register.taxon_for per row for a
-- fallback no form option needs, and on production data it was half the branch's cost
-- (36 ms for one busy two-day window). This is the map's own query (salish-xfo).
-- ============================================================================
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
    prov.slug AS provider_slug,
    NULL::timestamp with time zone AS observed_until
   FROM maplify.sightings s
     JOIN inaturalist.taxa t_recorded ON s.taxon_id = t_recorded.id
     JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id AND t.rank = 'subspecies'::inaturalist.rank AND t.scientific_name::text !~~ 'Orcinus orca %'::text AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
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
    prov.slug AS provider_slug,
    NULL::timestamp with time zone AS observed_until
   FROM inaturalist.observations
     JOIN inaturalist.taxa t_recorded ON observations.taxon_id = t_recorded.id
     JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id AND t.rank = 'subspecies'::inaturalist.rank AND t.scientific_name::text !~~ 'Orcinus orca %'::text AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
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
    prov.slug AS provider_slug,
        CASE
            WHEN e.end_time > e.start_time THEN ((e.start_date + e.end_time) AT TIME ZONE e.timezone)
            ELSE NULL::timestamp with time zone
        END AS observed_until
   FROM happywhale.encounters e
     LEFT JOIN happywhale.users u ON e.user_id = u.id
     JOIN happywhale.individuals i ON e.individual_id = i.id
     JOIN happywhale.species s ON e.species_id = s.id
     LEFT JOIN inaturalist.taxa t_recorded ON s.scientific::text = t_recorded.scientific_name::text
     LEFT JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id AND t.rank = 'subspecies'::inaturalist.rank AND t.scientific_name::text !~~ 'Orcinus orca %'::text AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
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
    ROW(t.scientific_name::character varying, COALESCE(( SELECT n.name
           FROM register.names n
          WHERE n.entity_id = o.entity_id AND n.type = 'common'::text
          ORDER BY (n.language = 'en'::text) DESC NULLS LAST, (length(n.name)), n.name
         LIMIT 1), t.vernacular_name::text)::character varying, inaturalist.species_id(t.*), o.entity_id)::taxon AS taxon,
    COALESCE(extract_identifiers(o.body::text), ARRAY[]::character varying[]) AS identifiers,
    o.contributor_id,
    con.name AS observer,
    col.name AS collection,
    o.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug,
    NULL::timestamp with time zone AS observed_until
   FROM observations o
     JOIN contributors con ON con.id = o.contributor_id
     LEFT JOIN inaturalist.taxa t_recorded ON t_recorded.id = register.inaturalist_taxon_for(o.entity_id)
     LEFT JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
     LEFT JOIN providers prov ON prov.id = o.provider_id
     LEFT JOIN collections col ON col.id = o.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id;

-- ============================================================================
-- The archive classifies our own sightings through the same mapping.
-- Bodies as they stood (pg_get_viewdef) except the taxon join.
-- ============================================================================
CREATE OR REPLACE VIEW dwc._native_occurrences AS
 SELECT ('salishsea:'::text || (o.id)::text) AS "occurrenceID",
    'HumanObservation'::text AS "basisOfRecord",
    to_char((o.observed_at AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text) AS "eventDate",
    (tc.scientific_name)::text AS "scientificName",
    tc.taxon_rank AS "taxonRank",
    tc.kingdom,
    tc.phylum,
    tc.class,
    tc.order_ AS "order",
    tc.family,
    tc.genus,
    gis.st_y((o.subject_location)::gis.geometry) AS "decimalLatitude",
    gis.st_x((o.subject_location)::gis.geometry) AS "decimalLongitude",
    'WGS84'::text AS "geodeticDatum",
    NULLIF(o.accuracy, 0) AS "coordinateUncertaintyInMeters",
    (o.count)::integer AS "individualCount",
    'present'::text AS "occurrenceStatus",
    NULLIF(TRIM(BOTH FROM regexp_replace((o.body)::text, '<[^>]+>'::text, ''::text, 'g'::text)), ''::text) AS "occurrenceRemarks",
    (c.name)::text AS "recordedBy",
    'SalishSea'::text AS "institutionCode",
    'SalishSea.io'::text AS "rightsHolder",
    ('SalishSea.io — '::text || (c_coll.name)::text) AS "datasetName",
    'https://salishsea.io/datasets/occurrences-v1'::text AS "datasetID",
    'https://creativecommons.org/licenses/by-nc/4.0/legalcode'::text AS license,
    NULLIF((jsonb_strip_nulls(jsonb_build_object('travelDirection', (o.direction)::text, 'unvalidatedIdentifiers', NULLIF(extract_identifiers((o.body)::text), ARRAY[]::character varying[]))))::text, '{}'::text) AS "dynamicProperties",
    NULL::text AS "informationWithheld",
    c.orcid AS "recordedByID"
   FROM (((observations o
     JOIN contributors c ON ((c.id = o.contributor_id)))
     JOIN dwc.taxa_classification tc ON ((tc.taxon_id = register.inaturalist_taxon_for(o.entity_id))))
     JOIN collections c_coll ON ((c_coll.id = o.collection_id)));

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
                  WHERE (tc.taxon_id = s.taxon_id))))) AS no_taxon
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
-- taxon_id goes, and upsert_observation takes the entity.
-- ============================================================================
ALTER TABLE public.observations DROP COLUMN taxon_id;

DROP FUNCTION public.upsert_observation(uuid, integer, character varying, smallint, travel_direction, timestamp with time zone, lon_lat, occurrence_photo[], lon_lat, character varying, character varying);

-- Parameter order matches the old signature with `taxon` replaced in place; PostgREST
-- calls by name, so only the name matters to the client.
CREATE FUNCTION public.upsert_observation(
  id uuid,
  accuracy integer,
  body character varying,
  count smallint,
  direction travel_direction,
  observed_at timestamp with time zone,
  observed_from lon_lat,
  photos occurrence_photo[],
  location lon_lat,
  entity_id text,
  url character varying
)
RETURNS uuid
LANGUAGE sql
SET search_path TO ''
AS $function$
  INSERT INTO public.observations (id, body, count, direction, observed_at, observer_location, subject_location, entity_id, url, created_at, updated_at, contributor_id, user_uuid)
  VALUES (
    $1,
    NULLIF(TRIM(body), ''),
    count,
    direction,
    observed_at,
    gis.ST_Point(observed_from.lon, observed_from.lat),
    gis.ST_Point("location".lon, "location".lat),
    entity_id,
    url,
    current_timestamp,
    current_timestamp,
    (SELECT contributor_id FROM public.user_contributor WHERE user_uuid = auth.uid()),
    auth.uid()
  )
  ON CONFLICT (id) DO UPDATE SET
    body=EXCLUDED.body,
    count=EXCLUDED.count,
    direction=EXCLUDED.direction,
    observed_at=EXCLUDED.observed_at,
    observer_location=EXCLUDED.observer_location,
    subject_location=EXCLUDED.subject_location,
    entity_id=EXCLUDED.entity_id,
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
$function$;
