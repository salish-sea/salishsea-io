-- Orcasound bouts on the map (salish-8vr.26; decision 013 as amended 2026-09-20; decision 053).
--
-- public.acoustic_bouts and public.acoustic_bout_entities have existed since 20260920210000
-- with nothing filling them and nothing reading them. This migration is the rest: the
-- `orcasound` ingest source, and a fifth branch of public.occurrences.
--
-- THE BRANCH. An occurrence has one taxon, and a bout may cite entities under more than one
-- species — `SRKW`, `J` and `humpback` on one bout is two animals' worth of sound. So a
-- bout becomes ONE OCCURRENCE PER SPECIES ITS TAGS REACH, each carrying the cited entities
-- under that species as its identifiers (053). The id is `orcasound:<bout>:<taxon entity>`.
-- A bout citing nothing the register can place — no animal tag at all, or only a split
-- deprecation — is held in acoustic_bouts and shown nowhere, which is the provisional
-- answer to salish-8vr.4: a record cannot go on a map without a taxon, and 013's warning
-- stands that the absence of tags is not the absence of animals.
--
-- The taxon is register.taxon_for (20260921010000), which stops at the species and walks
-- past the ecotype; which whales is the identifiers' job, and those are the register's
-- labels for the cited groups and individuals (`J`, `T037s`), never the species itself.
--
-- Bouts stay out of the DarwinCore export (013 §3 of the 2026-09-20 amendment): the
-- dwc.* views read their source tables directly, so nothing here reaches the archive.
--
-- NOT A WINDOWED SOURCE. The other two sources reconcile a ten-day window every five
-- minutes; this one reconciles the whole corpus, a few hundred bouts and one request.
-- ingest.runs still records the run's default window because the columns are NOT NULL;
-- for this source it is not a bound on anything.

-- ---------------------------------------------------------------------------
-- 1. ingest.runs accepts the source. scripts/ingest/heartbeat.ts SOURCES mirrors this list.
-- ---------------------------------------------------------------------------
ALTER TABLE ingest.runs DROP CONSTRAINT runs_source_check;
ALTER TABLE ingest.runs ADD CONSTRAINT runs_source_check
  CHECK (source IN ('maplify', 'inaturalist', 'orcasound'));

-- ---------------------------------------------------------------------------
-- 2. The least-privilege ingest role (20260706130000) reaches exactly what
--    scripts/ingest/persist.ts persistOrcasound touches. Every table here has RLS on,
--    so each needs a policy as well as a grant — the taxa mirror's precedent.
--    providers and collections are read for the two ids the bout row carries.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.acoustic_bouts, public.acoustic_bout_entities TO ingest;
GRANT SELECT ON public.providers, public.collections TO ingest;

CREATE POLICY "Ingest worker may maintain acoustic bouts."
  ON public.acoustic_bouts FOR ALL TO ingest USING (true) WITH CHECK (true);
CREATE POLICY "Ingest worker may maintain acoustic bout entities."
  ON public.acoustic_bout_entities FOR ALL TO ingest USING (true) WITH CHECK (true);
CREATE POLICY "Ingest worker may read providers."
  ON public.providers FOR SELECT TO ingest USING (true);
CREATE POLICY "Ingest worker may read collections."
  ON public.collections FOR SELECT TO ingest USING (true);

-- ---------------------------------------------------------------------------
-- 3. An open map refetches when a bout or its identity changes (20260910120000).
--    Both tables: a tag gaining an identifier upstream changes entities and no bout.
-- ---------------------------------------------------------------------------
CREATE TRIGGER occurrences_changed_after_acoustic_bouts
  AFTER INSERT OR UPDATE OR DELETE ON public.acoustic_bouts
  FOR EACH ROW EXECUTE FUNCTION public.notify_occurrences_changed();
CREATE TRIGGER occurrences_changed_after_acoustic_bout_entities
  AFTER INSERT OR UPDATE OR DELETE ON public.acoustic_bout_entities
  FOR EACH ROW EXECUTE FUNCTION public.notify_occurrences_changed();

-- ---------------------------------------------------------------------------
-- 4. Scheduled like the others (20260706000000): every five minutes, a no-op where the
--    Vault holds no function URL (local, CI).
-- ---------------------------------------------------------------------------
SELECT cron.schedule('ingest-orcasound', '*/5 * * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ingest_function_url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-ingest-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ingest_trigger_secret')
    ),
    body := jsonb_build_object('source', 'orcasound', 'trigger', 'cron'),
    timeout_milliseconds := 60000
  )
  WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'ingest_function_url');
$job$);

-- ---------------------------------------------------------------------------
-- 5. The view. The four existing branches are the text of 20260922060000, unchanged;
--    CREATE OR REPLACE keeps every dependant (occurrence_index, the identifier candidates,
--    the haul-out view) in place. The fifth branch follows.
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
    NULL::timestamp with time zone AS observed_until
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
    b.ended_at AS observed_until
   FROM ((((acoustic_bouts b
     CROSS JOIN LATERAL ( SELECT register.taxon_entity_for(e.entity_id) AS taxon_entity_id,
            array_agg(DISTINCT (ent.label)::character varying ORDER BY (ent.label)::character varying)
              FILTER (WHERE (ent.kind <> 'taxon'::text)) AS identifiers
           FROM (acoustic_bout_entities e
             JOIN register.entities ent ON ((ent.entity_id = e.entity_id)))
          WHERE (e.bout_id = b.id)
          GROUP BY (register.taxon_entity_for(e.entity_id))) tx)
     LEFT JOIN providers prov ON ((prov.id = b.provider_id)))
     LEFT JOIN collections col ON ((col.id = b.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)))
  WHERE (tx.taxon_entity_id IS NOT NULL);
