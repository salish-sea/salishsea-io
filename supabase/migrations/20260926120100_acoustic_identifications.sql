-- A bout's cited entities are its identifications, and a hedge reaches every consumer
-- (decision 054; salish-8vr.27). Types and columns are the previous migration.
--
-- BEFORE: a bout's cited entity reached occurrence_identifications by a round trip through a
-- string: entity -> the register's label -> occurrences.identifiers -> the fold ->
-- occurrence_identifier_candidates, as a 'text_mention' captured by 'text_extraction', which
-- it is not. 'J pod' folds to nothing, so 141 bout labels sat in occurrence_unresolved_codes
-- on 2026-09-26 as if they were codes to fix; 'T037s' folds to a matriline, so four bouts
-- reached profile pages as text mentions. Neither row had a place for a hedge.
--
-- AFTER: public.acoustic_identifications derives one claim per (bout, cited entity) that
-- has a subject here, keyed on the register identifier, with the moderator's certainty. The
-- four views that read identifications and the text candidates gain it as a third branch,
-- method 'upstream_import' and evidence 'acoustic'. The candidates matview stops reading
-- bouts. Every branch of the occurrences view gains `certainty`; a 'possible' identifier
-- carries a trailing '?' in `identifiers`, so the map says "Killer whale · J pod, L pod?".
--
-- The candidates matview cannot be CREATE OR REPLACEd, so it and its five dependants are
-- dropped and re-created, as 20260923040000 did; their grants are re-applied at the end.

-- ---------------------------------------------------------------------------
-- 1. public.occurrences: `certainty` appended; the Orcasound branch computes it and marks
--    a hedged identifier. The other four branches are the text of 20260925120000.
-- ---------------------------------------------------------------------------
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
    NULL::timestamp with time zone AS observed_until,
    NULL::identification_certainty AS certainty
   FROM ((((((maplify.sightings s
     LEFT JOIN register.inaturalist_taxon xw ON ((xw.entity_id = s.entity_id)))
     LEFT JOIN inaturalist.taxa t_recorded ON ((t_recorded.id = xw.inaturalist_taxon_id)))
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
    NULL::timestamp with time zone AS observed_until,
    NULL::identification_certainty AS certainty
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
        END AS observed_until,
    NULL::identification_certainty AS certainty
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
    NULL::timestamp with time zone AS observed_until,
    NULL::identification_certainty AS certainty
   FROM (((((((observations o
     JOIN contributors con ON ((con.id = o.contributor_id)))
     LEFT JOIN register.inaturalist_taxon xw ON ((xw.entity_id = o.entity_id)))
     LEFT JOIN inaturalist.taxa t_recorded ON ((t_recorded.id = xw.inaturalist_taxon_id)))
     LEFT JOIN inaturalist.taxa t ON ((t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id))))
     LEFT JOIN providers prov ON ((prov.id = o.provider_id)))
     LEFT JOIN collections col ON ((col.id = o.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)))
UNION ALL
 SELECT ((('orcasound:'::text || b.id) || ':'::text) || tx.taxon_entity_id) AS id,
    ('https://live.orcasound.net/bouts/'::text || b.id)::character varying AS url,
    ('Orcasound moderators at '::text || b.feed_name) AS attribution,
    (b.title)::character varying AS body,
    NULL::integer AS count,
    NULL::travel_direction AS direction,
    ROW(gis.st_x((b.location)::gis.geometry), gis.st_y((b.location)::gis.geometry))::lon_lat AS location,
    NULL::integer AS accuracy,
    '{}'::occurrence_photo[] AS photos,
    b.started_at AS observed_at,
    NULL::lon_lat AS observed_from,
    register.taxon_for(tx.taxon_entity_id) AS taxon,
    COALESCE(tx.identifiers, ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    NULL::text AS observer,
    col.name AS collection,
    ('https://live.orcasound.net/bouts/'::text || b.id) AS source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug,
    b.ended_at AS observed_until,
    tx.certainty
   FROM ((((acoustic_bouts b
     CROSS JOIN LATERAL ( SELECT c.taxon_entity_id,
            -- The map label: a 'possible' identifier carries the mark the moderators
            -- already use, a trailing '?'; 'probable' and 'certain' show plain (054).
            array_agg(DISTINCT c.label ORDER BY c.label) FILTER (WHERE (c.kind <> 'taxon'::text)) AS identifiers,
            -- The occurrence's own certainty: the strongest claim reaching its species,
            -- where NULL (nobody asked) counts as unhedged. So a species is hedged only
            -- when EVERY claim reaching it is hedged, and then to the strongest degree.
            (array_agg(c.certainty ORDER BY c.certainty DESC NULLS FIRST))[1] AS certainty
           FROM ( SELECT register.taxon_entity_for(e.entity_id) AS taxon_entity_id,
                    e.certainty,
                    ent.kind,
                    (ent.label || CASE WHEN e.certainty = 'possible'::identification_certainty THEN '?'::text ELSE ''::text END)::character varying AS label
                   FROM (acoustic_bout_entities e
                     JOIN register.entities ent ON ((ent.entity_id = e.entity_id)))
                  WHERE (e.bout_id = b.id)) c
          GROUP BY c.taxon_entity_id) tx)
     LEFT JOIN providers prov ON ((prov.id = b.provider_id)))
     LEFT JOIN collections col ON ((col.id = b.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)))
  WHERE (tx.taxon_entity_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. The text candidates no longer read bouts. A bout's identity is a register identifier
--    the ingest stored, not a string to fold; it is derived in §3 instead.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW public.occurrence_identifier_candidates CASCADE;

CREATE MATERIALIZED VIEW public.occurrence_identifier_candidates AS
SELECT DISTINCT ON (o.id, ident.code) o.id AS occurrence_id,
  ident.code,
  d.individual_id,
  grp.id AS social_group_id,
  o.observed_at,
  o.location
FROM public.occurrences o
CROSS JOIN LATERAL unnest(o.identifiers) ident(code)
LEFT JOIN public.social_groups grp
  ON ident.code::text ~ 's$' AND grp.kind = 'matriline'
 AND grp.designation_folded || 's' = register.fold(ident.code::text)
LEFT JOIN public.designations d
  ON ident.code::text !~ 's$' AND d.code_folded = register.fold(ident.code::text)
-- Bouts carry register identifiers, not text; see public.acoustic_identifications.
WHERE o.id NOT LIKE 'orcasound:%';

CREATE UNIQUE INDEX occurrence_identifier_candidates_key
  ON public.occurrence_identifier_candidates (occurrence_id, code);
CREATE INDEX occurrence_identifier_candidates_individual_id_idx
  ON public.occurrence_identifier_candidates (individual_id);
CREATE INDEX occurrence_identifier_candidates_social_group_id_idx
  ON public.occurrence_identifier_candidates (social_group_id);

REVOKE ALL ON public.occurrence_identifier_candidates FROM anon, authenticated;

CREATE VIEW public.occurrence_unresolved_codes AS
SELECT occurrence_id, code
FROM public.occurrence_identifier_candidates c
WHERE individual_id IS NULL AND social_group_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. One claim per (bout, cited entity) that has a subject here. An entity with no row in
--    individuals or social_groups (a pod, today; a taxon, always) is still a label on the
--    map and the occurrence's taxon, and is not an identification, because an
--    identification needs exactly one subject. The occurrence id is derived the way the
--    occurrences view derives it, so a register reload moves both together.
-- ---------------------------------------------------------------------------
CREATE VIEW public.acoustic_identifications AS
SELECT ('orcasound:' || e.bout_id || ':' || register.taxon_entity_for(e.entity_id)) AS occurrence_id,
  e.bout_id,
  e.entity_id,
  i.id AS individual_id,
  CASE WHEN i.id IS NULL THEN g.id END AS social_group_id,
  ent.label::text AS code,
  e.certainty
FROM public.acoustic_bout_entities e
JOIN register.entities ent ON ent.entity_id = e.entity_id
LEFT JOIN public.individuals i ON i.entity_id = e.entity_id
LEFT JOIN public.social_groups g ON g.entity_id = e.entity_id
WHERE (i.id IS NOT NULL OR g.id IS NOT NULL)
  AND register.taxon_entity_for(e.entity_id) IS NOT NULL;

COMMENT ON VIEW public.acoustic_identifications IS
  'A bout''s cited entities as identification claims (decision 054): one per (bout, entity) '
  'with a subject in individuals or social_groups, carrying the moderator''s certainty. Read '
  'by occurrence_identifications and the profile views; not a client-facing relation.';

-- Internal. Prod grants anon everything on a new public relation by default; refuse it.
REVOKE ALL ON public.acoustic_identifications FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. occurrence_identifications: `certainty` appended, and the acoustic branch. A stored
--    row for the same occurrence and subject overrides a derived one, as for the candidates.
-- ---------------------------------------------------------------------------
CREATE VIEW public.occurrence_identifications AS
SELECT identifications.id,
  identifications.occurrence_id,
  identifications.individual_id,
  identifications.social_group_id,
  identifications.is_present,
  identifications.evidence,
  identifications.method,
  identifications.status,
  identifications.asserted_by_party_id,
  identifications.confidence,
  identifications.code,
  identifications.created_at,
  identifications.certainty
FROM public.identifications
UNION ALL
SELECT NULL::integer AS id,
  c.occurrence_id,
  c.individual_id,
  c.social_group_id,
  true AS is_present,
  'text_mention'::public.identification_evidence AS evidence,
  'text_extraction'::public.identification_method AS method,
  'candidate'::public.identification_status AS status,
  NULL::integer AS asserted_by_party_id,
  NULL::real AS confidence,
  c.code,
  NULL::timestamp with time zone AS created_at,
  NULL::public.identification_certainty AS certainty
FROM public.occurrence_identifier_candidates c
WHERE (c.individual_id IS NOT NULL OR c.social_group_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND NOT s.individual_id IS DISTINCT FROM c.individual_id
      AND NOT s.social_group_id IS DISTINCT FROM c.social_group_id)
UNION ALL
SELECT NULL::integer AS id,
  a.occurrence_id,
  a.individual_id,
  a.social_group_id,
  true AS is_present,
  'acoustic'::public.identification_evidence AS evidence,
  'upstream_import'::public.identification_method AS method,
  'candidate'::public.identification_status AS status,
  NULL::integer AS asserted_by_party_id,
  NULL::real AS confidence,
  a.code,
  NULL::timestamp with time zone AS created_at,
  a.certainty
FROM public.acoustic_identifications a
WHERE NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = a.occurrence_id
      AND NOT s.individual_id IS DISTINCT FROM a.individual_id
      AND NOT s.social_group_id IS DISTINCT FROM a.social_group_id);

-- ---------------------------------------------------------------------------
-- 5. The profile views. Each gains `certainty` and the acoustic branch, which joins
--    occurrence_index for its place and time the way the stored branch does.
-- ---------------------------------------------------------------------------
CREATE VIEW public.group_occurrences AS
SELECT s.social_group_id,
  s.occurrence_id,
  o.observed_at,
  o.location,
  s.is_present,
  s.status,
  s.evidence,
  s.code,
  s.certainty
FROM public.identifications s
JOIN public.occurrence_index o ON o.id = s.occurrence_id
WHERE s.social_group_id IS NOT NULL
UNION ALL
SELECT c.social_group_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'text_mention'::public.identification_evidence AS evidence,
  c.code,
  NULL::public.identification_certainty AS certainty
FROM public.occurrence_identifier_candidates c
WHERE c.social_group_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = c.occurrence_id AND s.social_group_id = c.social_group_id)
UNION ALL
SELECT a.social_group_id,
  a.occurrence_id,
  o.observed_at,
  o.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'acoustic'::public.identification_evidence AS evidence,
  a.code,
  a.certainty
FROM public.acoustic_identifications a
JOIN public.occurrence_index o ON o.id = a.occurrence_id
WHERE a.social_group_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = a.occurrence_id AND s.social_group_id = a.social_group_id);

CREATE VIEW public.individual_occurrences AS
SELECT COALESCE(s.individual_id, mm.individual_id) AS individual_id,
  s.occurrence_id,
  o.observed_at,
  o.location,
  s.is_present,
  s.status,
  s.evidence,
  s.code,
  CASE WHEN s.individual_id IS NULL THEN g.designation ELSE NULL::text END AS via_group,
  s.certainty
FROM public.identifications s
LEFT JOIN (public.matriline_members mm
           JOIN public.individuals mi ON mi.id = mm.individual_id
                                     AND mi.life_status NOT IN ('deceased', 'presumed_deceased'))
  ON s.individual_id IS NULL AND mm.group_id = s.social_group_id
LEFT JOIN public.social_groups g ON g.id = s.social_group_id
JOIN public.occurrence_index o ON o.id = s.occurrence_id
WHERE COALESCE(s.individual_id, mm.individual_id) IS NOT NULL
UNION ALL
SELECT COALESCE(c.individual_id, mm.individual_id) AS individual_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'text_mention'::public.identification_evidence AS evidence,
  c.code,
  CASE WHEN c.individual_id IS NULL THEN g.designation ELSE NULL::text END AS via_group,
  NULL::public.identification_certainty AS certainty
FROM public.occurrence_identifier_candidates c
LEFT JOIN (public.matriline_members mm
           JOIN public.individuals mi ON mi.id = mm.individual_id
                                     AND mi.life_status NOT IN ('deceased', 'presumed_deceased'))
  ON c.individual_id IS NULL AND mm.group_id = c.social_group_id
LEFT JOIN public.social_groups g ON g.id = c.social_group_id
WHERE (c.individual_id IS NOT NULL OR c.social_group_id IS NOT NULL)
  AND COALESCE(c.individual_id, mm.individual_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND NOT s.individual_id IS DISTINCT FROM c.individual_id
      AND NOT s.social_group_id IS DISTINCT FROM c.social_group_id)
UNION ALL
SELECT COALESCE(a.individual_id, mm.individual_id) AS individual_id,
  a.occurrence_id,
  o.observed_at,
  o.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'acoustic'::public.identification_evidence AS evidence,
  a.code,
  CASE WHEN a.individual_id IS NULL THEN g.designation ELSE NULL::text END AS via_group,
  a.certainty
FROM public.acoustic_identifications a
LEFT JOIN (public.matriline_members mm
           JOIN public.individuals mi ON mi.id = mm.individual_id
                                     AND mi.life_status NOT IN ('deceased', 'presumed_deceased'))
  ON a.individual_id IS NULL AND mm.group_id = a.social_group_id
LEFT JOIN public.social_groups g ON g.id = a.social_group_id
JOIN public.occurrence_index o ON o.id = a.occurrence_id
WHERE COALESCE(a.individual_id, mm.individual_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = a.occurrence_id
      AND NOT s.individual_id IS DISTINCT FROM a.individual_id
      AND NOT s.social_group_id IS DISTINCT FROM a.social_group_id);

CREATE VIEW public.ecotype_occurrences AS
WITH group_to_ecotype AS (
  SELECT g.id AS group_id, e.id AS ecotype_id
  FROM public.social_groups g
  JOIN register.ancestor a ON a.entity_id = g.entity_id
  JOIN public.social_groups e ON e.entity_id = a.ancestor_id AND e.kind = 'ecotype'
  UNION ALL
  SELECT e.id, e.id FROM public.social_groups e WHERE e.kind = 'ecotype'
), individual_to_ecotype AS (
  SELECT i.id AS individual_id, e.id AS ecotype_id
  FROM public.individuals i
  JOIN register.ancestor a ON a.entity_id = i.entity_id
  JOIN public.social_groups e ON e.entity_id = a.ancestor_id AND e.kind = 'ecotype'
)
SELECT gte.ecotype_id, c.occurrence_id, c.observed_at, c.location,
  true AS is_present, 'candidate'::public.identification_status AS status,
  NULL::public.identification_certainty AS certainty
FROM public.occurrence_identifier_candidates c
JOIN group_to_ecotype gte ON gte.group_id = c.social_group_id
WHERE c.social_group_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = c.occurrence_id AND s.social_group_id = c.social_group_id)
UNION
SELECT ite.ecotype_id, c.occurrence_id, c.observed_at, c.location,
  true AS is_present, 'candidate'::public.identification_status AS status,
  NULL::public.identification_certainty AS certainty
FROM public.occurrence_identifier_candidates c
JOIN individual_to_ecotype ite ON ite.individual_id = c.individual_id
WHERE c.individual_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = c.occurrence_id AND s.individual_id = c.individual_id)
UNION
SELECT gte.ecotype_id, a.occurrence_id, o.observed_at, o.location,
  true AS is_present, 'candidate'::public.identification_status AS status, a.certainty
FROM public.acoustic_identifications a
JOIN public.occurrence_index o ON o.id = a.occurrence_id
JOIN group_to_ecotype gte ON gte.group_id = a.social_group_id
WHERE a.social_group_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = a.occurrence_id AND s.social_group_id = a.social_group_id)
UNION
SELECT ite.ecotype_id, a.occurrence_id, o.observed_at, o.location,
  true AS is_present, 'candidate'::public.identification_status AS status, a.certainty
FROM public.acoustic_identifications a
JOIN public.occurrence_index o ON o.id = a.occurrence_id
JOIN individual_to_ecotype ite ON ite.individual_id = a.individual_id
WHERE a.individual_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = a.occurrence_id AND s.individual_id = a.individual_id)
UNION
SELECT gte.ecotype_id, s.occurrence_id, o.observed_at, o.location, s.is_present, s.status, s.certainty
FROM public.identifications s
JOIN public.occurrence_index o ON o.id = s.occurrence_id
JOIN group_to_ecotype gte ON gte.group_id = s.social_group_id
WHERE s.social_group_id IS NOT NULL
UNION
SELECT ite.ecotype_id, s.occurrence_id, o.observed_at, o.location, s.is_present, s.status, s.certainty
FROM public.identifications s
JOIN public.occurrence_index o ON o.id = s.occurrence_id
JOIN individual_to_ecotype ite ON ite.individual_id = s.individual_id
WHERE s.individual_id IS NOT NULL;

-- The five views were readable before the drop; they are again, and nothing more
-- (supabase/read-grants.test.ts pins the set; acoustic_identifications is not in it).
REVOKE ALL ON public.occurrence_unresolved_codes, public.occurrence_identifications,
  public.group_occurrences, public.individual_occurrences, public.ecotype_occurrences
  FROM anon, authenticated;
GRANT SELECT ON public.occurrence_unresolved_codes, public.occurrence_identifications,
  public.group_occurrences, public.individual_occurrences, public.ecotype_occurrences
  TO anon, authenticated;
