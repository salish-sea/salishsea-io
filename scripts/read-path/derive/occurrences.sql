-- The occurrences, derived in the build (decision 061, salish-xv35.2): DuckDB twins of the
-- five per-source views behind Postgres's derived.occurrences
-- (supabase/migrations/20260928120000_occurrences_stored.sql), and of the register
-- functions and views they call, reading the snapshot's typed copies of the same tables.
--
-- Twins, not improvements. Each piece below names the Postgres object it ports, and
-- keeps its quirks, because the result is checked against the stored occurrences row
-- for row (compare-occurrences.ts). A fix goes into both, together.
--
-- Run by derive-occurrences.ts, which first sets TimeZone to UTC, loads ICU (text sorts
-- as Postgres's en-US ICU collation does: COLLATE en_us — verified on production
-- 2026-10-04, pg_database says datlocprovider 'i', datcollate en_US.UTF-8, so a tie
-- like 'J pod' before 'J27' orders the same on both sides; salish-xv35.20), runs
-- derive/shared.sql and
-- derive/lookups.sql (the register's and iNaturalist's lookups, and Maplify's collection
-- rule, which the Darwin Core export reads too), writes
-- memory.maplify_entity (each Maplify name pair's register entity, and with it
-- memory.maplify_out_of_scope, derive/maplify-entities.ts) and
-- memory.inaturalist_out_of_scope (derive/inaturalist-scope.ts), and writes memory.extracted:
-- what extract_travel_direction and extract_identifiers answer for each source's text,
-- computed in JavaScript because RE2 can't express their patterns (derive/extract.ts).
-- Where a Postgres view calls one of them, the twin here joins that table.

-- --- The five sources --------------------------------------------------------------------
-- Each the same columns as public.occurrences, in its order; the document is built from
-- them at the end. `location` is never NULL: Postgres builds it as ROW(st_x, st_y), which
-- is a composite of NULLs, not a NULL, when the geography is missing. Its doubles are
-- exact here; the document rounds them (pg_lon_lat).

-- derived.maplify_occurrences. Its entity and collection are resolved here, not read from
-- the mirror: the entity by the ingest's own resolveEntity, run first over each distinct
-- (name, scientific name) pair into memory.maplify_entity (derive/maplify-entities.ts),
-- and the collection by maplify_collection (derive/lookups.sql).
CREATE OR REPLACE TEMP VIEW maplify_occurrences AS
  SELECT 'maplify:' || s.id AS id,
         CAST(NULL AS VARCHAR) AS url,
         s.usernm || ' on ' || s.source AS attribution,
         s.comments AS body,
         CASE WHEN s.number_sighted >= 1 AND s.number_sighted <= 1000 THEN s.number_sighted END AS count,
         xt.direction,
         {'lat': s.location_lat, 'lon': s.location_lon} AS location,
         CAST(NULL AS INTEGER) AS accuracy,
         CASE WHEN s.photo_url IS NOT NULL
              THEN [{'src': s.photo_url, 'thumb': CAST(NULL AS VARCHAR), 'license': CAST(NULL AS VARCHAR),
                     'mimetype': CAST(NULL AS VARCHAR), 'attribution': CAST(NULL AS VARCHAR)}]
              ELSE [] END AS photos,
         timezone('UTC', s.created_at) AS observed_at,
         CAST(NULL AS STRUCT(lat DOUBLE, lon DOUBLE)) AS observed_from,
         {'entity_id': me.entity_id,
          'species_id': t.species_id,
          'scientific_name': coalesce(t.scientific_name, s.scientific_name),
          'vernacular_name': coalesce(cn.name, t.vernacular_name)} AS taxon,
         coalesce(xt.identifiers, []) AS identifiers,
         CAST(NULL AS INTEGER) AS contributor_id,
         CAST(NULL AS VARCHAR) AS observer,
         col.name AS collection,
         s.source_url,
         org.name AS organization,
         org.url AS organization_url,
         prov.name AS provider,
         prov.slug AS provider_slug,
         CAST(NULL AS TIMESTAMPTZ) AS observed_until,
         CAST(NULL AS VARCHAR) AS certainty
  FROM source_maplify_sightings s
  LEFT JOIN memory.extracted xt ON xt.source = 'maplify' AND xt.key = CAST(s.id AS VARCHAR)
  LEFT JOIN memory.maplify_entity me
    ON me.name IS NOT DISTINCT FROM s.name AND me.scientific_name = s.scientific_name
  LEFT JOIN maplify_collection mc ON mc.id = s.id
  LEFT JOIN inaturalist_taxon xw ON xw.entity_id = me.entity_id
  LEFT JOIN taxa t_recorded ON t_recorded.id = xw.inaturalist_taxon_id
  LEFT JOIN taxa t ON t.id = coalesce(t_recorded.current_taxon_id, t_recorded.id)
  LEFT JOIN entity_common_name cn ON cn.entity_id = me.entity_id
  LEFT JOIN public.providers prov ON prov.id = s.provider_id
  LEFT JOIN public.collections col ON col.id = mc.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id
  WHERE NOT s.is_test AND me.entity_id IS NOT NULL
    -- Out of the map's scope by the ingest's isIngestable, decided in the build because
    -- the mirror keeps all Maplify returned (salish-xv35.7). Against Postgres's store,
    -- which the ingest already filtered, nothing is: 0 of 28,611 on 2026-10-02.
    AND s.id NOT IN (SELECT id FROM memory.maplify_out_of_scope);

-- derived.inaturalist_occurrences
CREATE OR REPLACE TEMP VIEW inaturalist_occurrences AS
  SELECT 'inaturalist:' || o.id AS id,
         o.uri AS url,
         o.username || ' on iNaturalist' AS attribution,
         o.description AS body,
         CAST(NULL AS INTEGER) AS count,
         xt.direction,
         {'lat': o.location_lat, 'lon': o.location_lon} AS location,
         o.public_positional_accuracy AS accuracy,
         coalesce((
           SELECT list({'src': p.url, 'thumb': CAST(NULL AS VARCHAR), 'license': p.license,
                        'mimetype': CAST(NULL AS VARCHAR), 'attribution': p.attribution} ORDER BY p.seq)
           FROM source_inaturalist_observation_photos p
           WHERE p.observation_id = o.id AND NOT p.hidden AND p.license IS NOT NULL
         ), []) AS photos,
         o.observed_at,
         CAST(NULL AS STRUCT(lat DOUBLE, lon DOUBLE)) AS observed_from,
         {'entity_id': coalesce(reg.entity_id, par.entity_id),
          'species_id': t.species_id,
          'scientific_name': t.scientific_name,
          'vernacular_name': coalesce(reg.common_name, par.common_name, t.vernacular_name)} AS taxon,
         coalesce(xt.identifiers, []) AS identifiers,
         CAST(NULL AS INTEGER) AS contributor_id,
         o.username AS observer,
         col.name AS collection,
         o.source_url,
         org.name AS organization,
         org.url AS organization_url,
         prov.name AS provider,
         prov.slug AS provider_slug,
         CAST(NULL AS TIMESTAMPTZ) AS observed_until,
         CAST(NULL AS VARCHAR) AS certainty
  FROM source_inaturalist_observations o
  LEFT JOIN memory.extracted xt ON xt.source = 'inaturalist' AND xt.key = CAST(o.id AS VARCHAR)
  JOIN taxa t_recorded ON o.taxon_id = t_recorded.id
  JOIN taxa t ON t.id = coalesce(t_recorded.current_taxon_id, t_recorded.id)
  LEFT JOIN inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
  LEFT JOIN inaturalist_taxon_name par
    ON par.inat_taxon_id = t.parent_id AND t.rank = 'subspecies'
   AND t.scientific_name NOT LIKE 'Orcinus orca %' AND t.scientific_name NOT LIKE 'Delphinus delphis %'
  LEFT JOIN public.providers prov ON prov.id = o.provider_id
  LEFT JOIN public.collections col ON col.id = o.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id
  -- Out of the map's scope by the ingest's isIngestable, decided in the build because the
  -- mirror keeps the whole fetch box (salish-xv35.8, derive/inaturalist-scope.ts).
  WHERE o.id NOT IN (SELECT id FROM memory.inaturalist_out_of_scope);

-- derived.happywhale_instant(local_time, zone): an encounter's local date and time as an
-- instant. Happywhale's zone is an IANA name, 'Z', or a bare ISO 8601 offset like
-- '-07:00', which is subtracted: 13:01 at -07:00 is 20:01Z. (Postgres once read those
-- offsets with POSIX's reversed sign, putting 582 sightings on the wrong day: salish-tyse.)
CREATE OR REPLACE TEMP MACRO happywhale_instant(local_time, zone) AS
  CASE
    WHEN zone = 'Z' THEN timezone('UTC', local_time)
    WHEN regexp_full_match(zone, '[+-][0-9]{2}:[0-9]{2}') THEN
      timezone('UTC', local_time
        - (CASE WHEN zone[1] = '-' THEN -1 ELSE 1 END)
          * (CAST(zone[2:3] AS INTEGER) * INTERVAL 1 HOUR + CAST(zone[5:6] AS INTEGER) * INTERVAL 1 MINUTE))
    ELSE timezone(zone, local_time)
  END;

-- derived.happywhale_occurrences
CREATE OR REPLACE TEMP VIEW happywhale_occurrences AS
  SELECT 'happywhale:' || e.id AS id,
         'https://happywhale.com/individual/' || e.individual_id || ';enc=' || e.id AS url,
         coalesce(u.display_name, 'a user') || ' on HappyWhale' AS attribution,
         concat_ws(chr(10) || chr(10),
           '[' || i.primary_id || '](' || 'https://happywhale.com/individual/' || e.individual_id || ')'
             || CASE i.sex WHEN 'male' THEN '♂' WHEN 'female' THEN '♀' ELSE '' END,
           '📍 ' || e.verbatim_location,
           e.comments) AS body,
         e.min_count AS count,
         xt.direction,
         {'lat': e.location_lat, 'lon': e.location_lon} AS location,
         CASE e.accuracy WHEN 'GENERAL' THEN 161 WHEN 'APPROX' THEN 16 ELSE 2 END AS accuracy,
         coalesce((
           SELECT list({'src': m.url, 'thumb': m.thumb_url, 'license': CAST(NULL AS VARCHAR),
                        'mimetype': m.mimetype, 'attribution': mu.display_name} ORDER BY m.id)
           FROM happywhale.media m
           LEFT JOIN happywhale.users mu ON m.user_id = mu.id
           WHERE m.public AND m.encounter_id = e.id
             AND (m.license_level LIKE 'CC_%' OR m.license_level = 'PUBLIC_DOMAIN')
         ), []) AS photos,
         happywhale_instant(e.start_date + coalesce(e.start_time, TIME '12:00:00'), e.timezone) AS observed_at,
         CAST(NULL AS STRUCT(lat DOUBLE, lon DOUBLE)) AS observed_from,
         {'entity_id': coalesce(reg.entity_id, par.entity_id),
          'species_id': t.species_id,
          'scientific_name': coalesce(t.scientific_name, s.scientific),
          'vernacular_name': coalesce(reg.common_name, par.common_name, t.vernacular_name, s.name)} AS taxon,
         coalesce(xt.identifiers, []) AS identifiers,
         CAST(NULL AS INTEGER) AS contributor_id,
         u.display_name AS observer,
         col.name AS collection,
         e.source_url,
         org.name AS organization,
         org.url AS organization_url,
         prov.name AS provider,
         prov.slug AS provider_slug,
         CASE WHEN e.end_time > e.start_time
              THEN happywhale_instant(e.start_date + e.end_time, e.timezone) END AS observed_until,
         CAST(NULL AS VARCHAR) AS certainty
  FROM happywhale.encounters e
  LEFT JOIN memory.extracted xt ON xt.source = 'happywhale' AND xt.key = CAST(e.id AS VARCHAR)
  LEFT JOIN happywhale.users u ON e.user_id = u.id
  JOIN happywhale.individuals i ON e.individual_id = i.id
  JOIN happywhale.species s ON e.species_id = s.id
  LEFT JOIN taxa t_recorded ON s.scientific = t_recorded.scientific_name
  LEFT JOIN taxa t ON t.id = coalesce(t_recorded.current_taxon_id, t_recorded.id)
  LEFT JOIN inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
  LEFT JOIN inaturalist_taxon_name par
    ON par.inat_taxon_id = t.parent_id AND t.rank = 'subspecies'
   AND t.scientific_name NOT LIKE 'Orcinus orca %' AND t.scientific_name NOT LIKE 'Delphinus delphis %'
  LEFT JOIN public.providers prov ON prov.id = e.provider_id
  LEFT JOIN public.collections col ON col.id = e.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id
  WHERE e.public;

-- derived.native_occurrences: what our own contributors reported.
CREATE OR REPLACE TEMP VIEW native_occurrences AS
  SELECT CAST(o.id AS VARCHAR) AS id,
         o.url,
         con.name || ' on SalishSea.io' AS attribution,
         o.body,
         o.count,
         o.direction,
         {'lat': o.subject_location_lat, 'lon': o.subject_location_lon} AS location,
         CAST(NULL AS INTEGER) AS accuracy,
         coalesce((
           SELECT list({'src': p.href, 'thumb': CAST(NULL AS VARCHAR), 'license': p.license_code,
                        'mimetype': CAST(NULL AS VARCHAR), 'attribution': 'someone'} ORDER BY p.seq)
           FROM public.observation_photos p WHERE p.observation_id = o.id
         ), []) AS photos,
         o.observed_at,
         CASE WHEN o.observer_location_lon IS NOT NULL OR o.observer_location_lat IS NOT NULL
              THEN {'lat': o.observer_location_lat, 'lon': o.observer_location_lon} END AS observed_from,
         {'entity_id': o.entity_id,
          'species_id': t.species_id,
          'scientific_name': t.scientific_name,
          'vernacular_name': coalesce(cn.name, t.vernacular_name)} AS taxon,
         coalesce(xt.identifiers, []) AS identifiers,
         o.contributor_id,
         con.name AS observer,
         col.name AS collection,
         o.source_url,
         org.name AS organization,
         org.url AS organization_url,
         prov.name AS provider,
         prov.slug AS provider_slug,
         CAST(NULL AS TIMESTAMPTZ) AS observed_until,
         CAST(NULL AS VARCHAR) AS certainty
  FROM public.observations o
  LEFT JOIN memory.extracted xt ON xt.source = 'native' AND xt.key = CAST(o.id AS VARCHAR)
  JOIN public.contributors con ON con.id = o.contributor_id
  LEFT JOIN inaturalist_taxon xw ON xw.entity_id = o.entity_id
  LEFT JOIN taxa t_recorded ON t_recorded.id = xw.inaturalist_taxon_id
  LEFT JOIN taxa t ON t.id = coalesce(t_recorded.current_taxon_id, t_recorded.id)
  LEFT JOIN entity_common_name cn ON cn.entity_id = o.entity_id
  LEFT JOIN public.providers prov ON prov.id = o.provider_id
  LEFT JOIN public.collections col ON col.id = o.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id;

-- derived.orcasound_occurrences: one occurrence per bout per species the moderators'
-- tags reach. A species' identifiers are its tags' labels below the species, a
-- 'possible' one marked with '?' (decision 054); its certainty is the strongest claim
-- reaching it, where an unhedged claim (NULL) counts as strongest.
CREATE OR REPLACE TEMP VIEW orcasound_occurrences AS
  WITH claim AS (
    SELECT e.bout_id,
           te.taxon_entity_id,
           e.certainty,
           cp.position AS certainty_position,
           ent.kind,
           ent.label || CASE WHEN e.certainty = 'possible' THEN '?' ELSE '' END AS label
    FROM source_acoustic_bout_entities e
    JOIN register.entities ent ON ent.entity_id = e.entity_id
    LEFT JOIN taxon_entity te ON te.entity_id = e.entity_id
    LEFT JOIN certainty_position cp ON cp.certainty = e.certainty
  ),
  per_species AS (
    SELECT bout_id, taxon_entity_id,
           list(DISTINCT label ORDER BY label COLLATE en_us) FILTER (WHERE kind <> 'taxon') AS identifiers,
           list(certainty ORDER BY certainty_position DESC NULLS FIRST)[1] AS certainty
    FROM claim
    GROUP BY bout_id, taxon_entity_id
  )
  SELECT 'orcasound:' || b.id || ':' || tx.taxon_entity_id AS id,
         'https://live.orcasound.net/bouts/' || b.id AS url,
         'Orcasound moderators at ' || b.feed_name AS attribution,
         b.title AS body,
         CAST(NULL AS INTEGER) AS count,
         CAST(NULL AS VARCHAR) AS direction,
         {'lat': b.location_lat, 'lon': b.location_lon} AS location,
         CAST(NULL AS INTEGER) AS accuracy,
         CAST([] AS STRUCT(src VARCHAR, thumb VARCHAR, license VARCHAR, mimetype VARCHAR, attribution VARCHAR)[]) AS photos,
         b.started_at AS observed_at,
         CAST(NULL AS STRUCT(lat DOUBLE, lon DOUBLE)) AS observed_from,
         CASE WHEN tf.entity_id IS NOT NULL THEN
           {'entity_id': tf.entity_id,
            'species_id': tf.species_id,
            'scientific_name': tf.scientific_name,
            'vernacular_name': tf.vernacular_name} END AS taxon,
         coalesce(tx.identifiers, []) AS identifiers,
         CAST(NULL AS INTEGER) AS contributor_id,
         CAST(NULL AS VARCHAR) AS observer,
         col.name AS collection,
         'https://live.orcasound.net/bouts/' || b.id AS source_url,
         org.name AS organization,
         org.url AS organization_url,
         prov.name AS provider,
         prov.slug AS provider_slug,
         b.ended_at AS observed_until,
         tx.certainty
  FROM source_acoustic_bouts b
  JOIN per_species tx ON tx.bout_id = b.id
  LEFT JOIN taxon_for tf ON tf.entity_id = tx.taxon_entity_id
  LEFT JOIN public.providers prov ON prov.id = b.provider_id
  LEFT JOIN public.collections col ON col.id = b.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id
  WHERE tx.taxon_entity_id IS NOT NULL;

-- --- The store ---------------------------------------------------------------------------
-- As snapshot.occurrences holds Postgres's: id, observed_at, and the document; and, as
-- derived.occurrences holds them, the source, the identifiers and the exact location,
-- which the identifier candidates read (derive/identifier-candidates.sql). The
-- document's keys are in jsonb's order (shorter keys first, then bytewise), which is the
-- order Postgres stores them in, so the files built from it keep their key order.
-- One source at a time rather than one UNION ALL, so only one source's joins and photo
-- lists are held at once: on the 1 GB Fly machine that is the difference between fitting
-- DuckDB in 128 MB and needing 256.
CREATE SCHEMA IF NOT EXISTS build;
CREATE OR REPLACE TEMP MACRO occurrence_doc(o) AS CAST(to_json({
           'id': o.id,
           'url': o.url,
           'body': o.body,
           'count': o.count,
           'taxon': o.taxon,
           'photos': o.photos,
           'accuracy': o.accuracy,
           'location': pg_lon_lat(o.location),
           'observer': o.observer,
           'provider': o.provider,
           'certainty': o.certainty,
           'direction': o.direction,
           'collection': o.collection,
           'source_url': o.source_url,
           'attribution': o.attribution,
           'identifiers': o.identifiers,
           'observed_at': pg_ts(o.observed_at),
           'organization': o.organization,
           'observed_from': pg_lon_lat(o.observed_from),
           'provider_slug': o.provider_slug,
           'contributor_id': o.contributor_id,
           'observed_until': pg_ts(o.observed_until),
           'organization_url': o.organization_url
         }) AS VARCHAR);
CREATE OR REPLACE TABLE build.occurrences (
  id VARCHAR, observed_at TIMESTAMPTZ, doc VARCHAR,
  source VARCHAR, identifiers VARCHAR[], location STRUCT(lat DOUBLE, lon DOUBLE));
INSERT INTO build.occurrences
  SELECT id, observed_at, occurrence_doc(o), 'maplify', identifiers, location FROM maplify_occurrences o;
INSERT INTO build.occurrences
  SELECT id, observed_at, occurrence_doc(o), 'inaturalist', identifiers, location FROM inaturalist_occurrences o;
INSERT INTO build.occurrences
  SELECT id, observed_at, occurrence_doc(o), 'happywhale', identifiers, location FROM happywhale_occurrences o;
INSERT INTO build.occurrences
  SELECT id, observed_at, occurrence_doc(o), 'native', identifiers, location FROM native_occurrences o;
INSERT INTO build.occurrences
  SELECT id, observed_at, occurrence_doc(o), 'orcasound', identifiers, location FROM orcasound_occurrences o;
