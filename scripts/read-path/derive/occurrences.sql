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
-- as Postgres's en-US ICU collation does: COLLATE en_us), and writes memory.extracted:
-- what extract_travel_direction and extract_identifiers answer for each source's text,
-- computed in JavaScript because RE2 can't express their patterns (derive/extract.ts).
-- Where a Postgres view calls one of them, the twin here joins that table.

-- --- Shared shapes ---------------------------------------------------------------------

-- A timestamptz as to_jsonb renders it in a UTC session: ISO 8601 with a T, the fraction
-- only when there is one and without its trailing zeros, and +00:00.
CREATE OR REPLACE TEMP MACRO pg_ts(t) AS
  CASE WHEN t IS NULL THEN NULL ELSE
    strftime(t, '%Y-%m-%dT%H:%M:%S')
    || CASE WHEN ((epoch_us(t) % 1000000) + 1000000) % 1000000 = 0 THEN ''
            ELSE '.' || rtrim(lpad(CAST(((epoch_us(t) % 1000000) + 1000000) % 1000000 AS VARCHAR), 6, '0'), '0')
       END
    || '+00:00'
  END;

-- A float8 as Postgres renders it here: the database sets extra_float_digits = 0, so
-- float8out prints %.15g (fifteen significant digits) and to_jsonb keeps that text.
-- Coordinates are the only floats in a document.
CREATE OR REPLACE TEMP MACRO pg_float(x) AS CAST(printf('%.15g', x) AS DOUBLE);
CREATE OR REPLACE TEMP MACRO pg_lon_lat(lon, lat) AS {'lat': pg_float(lat), 'lon': pg_float(lon)};

-- An enum label's position in its type's declared order, for the two comparisons that
-- use it.
CREATE OR REPLACE TEMP VIEW rank_position AS
  SELECT label AS rank, position FROM types.enums WHERE type = 'inaturalist.rank';
CREATE OR REPLACE TEMP VIEW certainty_position AS
  SELECT label AS certainty, position FROM types.enums WHERE type = 'public.identification_certainty';

-- inaturalist.species_id(taxon): the species a taxon is, or is under. Below species, its
-- parent (followed past retirement); at species, itself; above, nothing. "Below" is the
-- rank enum's order: rank < 'species'.
CREATE OR REPLACE TEMP VIEW taxa AS
  SELECT t.*,
         CASE
           WHEN r.position < (SELECT position FROM rank_position WHERE rank = 'species')
             THEN (SELECT coalesce(p.current_taxon_id, p.id) FROM inaturalist.taxa p WHERE p.id = t.parent_id)
           WHEN t.rank = 'species' THEN coalesce(t.current_taxon_id, t.id)
           ELSE NULL
         END AS species_id
  FROM inaturalist.taxa t
  LEFT JOIN rank_position r ON r.rank = t.rank;

-- --- The register ----------------------------------------------------------------------

-- The common name the register prefers for an entity: English first, then the shortest,
-- then alphabetical. The correlated subquery in the Maplify and native views, and in
-- register.taxon_for.
CREATE OR REPLACE TEMP VIEW entity_common_name AS
  SELECT entity_id, name
  FROM register.names
  WHERE type = 'common'
  QUALIFY row_number() OVER (
    PARTITION BY entity_id
    ORDER BY (language = 'en') DESC NULLS LAST, length(name), name COLLATE en_us) = 1;

-- A mapping to an iNaturalist taxon, with the taxon id it names.
CREATE OR REPLACE TEMP VIEW inaturalist_mapping AS
  SELECT subject_id, predicate_id, object_id,
         CAST(split_part(object_id, ':', 2) AS INTEGER) AS inaturalist_taxon_id,
         predicate_id = 'skos:exactMatch' AS exact
  FROM register.mappings
  WHERE predicate_id IN ('skos:exactMatch', 'skos:closeMatch')
    AND regexp_full_match(object_id, 'inaturalist\.taxon:[0-9]{1,9}');

-- register.inaturalist_taxon: each entity's iNaturalist taxon, from itself, its nearest
-- mapped ancestor, or, for a deprecated entity, its replacement and that one's ancestors.
CREATE OR REPLACE TEMP VIEW inaturalist_taxon AS
  WITH candidate AS (
    SELECT e.entity_id, e.entity_id AS via, 0 AS depth FROM register.entities e
    UNION ALL
    SELECT a.entity_id, a.ancestor_id, a.depth FROM register.ancestor a
    UNION ALL
    SELECT d.entity_id, d.replaced_by, 1000000 FROM register.deprecations d WHERE d.replaced_by IS NOT NULL
    UNION ALL
    SELECT d.entity_id, a.ancestor_id, 1000000 + a.depth
    FROM register.deprecations d JOIN register.ancestor a ON a.entity_id = d.replaced_by
  )
  SELECT c.entity_id, m.inaturalist_taxon_id
  FROM candidate c JOIN inaturalist_mapping m ON m.subject_id = c.via
  QUALIFY row_number() OVER (
    PARTITION BY c.entity_id ORDER BY c.depth, m.exact DESC, m.object_id COLLATE en_us) = 1;

-- register.inaturalist_taxon_name: for each iNaturalist taxon an entity maps to, that
-- entity and its preferred common name. Only entities that have one.
CREATE OR REPLACE TEMP VIEW inaturalist_taxon_name AS
  SELECT m.inaturalist_taxon_id AS inat_taxon_id, e.entity_id, e.label AS entity_label, n.name AS common_name
  FROM inaturalist_mapping m
  JOIN register.entities e ON e.entity_id = m.subject_id
  JOIN register.names n ON n.entity_id = e.entity_id AND n.type = 'common'
  QUALIFY row_number() OVER (
    PARTITION BY m.inaturalist_taxon_id
    ORDER BY m.exact DESC, (n.language = 'en') DESC NULLS LAST, length(n.name), n.name COLLATE en_us) = 1;

-- register.taxon_entity_for(entity): the taxon an entity is, or the nearest one above it,
-- after following a deprecation to its replacement. A split (deprecated, no replacement)
-- resolves to nothing, deliberately: see the comment in the Postgres function.
CREATE OR REPLACE TEMP VIEW taxon_entity AS
  WITH resolved AS (
    SELECT e.entity_id AS asked, CASE WHEN d.entity_id IS NULL THEN e.entity_id ELSE d.replaced_by END AS entity_id
    FROM register.entities e
    LEFT JOIN register.deprecations d ON d.entity_id = e.entity_id
  )
  SELECT r.asked AS entity_id,
         coalesce(
           (SELECT e.entity_id FROM register.entities e WHERE e.entity_id = r.entity_id AND e.kind = 'taxon'),
           (SELECT a.ancestor_id FROM register.ancestor a
             WHERE a.entity_id = r.entity_id AND a.ancestor_kind = 'taxon'
             ORDER BY a.depth LIMIT 1)
         ) AS taxon_entity_id
  FROM resolved r;

-- register.taxon_for(entity), for a taxon entity: its label, preferred common name, the
-- species of the iNaturalist taxon it maps to (or that taxon itself when the mirror
-- doesn't hold it), and itself.
CREATE OR REPLACE TEMP VIEW taxon_for AS
  SELECT e.entity_id,
         e.label AS scientific_name,
         (SELECT name FROM entity_common_name n WHERE n.entity_id = e.entity_id) AS vernacular_name,
         coalesce(
           (SELECT x.species_id FROM taxa x WHERE x.id = inat.inaturalist_taxon_id),
           inat.inaturalist_taxon_id
         ) AS species_id
  FROM register.entities e
  LEFT JOIN (
    SELECT subject_id, inaturalist_taxon_id FROM inaturalist_mapping
    QUALIFY row_number() OVER (PARTITION BY subject_id ORDER BY exact DESC) = 1
  ) inat ON inat.subject_id = e.entity_id;

-- --- The five sources --------------------------------------------------------------------
-- Each the same columns as public.occurrences, in its order; the document is built from
-- them at the end. `location` is never NULL: Postgres builds it as ROW(st_x, st_y), which
-- is a composite of NULLs, not a NULL, when the geography is missing.

-- derived.maplify_occurrences
CREATE OR REPLACE TEMP VIEW maplify_occurrences AS
  SELECT 'maplify:' || s.id AS id,
         CAST(NULL AS VARCHAR) AS url,
         s.usernm || ' on ' || s.source AS attribution,
         s.comments AS body,
         CASE WHEN s.number_sighted >= 1 AND s.number_sighted <= 1000 THEN s.number_sighted END AS count,
         xt.direction,
         pg_lon_lat(s.location_lon, s.location_lat) AS location,
         CAST(NULL AS INTEGER) AS accuracy,
         CASE WHEN s.photo_url IS NOT NULL
              THEN [{'src': s.photo_url, 'thumb': CAST(NULL AS VARCHAR), 'license': CAST(NULL AS VARCHAR),
                     'mimetype': CAST(NULL AS VARCHAR), 'attribution': CAST(NULL AS VARCHAR)}]
              ELSE [] END AS photos,
         timezone('UTC', s.created_at) AS observed_at,
         CAST(NULL AS STRUCT(lat DOUBLE, lon DOUBLE)) AS observed_from,
         {'entity_id': s.entity_id,
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
  FROM maplify.sightings s
  LEFT JOIN memory.extracted xt ON xt.source = 'maplify' AND xt.key = CAST(s.id AS VARCHAR)
  LEFT JOIN inaturalist_taxon xw ON xw.entity_id = s.entity_id
  LEFT JOIN taxa t_recorded ON t_recorded.id = xw.inaturalist_taxon_id
  LEFT JOIN taxa t ON t.id = coalesce(t_recorded.current_taxon_id, t_recorded.id)
  LEFT JOIN entity_common_name cn ON cn.entity_id = s.entity_id
  LEFT JOIN public.providers prov ON prov.id = s.provider_id
  LEFT JOIN public.collections col ON col.id = s.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id
  WHERE NOT s.is_test AND s.entity_id IS NOT NULL;

-- derived.inaturalist_occurrences
CREATE OR REPLACE TEMP VIEW inaturalist_occurrences AS
  SELECT 'inaturalist:' || o.id AS id,
         o.uri AS url,
         o.username || ' on iNaturalist' AS attribution,
         o.description AS body,
         CAST(NULL AS INTEGER) AS count,
         xt.direction,
         pg_lon_lat(o.location_lon, o.location_lat) AS location,
         o.public_positional_accuracy AS accuracy,
         coalesce((
           SELECT list({'src': p.url, 'thumb': CAST(NULL AS VARCHAR), 'license': p.license,
                        'mimetype': CAST(NULL AS VARCHAR), 'attribution': p.attribution} ORDER BY p.seq)
           FROM inaturalist.observation_photos p
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
  FROM inaturalist.observations o
  LEFT JOIN memory.extracted xt ON xt.source = 'inaturalist' AND xt.key = CAST(o.id AS VARCHAR)
  JOIN taxa t_recorded ON o.taxon_id = t_recorded.id
  JOIN taxa t ON t.id = coalesce(t_recorded.current_taxon_id, t_recorded.id)
  LEFT JOIN inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
  LEFT JOIN inaturalist_taxon_name par
    ON par.inat_taxon_id = t.parent_id AND t.rank = 'subspecies'
   AND t.scientific_name NOT LIKE 'Orcinus orca %' AND t.scientific_name NOT LIKE 'Delphinus delphis %'
  LEFT JOIN public.providers prov ON prov.id = o.provider_id
  LEFT JOIN public.collections col ON col.id = o.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id;

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
         pg_lon_lat(e.location_lon, e.location_lat) AS location,
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
         pg_lon_lat(o.subject_location_lon, o.subject_location_lat) AS location,
         CAST(NULL AS INTEGER) AS accuracy,
         coalesce((
           SELECT list({'src': p.href, 'thumb': CAST(NULL AS VARCHAR), 'license': p.license_code,
                        'mimetype': CAST(NULL AS VARCHAR), 'attribution': 'someone'} ORDER BY p.seq)
           FROM public.observation_photos p WHERE p.observation_id = o.id
         ), []) AS photos,
         o.observed_at,
         CASE WHEN o.observer_location_lon IS NOT NULL OR o.observer_location_lat IS NOT NULL
              THEN pg_lon_lat(o.observer_location_lon, o.observer_location_lat) END AS observed_from,
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
    FROM public.acoustic_bout_entities e
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
         pg_lon_lat(b.location_lon, b.location_lat) AS location,
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
  FROM public.acoustic_bouts b
  JOIN per_species tx ON tx.bout_id = b.id
  LEFT JOIN taxon_for tf ON tf.entity_id = tx.taxon_entity_id
  LEFT JOIN public.providers prov ON prov.id = b.provider_id
  LEFT JOIN public.collections col ON col.id = b.collection_id
  LEFT JOIN public.organizations org ON org.id = col.organization_id
  WHERE tx.taxon_entity_id IS NOT NULL;

-- --- The store ---------------------------------------------------------------------------
-- As snapshot.occurrences holds Postgres's: id, observed_at, and the document. The
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
           'location': o.location,
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
           'observed_from': o.observed_from,
           'provider_slug': o.provider_slug,
           'contributor_id': o.contributor_id,
           'observed_until': pg_ts(o.observed_until),
           'organization_url': o.organization_url
         }) AS VARCHAR);
CREATE OR REPLACE TABLE build.occurrences (id VARCHAR, observed_at TIMESTAMPTZ, doc VARCHAR);
INSERT INTO build.occurrences SELECT id, observed_at, occurrence_doc(o) FROM maplify_occurrences o;
INSERT INTO build.occurrences SELECT id, observed_at, occurrence_doc(o) FROM inaturalist_occurrences o;
INSERT INTO build.occurrences SELECT id, observed_at, occurrence_doc(o) FROM happywhale_occurrences o;
INSERT INTO build.occurrences SELECT id, observed_at, occurrence_doc(o) FROM native_occurrences o;
INSERT INTO build.occurrences SELECT id, observed_at, occurrence_doc(o) FROM orcasound_occurrences o;
