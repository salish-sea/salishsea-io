-- Occurrences are stored, not assembled (decision 055; salish-4h3).
--
-- BEFORE: public.occurrences was a five-way UNION ALL view, and two matviews over it
-- (occurrence_index, occurrence_identifier_candidates) were each refreshed CONCURRENTLY
-- every five minutes. Each refresh recomputed all ~76k occurrences into a temp table and
-- diffed it against the old contents, spilling to disk at the instance's 2 MB work_mem:
-- 170 GB of temp files and 48 GB of temp-table writes in thirty days for occurrence_index
-- alone, on a 252 MB database, and Supabase's disk IO warning on 2026-09-27. The refreshes
-- never skipped a tick, though only one ingest tick in five changed anything.
--
-- AFTER: derived.occurrences holds the rows, maintained by statement triggers on every
-- source table in the writer's own transaction; reference data marks it stale and a
-- five-minute job rebuilds it as a diff. The derivation is still SQL: five views, one per
-- source, each exactly one branch of the old UNION ALL plus the source row's key.
-- public.occurrences keeps its name, columns and types, as a projection of the table, so
-- PostgREST clients, haulout_occurrences and the generated types see no change.
--
-- The candidates matview cannot be CREATE OR REPLACEd, so its five dependants are dropped
-- and re-created against the new tables, as 20260926120100 did; their grants are
-- re-applied at the end.

-- Filling the store is the slow part (seconds on a laptop, more on the Nano), and prod's
-- configured statement_timeout is 120 s. A timeout would only roll the migration back,
-- but a red deploy is still a deploy nobody wanted.
SET statement_timeout = 0;

-- ---------------------------------------------------------------------------
-- 1. The schema. Not exposed to PostgREST (supabase/config.toml), and no client role, nor
--    the ingest role, gets anything in it: the triggers reach it through definer functions.
-- ---------------------------------------------------------------------------
CREATE SCHEMA derived;
COMMENT ON SCHEMA derived IS
  'Rows derived from other tables and kept current by triggers (decision 055). Internal.';
REVOKE ALL ON SCHEMA derived FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. The derivation: one view per source. Each is the text of its branch of
--    public.occurrences in 20260926120100, unchanged, plus `source_key`, the source row's
--    key in its own type, so a filter on it reaches that table's primary key.
-- ---------------------------------------------------------------------------
CREATE VIEW derived.maplify_occurrences AS
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
    NULL::identification_certainty AS certainty,
    s.id AS source_key
   FROM ((((((maplify.sightings s
     LEFT JOIN register.inaturalist_taxon xw ON ((xw.entity_id = s.entity_id)))
     LEFT JOIN inaturalist.taxa t_recorded ON ((t_recorded.id = xw.inaturalist_taxon_id)))
     LEFT JOIN inaturalist.taxa t ON ((t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id))))
     LEFT JOIN providers prov ON ((prov.id = s.provider_id)))
     LEFT JOIN collections col ON ((col.id = s.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)))
  WHERE ((NOT s.is_test) AND (s.entity_id IS NOT NULL));

CREATE VIEW derived.inaturalist_occurrences AS
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
    NULL::identification_certainty AS certainty,
    observations.id AS source_key
   FROM (((((((inaturalist.observations
     JOIN inaturalist.taxa t_recorded ON ((observations.taxon_id = t_recorded.id)))
     JOIN inaturalist.taxa t ON ((t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id))))
     LEFT JOIN register.inaturalist_taxon_name reg ON ((reg.inat_taxon_id = t.id)))
     LEFT JOIN register.inaturalist_taxon_name par ON (((par.inat_taxon_id = t.parent_id) AND (t.rank = 'subspecies'::inaturalist.rank) AND ((t.scientific_name)::text !~~ 'Orcinus orca %'::text) AND ((t.scientific_name)::text !~~ 'Delphinus delphis %'::text))))
     LEFT JOIN providers prov ON ((prov.id = observations.provider_id)))
     LEFT JOIN collections col ON ((col.id = observations.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)));

CREATE VIEW derived.happywhale_occurrences AS
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
    NULL::identification_certainty AS certainty,
    e.id AS source_key
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
  WHERE e.public;

CREATE VIEW derived.native_occurrences AS
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
    NULL::identification_certainty AS certainty,
    o.id AS source_key
   FROM (((((((observations o
     JOIN contributors con ON ((con.id = o.contributor_id)))
     LEFT JOIN register.inaturalist_taxon xw ON ((xw.entity_id = o.entity_id)))
     LEFT JOIN inaturalist.taxa t_recorded ON ((t_recorded.id = xw.inaturalist_taxon_id)))
     LEFT JOIN inaturalist.taxa t ON ((t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id))))
     LEFT JOIN providers prov ON ((prov.id = o.provider_id)))
     LEFT JOIN collections col ON ((col.id = o.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)));

CREATE VIEW derived.orcasound_occurrences AS
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
    tx.certainty,
    b.id AS source_key
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
-- 3. The store. Its columns are public.occurrences' own, taken from the view so the types
--    cannot drift, plus which source a row came from and that source row's key as text.
--    Likewise the candidates, taken from the matview they replace.
-- ---------------------------------------------------------------------------
CREATE TABLE derived.occurrences AS
  SELECT o.*, NULL::text AS source, NULL::text AS source_key
  FROM public.occurrences o
  WITH NO DATA;
ALTER TABLE derived.occurrences
  ADD PRIMARY KEY (id),
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN source_key SET NOT NULL;
CREATE INDEX occurrences_source_key ON derived.occurrences (source, source_key);
-- The map's day query and occurrence_days, as occurrence_index_observed_at served them.
CREATE INDEX occurrences_observed_at ON derived.occurrences (observed_at);
-- fetchLastOwnOccurrence (src/occurrence.ts).
CREATE INDEX occurrences_contributor_id ON derived.occurrences (contributor_id)
  WHERE contributor_id IS NOT NULL;

CREATE TABLE derived.occurrence_identifier_candidates AS
  SELECT * FROM public.occurrence_identifier_candidates
  WITH NO DATA;
ALTER TABLE derived.occurrence_identifier_candidates ADD PRIMARY KEY (occurrence_id, code);
CREATE INDEX occurrence_identifier_candidates_individual_id
  ON derived.occurrence_identifier_candidates (individual_id);
CREATE INDEX occurrence_identifier_candidates_social_group_id
  ON derived.occurrence_identifier_candidates (social_group_id);

-- The candidates' derivation: the matview's text of 20260926120100, reading the store.
-- A filter on occurrence_id reaches the store's primary key, since it is a DISTINCT ON
-- column and Postgres pushes such quals below the DISTINCT.
CREATE VIEW derived.identifier_candidates AS
SELECT DISTINCT ON (o.id, ident.code) o.id AS occurrence_id,
  ident.code,
  d.individual_id,
  grp.id AS social_group_id,
  o.observed_at,
  o.location
FROM derived.occurrences o
CROSS JOIN LATERAL unnest(o.identifiers) ident(code)
LEFT JOIN public.social_groups grp
  ON ident.code::text ~ 's$' AND grp.kind = 'matriline'
 AND grp.designation_folded || 's' = register.fold(ident.code::text)
LEFT JOIN public.designations d
  ON ident.code::text !~ 's$' AND d.code_folded = register.fold(ident.code::text)
-- Bouts carry register identifiers, not text; see public.acoustic_identifications.
WHERE o.source <> 'orcasound';

-- Whether reference data has moved since the last rebuild: one row per statement that
-- moved it, stale while any row exists. Append-only, so a reference writer holds no lock
-- anyone else wants (a counter row was one, and it deadlocked against the rebuild). A
-- rebuild deletes only the marks it saw committed when it started, so a change that
-- commits while it runs is still marked when it finishes.
CREATE TABLE derived.stale_marks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  marked_at timestamptz NOT NULL DEFAULT now(),
  source_table text NOT NULL
);

-- When the store was last rebuilt in full; for the eyes of whoever is looking.
CREATE TABLE derived.rebuild_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  rebuilt_at timestamptz
);
INSERT INTO derived.rebuild_state DEFAULT VALUES;

-- ---------------------------------------------------------------------------
-- 4. Maintenance.
--
--    refresh_occurrences(source, keys) recomputes those keys of one source through its
--    view, upserts the rows that differ and deletes the ones the view no longer yields;
--    with no keys it does the whole source. Either way it writes only what changed, so an
--    ingest tick or a register reload that changed nothing writes nothing.
--
--    Each refresh computes from its own snapshot, so two refreshes of one occurrence
--    racing each other (two photos of one observation written at once; a rebuild and a
--    tick) could leave the older answer stored. A per-source advisory lock, exclusive and
--    held to commit, makes refreshes of one source take turns; the statement that
--    computes runs after the lock is granted, so it sees every refresh committed before
--    it. No transaction refreshes two sources, and the candidates lock is only ever taken
--    after a source lock or alone, so no cycle is possible.
-- ---------------------------------------------------------------------------
CREATE FUNCTION derived.refresh_identifier_candidates(p_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
-- The whole set is ~16k rows; keep it off the disk, as refresh_occurrences does.
SET work_mem = '32MB'
AS $$
BEGIN
  IF p_ids IS NOT NULL AND cardinality(p_ids) = 0 THEN
    RETURN;
  END IF;
  IF p_ids IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('derived.occurrence_identifier_candidates'));
  ELSE
    PERFORM pg_advisory_xact_lock_shared(hashtext('derived.occurrence_identifier_candidates'));
  END IF;

  -- The fresh set first, then both writes against it. An anti-join straight onto the view
  -- is planned over the whole view rather than the given ids: 220 ms for 20 sightings.
  -- Dynamic so the plan sees whether there are ids at all; a generic plan for "all, or
  -- these" would scan everything every time.
  EXECUTE format($q$
    WITH fresh AS MATERIALIZED (
      SELECT * FROM derived.identifier_candidates v %1$s
    ), gone AS (
      DELETE FROM derived.occurrence_identifier_candidates c
      WHERE NOT EXISTS (SELECT 1 FROM fresh f WHERE f.occurrence_id = c.occurrence_id AND f.code = c.code)
        %2$s
    )
    INSERT INTO derived.occurrence_identifier_candidates AS c
    SELECT * FROM fresh f
    WHERE NOT EXISTS (SELECT 1 FROM derived.occurrence_identifier_candidates s
                      WHERE s.occurrence_id = f.occurrence_id AND s.code = f.code
                        AND ROW(s.*) IS NOT DISTINCT FROM ROW(f.*))
    ON CONFLICT (occurrence_id, code) DO UPDATE SET
      individual_id = EXCLUDED.individual_id, social_group_id = EXCLUDED.social_group_id,
      observed_at = EXCLUDED.observed_at, location = EXCLUDED.location
    WHERE ROW(c.*) IS DISTINCT FROM ROW(EXCLUDED.*)
    $q$,
    CASE WHEN p_ids IS NULL THEN '' ELSE 'WHERE v.occurrence_id = ANY ($1)' END,
    CASE WHEN p_ids IS NULL THEN '' ELSE 'AND c.occurrence_id = ANY ($1)' END)
  USING p_ids;
END;
$$;

CREATE FUNCTION derived.refresh_occurrences(p_source text, p_keys text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
-- A whole-source refresh holds up to ~30k fresh rows at once. At 32 MB a full rebuild
-- still spills ~20 MB (measured on a restore of prod), a few times a day; at 64 MB it would
-- not, but several sort and hash nodes each entitled to that is too much to ask of 0.5 GB.
SET work_mem = '32MB'
AS $$
DECLARE
  key_type constant text := CASE p_source
    WHEN 'maplify' THEN 'integer'
    WHEN 'inaturalist' THEN 'bigint'
    WHEN 'happywhale' THEN 'integer'
    WHEN 'native' THEN 'uuid'
    WHEN 'orcasound' THEN 'text'
  END;
  cols text;
  fresh_row text;
  sets text;
  touched text[];
BEGIN
  IF key_type IS NULL THEN
    RAISE EXCEPTION 'derived.refresh_occurrences: unknown source %', p_source;
  END IF;
  IF p_keys IS NOT NULL AND cardinality(p_keys) = 0 THEN
    RETURN 0;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('derived.occurrences:' || p_source));

  -- The store's own columns, so a column added to the store and the five views needs no
  -- edit here. `fresh_row` is a fresh row as the store would hold it, in the store's
  -- column order, wherever `source` and `source_key` fall in it.
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
           FILTER (WHERE attname NOT IN ('source', 'source_key')),
         string_agg(CASE attname
                      WHEN 'source' THEN quote_literal(p_source) || '::text'
                      WHEN 'source_key' THEN 'f.source_key::text'
                      ELSE 'f.' || quote_ident(attname) END, ', ' ORDER BY attnum),
         string_agg(format('%1$I = EXCLUDED.%1$I', attname), ', ' ORDER BY attnum)
           FILTER (WHERE attname NOT IN ('source', 'source_key'))
    INTO cols, fresh_row, sets
    FROM pg_attribute
   WHERE attrelid = 'derived.occurrences'::regclass
     AND attnum > 0 AND NOT attisdropped;

  EXECUTE format($q$
    WITH fresh AS MATERIALIZED (
      SELECT * FROM derived.%1$I v %2$s
    ), gone AS (
      DELETE FROM derived.occurrences o
      WHERE o.source = %3$L %4$s
        AND NOT EXISTS (SELECT 1 FROM fresh f WHERE f.id = o.id)
      RETURNING o.id
    ), written AS (
      INSERT INTO derived.occurrences AS o (%5$s, source, source_key)
      SELECT %5$s, %3$L, f.source_key::text FROM fresh f
      -- Unchanged rows never reach ON CONFLICT: it locks every conflicting row, even one
      -- its WHERE then declines, and a rebuild would dirty every page of the table.
      WHERE NOT EXISTS (SELECT 1 FROM derived.occurrences s
                        WHERE s.id = f.id
                          AND ROW(s.*) IS NOT DISTINCT FROM ROW(%7$s))
      ON CONFLICT (id) DO UPDATE SET %6$s,
        source = EXCLUDED.source, source_key = EXCLUDED.source_key
      WHERE ROW(o.*) IS DISTINCT FROM ROW(EXCLUDED.*)
      RETURNING o.id
    )
    SELECT ARRAY(SELECT id FROM gone UNION ALL SELECT id FROM written)
    $q$,
    p_source || '_occurrences',
    CASE WHEN p_keys IS NULL THEN '' ELSE format('WHERE v.source_key = ANY ($1::%s[])', key_type) END,
    p_source,
    CASE WHEN p_keys IS NULL THEN '' ELSE 'AND o.source_key = ANY ($1)' END,
    cols,
    sets,
    fresh_row)
  INTO touched
  USING p_keys;

  -- Whatever changed here, its candidates follow, keyed or whole-source alike, so a
  -- migration that refreshes a source leaves nothing stale. A designation or group that
  -- changed without any occurrence changing is the rebuild's final pass's to see.
  PERFORM derived.refresh_identifier_candidates(touched);
  RETURN cardinality(touched);
END;
$$;

COMMENT ON FUNCTION derived.refresh_occurrences(text, text[]) IS
  'Recompute the stored occurrences of one source for the given source keys (all when NULL), '
  'writing only rows that differ (decision 055). Called by the source-table triggers and the rebuild.';

-- The whole store in the caller's transaction: what a migration that changes a derivation
-- calls, and what a test calls after seeding reference data. The cron job uses the
-- procedure below instead, which commits between sources.
CREATE FUNCTION derived.refresh_all()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Only the marks committed before the refresh began: one committed during it may be
  -- for a change the refresh did not see.
  seen bigint[] := ARRAY(SELECT id FROM derived.stale_marks);
  src text;
BEGIN
  FOREACH src IN ARRAY ARRAY['maplify', 'inaturalist', 'happywhale', 'orcasound', 'native'] LOOP
    PERFORM derived.refresh_occurrences(src);
  END LOOP;
  PERFORM derived.refresh_identifier_candidates(NULL);
  DELETE FROM derived.stale_marks WHERE id = ANY (seen);
  UPDATE derived.rebuild_state SET rebuilt_at = now();
END;
$$;

-- The whole store, one source per transaction so each exclusive lock is held only for its
-- own source: writers of our own sightings wait a third of a second, not ten. Invoker and
-- with no SET clause, because a procedure with either cannot COMMIT; hence every name is
-- qualified. `only_if_stale` is the five-minute job; a bare CALL rebuilds regardless.
CREATE PROCEDURE derived.rebuild_occurrences(only_if_stale boolean DEFAULT false)
LANGUAGE plpgsql
AS $$
DECLARE
  seen bigint[];
  src text;
BEGIN
  seen := ARRAY(SELECT m.id FROM derived.stale_marks m);
  IF only_if_stale AND pg_catalog.cardinality(seen) = 0 THEN
    RETURN;
  END IF;
  COMMIT;
  FOREACH src IN ARRAY ARRAY['maplify', 'inaturalist', 'happywhale', 'orcasound', 'native'] LOOP
    PERFORM derived.refresh_occurrences(src);
    COMMIT;
  END LOOP;
  PERFORM derived.refresh_identifier_candidates(NULL);
  COMMIT;
  -- Its own transaction, holding no advisory lock: only the marks seen at the start.
  DELETE FROM derived.stale_marks m WHERE m.id = ANY (seen);
  UPDATE derived.rebuild_state SET rebuilt_at = pg_catalog.now();
  COMMIT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Triggers. Statement-level, so a batch upsert is one set-based refresh rather than
--    one per row; with transition tables, which Postgres allows on one event per trigger,
--    hence three triggers a table. A guarded upsert that changed nothing still fires its
--    UPDATE trigger, with no rows, and that costs nothing.
-- ---------------------------------------------------------------------------
CREATE FUNCTION derived.occurrence_source_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  src constant text := TG_ARGV[0];
  keycol constant text := TG_ARGV[1];
  keys text[];
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    -- No transition table to read; the whole source is as cheap to redo as to reason about.
    PERFORM derived.refresh_occurrences(src);
    RETURN NULL;
  ELSIF TG_OP = 'INSERT' THEN
    EXECUTE format('SELECT array_agg(DISTINCT %I::text) FROM new_rows', keycol) INTO keys;
  ELSIF TG_OP = 'DELETE' THEN
    EXECUTE format('SELECT array_agg(DISTINCT %I::text) FROM old_rows', keycol) INTO keys;
  ELSE
    -- Both sides: a photo moved between observations changes two occurrences.
    EXECUTE format('SELECT array_agg(DISTINCT k) FROM (SELECT %1$I::text AS k FROM old_rows '
                   'UNION SELECT %1$I::text FROM new_rows) x', keycol) INTO keys;
  END IF;
  IF keys IS NOT NULL THEN
    PERFORM derived.refresh_occurrences(src, keys);
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('maplify.sightings',                'maplify',     'id'),
    ('inaturalist.observations',         'inaturalist', 'id'),
    ('inaturalist.observation_photos',   'inaturalist', 'observation_id'),
    ('public.observations',              'native',      'id'),
    ('public.observation_photos',        'native',      'observation_id'),
    ('public.acoustic_bouts',            'orcasound',   'id'),
    ('public.acoustic_bout_entities',    'orcasound',   'bout_id')
  ) AS v(tbl, src, keycol) LOOP
    EXECUTE format('CREATE TRIGGER derived_occurrences_after_insert AFTER INSERT ON %s '
                   'REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT '
                   'EXECUTE FUNCTION derived.occurrence_source_changed(%L, %L)', t.tbl, t.src, t.keycol);
    EXECUTE format('CREATE TRIGGER derived_occurrences_after_update AFTER UPDATE ON %s '
                   'REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT '
                   'EXECUTE FUNCTION derived.occurrence_source_changed(%L, %L)', t.tbl, t.src, t.keycol);
    EXECUTE format('CREATE TRIGGER derived_occurrences_after_delete AFTER DELETE ON %s '
                   'REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT '
                   'EXECUTE FUNCTION derived.occurrence_source_changed(%L, %L)', t.tbl, t.src, t.keycol);
    EXECUTE format('CREATE TRIGGER derived_occurrences_after_truncate AFTER TRUNCATE ON %s '
                   'FOR EACH STATEMENT '
                   'EXECUTE FUNCTION derived.occurrence_source_changed(%L, %L)', t.tbl, t.src, t.keycol);
  END LOOP;
END;
$$;

-- A contributor's name is the attribution and observer of their own sightings. Only an
-- UPDATE can change an existing occurrence; a new contributor has none yet.
CREATE FUNCTION derived.contributor_renamed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  keys text[];
BEGIN
  SELECT array_agg(o.id::text) INTO keys
  FROM new_rows n
  JOIN old_rows p ON p.id = n.id
  JOIN public.observations o ON o.contributor_id = n.id
  WHERE n.name IS DISTINCT FROM p.name;
  IF keys IS NOT NULL THEN
    PERFORM derived.refresh_occurrences('native', keys);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER derived_occurrences_after_update AFTER UPDATE ON public.contributors
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION derived.contributor_renamed();

-- Reference data: tables that change what many occurrences say at once, and rarely. A
-- statement that changed rows marks the store stale; the five-minute job rebuilds it. An
-- upsert that changed nothing (the iNaturalist ingest's taxa, every tick) marks nothing.
-- The register is watched through register.edition, which every load writes in the same
-- transaction as its tables.
CREATE FUNCTION derived.mark_stale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed boolean;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    changed := true;
  ELSIF TG_OP = 'DELETE' THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM old_rows)' INTO changed;
  ELSE
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM new_rows)' INTO changed;
  END IF;
  IF changed THEN
    INSERT INTO derived.stale_marks (source_table) VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME);
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'register.edition', 'inaturalist.taxa',
    'public.providers', 'public.collections', 'public.organizations',
    'public.social_groups', 'public.designations',
    'happywhale.encounters', 'happywhale.media', 'happywhale.users',
    'happywhale.individuals', 'happywhale.species'
  ] LOOP
    EXECUTE format('CREATE TRIGGER derived_occurrences_stale_after_insert AFTER INSERT ON %s '
                   'REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT '
                   'EXECUTE FUNCTION derived.mark_stale()', tbl);
    EXECUTE format('CREATE TRIGGER derived_occurrences_stale_after_update AFTER UPDATE ON %s '
                   'REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT '
                   'EXECUTE FUNCTION derived.mark_stale()', tbl);
    EXECUTE format('CREATE TRIGGER derived_occurrences_stale_after_delete AFTER DELETE ON %s '
                   'REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT '
                   'EXECUTE FUNCTION derived.mark_stale()', tbl);
    EXECUTE format('CREATE TRIGGER derived_occurrences_stale_after_truncate AFTER TRUNCATE ON %s '
                   'FOR EACH STATEMENT EXECUTE FUNCTION derived.mark_stale()', tbl);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Nothing in `derived` is anyone's but its owner's. Prod grants anon everything on a
--    new relation by default; refuse it here too.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA derived FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA derived FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA derived FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Fill the store, then cut over. The matviews' jobs go first so neither runs against a
--    half-built world; dropping the candidates matview takes its five dependants with it.
-- ---------------------------------------------------------------------------
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN ('refresh-occurrence-index', 'refresh-identifier-candidates');

-- One statement per source, so no one statement carries the whole fill.
SELECT derived.refresh_occurrences('maplify');
SELECT derived.refresh_occurrences('inaturalist');
SELECT derived.refresh_occurrences('happywhale');
SELECT derived.refresh_occurrences('orcasound');
SELECT derived.refresh_occurrences('native');
SELECT derived.refresh_identifier_candidates(NULL);
-- The triggers that write marks are this migration's, not yet committed, so every mark
-- here is this transaction's own.
DELETE FROM derived.stale_marks;
UPDATE derived.rebuild_state SET rebuilt_at = now();

DROP MATERIALIZED VIEW public.occurrence_identifier_candidates CASCADE;
DROP MATERIALIZED VIEW public.occurrence_index CASCADE;

-- Same name, columns and types; now a projection of the store.
CREATE OR REPLACE VIEW public.occurrences AS
SELECT id, url, attribution, body, count, direction, location, accuracy, photos,
  observed_at, observed_from, taxon, identifiers, contributor_id, observer, collection,
  source_url, organization, organization_url, provider, provider_slug, observed_until,
  certainty
FROM derived.occurrences;

-- ---------------------------------------------------------------------------
-- 8. The five dependants, as 20260926120100 wrote them, reading the store: the text
--    candidates from derived.occurrence_identifier_candidates, and place and time from
--    derived.occurrences where they joined occurrence_index.
-- ---------------------------------------------------------------------------
CREATE VIEW public.occurrence_unresolved_codes AS
SELECT occurrence_id, code
FROM derived.occurrence_identifier_candidates c
WHERE individual_id IS NULL AND social_group_id IS NULL;

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
FROM derived.occurrence_identifier_candidates c
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
JOIN derived.occurrences o ON o.id = s.occurrence_id
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
FROM derived.occurrence_identifier_candidates c
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
JOIN derived.occurrences o ON o.id = a.occurrence_id
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
JOIN derived.occurrences o ON o.id = s.occurrence_id
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
FROM derived.occurrence_identifier_candidates c
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
JOIN derived.occurrences o ON o.id = a.occurrence_id
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
FROM derived.occurrence_identifier_candidates c
JOIN group_to_ecotype gte ON gte.group_id = c.social_group_id
WHERE c.social_group_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = c.occurrence_id AND s.social_group_id = c.social_group_id)
UNION
SELECT ite.ecotype_id, c.occurrence_id, c.observed_at, c.location,
  true AS is_present, 'candidate'::public.identification_status AS status,
  NULL::public.identification_certainty AS certainty
FROM derived.occurrence_identifier_candidates c
JOIN individual_to_ecotype ite ON ite.individual_id = c.individual_id
WHERE c.individual_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = c.occurrence_id AND s.individual_id = c.individual_id)
UNION
SELECT gte.ecotype_id, a.occurrence_id, o.observed_at, o.location,
  true AS is_present, 'candidate'::public.identification_status AS status, a.certainty
FROM public.acoustic_identifications a
JOIN derived.occurrences o ON o.id = a.occurrence_id
JOIN group_to_ecotype gte ON gte.group_id = a.social_group_id
WHERE a.social_group_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = a.occurrence_id AND s.social_group_id = a.social_group_id)
UNION
SELECT ite.ecotype_id, a.occurrence_id, o.observed_at, o.location,
  true AS is_present, 'candidate'::public.identification_status AS status, a.certainty
FROM public.acoustic_identifications a
JOIN derived.occurrences o ON o.id = a.occurrence_id
JOIN individual_to_ecotype ite ON ite.individual_id = a.individual_id
WHERE a.individual_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = a.occurrence_id AND s.individual_id = a.individual_id)
UNION
SELECT gte.ecotype_id, s.occurrence_id, o.observed_at, o.location, s.is_present, s.status, s.certainty
FROM public.identifications s
JOIN derived.occurrences o ON o.id = s.occurrence_id
JOIN group_to_ecotype gte ON gte.group_id = s.social_group_id
WHERE s.social_group_id IS NOT NULL
UNION
SELECT ite.ecotype_id, s.occurrence_id, o.observed_at, o.location, s.is_present, s.status, s.certainty
FROM public.identifications s
JOIN derived.occurrences o ON o.id = s.occurrence_id
JOIN individual_to_ecotype ite ON ite.individual_id = s.individual_id
WHERE s.individual_id IS NOT NULL;

-- The five views were readable before the drop; they are again, and nothing more
-- (supabase/read-grants.test.ts pins the set).
REVOKE ALL ON public.occurrence_unresolved_codes, public.occurrence_identifications,
  public.group_occurrences, public.individual_occurrences, public.ecotype_occurrences
  FROM anon, authenticated;
GRANT SELECT ON public.occurrence_unresolved_codes, public.occurrence_identifications,
  public.group_occurrences, public.individual_occurrences, public.ecotype_occurrences
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. occurrence_days reads one relation. Its split at 48 hours existed only because
--    occurrence_index lagged the view by up to five minutes; the store does not lag.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.occurrence_days(
  from_day date, to_day date,
  min_lon double precision DEFAULT NULL, min_lat double precision DEFAULT NULL,
  max_lon double precision DEFAULT NULL, max_lat double precision DEFAULT NULL)
RETURNS TABLE(day date, occurrence_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    (o.observed_at AT TIME ZONE 'PST8PDT')::date AS day,
    count(*)::int AS occurrence_count
  FROM derived.occurrences o
  WHERE o.observed_at >= (from_day::timestamp AT TIME ZONE 'PST8PDT')
    AND o.observed_at <  ((to_day + 1)::timestamp AT TIME ZONE 'PST8PDT')
    AND (o.location).lon BETWEEN COALESCE(min_lon, -180) AND COALESCE(max_lon, 180)
    AND (o.location).lat BETWEEN COALESCE(min_lat,  -90) AND COALESCE(max_lat,  90)
  GROUP BY 1;
$function$;

-- ---------------------------------------------------------------------------
-- 10. A contributor is minted once per fetched iNaturalist observation per tick, and the
--     upsert rewrote the row every time, orcid or not: 4M updates in thirty days on 17k
--     rows. Now only an orcid we did not have is written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inaturalist.mint_contributor(inat_login text, orcid text DEFAULT NULL::text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  INSERT INTO public.contributors (name, inat_login, orcid)
  VALUES (inat_login, inat_login, orcid)
  ON CONFLICT (inat_login) DO UPDATE
    SET orcid = EXCLUDED.orcid
    WHERE EXCLUDED.orcid IS NOT NULL
      AND public.contributors.orcid IS DISTINCT FROM EXCLUDED.orcid;
  SELECT id FROM public.contributors WHERE contributors.inat_login = $1;
$function$;

-- ---------------------------------------------------------------------------
-- 11. The rebuild's clock: a no-op unless reference data moved since the last one.
-- ---------------------------------------------------------------------------
-- Offset from the three ingest jobs at :00, so a rebuild and a tick are not both
-- starting on the same second.
SELECT cron.schedule('rebuild-occurrences-if-stale', '2-59/5 * * * *',
  $$CALL derived.rebuild_occurrences(only_if_stale => true)$$);

RESET statement_timeout;
