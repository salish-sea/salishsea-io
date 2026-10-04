-- The Darwin Core archive's relations, derived in the build (decision 061, salish-xv35.9):
-- DuckDB twins of Postgres's dwc views, written as tables into a `pgdb` catalog under the
-- names scripts/dwca/build.ts reads, so the archive writer is the same code whether it
-- reads Postgres (the nightly) or the build. Twins, not improvements: each names the
-- Postgres object it ports and keeps its quirks, and the twin test checks them row for row
-- (derive-occurrences.test.ts, which checks the archive's relations beside the occurrences').
--
-- Run by scripts/read-path/dwca.ts after derive/sources.sql, derive/shared.sql and
-- derive/extract.sql, derive/shared.sql and derive/lookups.sql, and after
-- memory.maplify_entity is written, as for derive/occurrences.sql. The archive's
-- publication date is the variable pub_date.

ATTACH ':memory:' AS pgdb;
CREATE SCHEMA pgdb.dwc;
CREATE SCHEMA pgdb.maplify;
CREATE SCHEMA pgdb.public;

-- --- How Postgres renders a jsonb as text --------------------------------------------------
-- Keys shorter first, then bytewise; ", " between members and ": " after a key. Each entry
-- is a member already rendered, NULL to leave it out (jsonb_strip_nulls); no members at all
-- is NULL, as NULLIF(…, '{}') makes it.
CREATE OR REPLACE TEMP MACRO pg_jsonb_member(k, v) AS
  CASE WHEN v IS NULL THEN NULL ELSE CAST(to_json(k) AS VARCHAR) || ': ' || CAST(to_json(v) AS VARCHAR) END;
CREATE OR REPLACE TEMP MACRO pg_jsonb_list_member(k, l) AS
  CASE WHEN l IS NULL THEN NULL
       ELSE CAST(to_json(k) AS VARCHAR) || ': ['
            || array_to_string(list_transform(l, x -> CAST(to_json(x) AS VARCHAR)), ', ') || ']' END;
CREATE OR REPLACE TEMP MACRO pg_jsonb_object(members) AS
  CASE WHEN len(list_filter(members, m -> m IS NOT NULL)) = 0 THEN NULL
       ELSE '{' || array_to_string(list_filter(members, m -> m IS NOT NULL), ', ') || '}' END;

-- --- dwc.taxa_classification ---------------------------------------------------------------
-- iNaturalist's own ancestry, resolving retired taxa on the way up, as the fallback; the
-- register's lineage, reached through the species, preferred below kingdom.
CREATE OR REPLACE TEMP VIEW dwc_taxa_classification AS
  WITH RECURSIVE ancestors AS (
    SELECT t_recorded.id AS leaf_id, t.id AS ancestor_id, t.parent_id, t.rank,
           t.scientific_name, 0 AS depth
    FROM source_inaturalist_taxa t_recorded
    JOIN source_inaturalist_taxa t ON t.id = coalesce(t_recorded.current_taxon_id, t_recorded.id)
    UNION ALL
    SELECT a.leaf_id, p.id, p.parent_id, p.rank, p.scientific_name, a.depth + 1
    FROM ancestors a
    JOIN source_inaturalist_taxa p_recorded ON p_recorded.id = a.parent_id
    JOIN source_inaturalist_taxa p ON p.id = coalesce(p_recorded.current_taxon_id, p_recorded.id)
    WHERE a.depth < 50
  ), inat AS (
    SELECT leaf_id AS taxon_id,
           max(CASE WHEN rank = 'kingdom' THEN scientific_name END) AS kingdom,
           max(CASE WHEN rank = 'phylum'  THEN scientific_name END) AS phylum,
           max(CASE WHEN rank = 'class'   THEN scientific_name END) AS class,
           max(CASE WHEN rank = 'order'   THEN scientific_name END) AS order_,
           max(CASE WHEN rank = 'family'  THEN scientific_name END) AS family,
           max(CASE WHEN rank = 'genus'   THEN scientific_name END) AS genus
    FROM ancestors GROUP BY leaf_id
  ), reg AS (
    SELECT t.id AS taxon_id, c.phylum, c.class, c."order" AS order_, c.family, c.genus
    FROM taxa t
    JOIN inaturalist_taxon_name x ON x.inat_taxon_id = coalesce(t.species_id, coalesce(t.current_taxon_id, t.id))
    JOIN register.classification c ON c.entity_id = x.entity_id
  )
  SELECT t_recorded.id AS taxon_id,
         t.rank AS taxon_rank,
         t.scientific_name,
         p.kingdom,
         coalesce(r.phylum, p.phylum) AS phylum,
         coalesce(r.class, p.class) AS class,
         coalesce(r.order_, p.order_) AS order_,
         coalesce(r.family, p.family) AS family,
         CASE WHEN t.rank IN ('genus', 'genushybrid', 'subgenus', 'species', 'complex', 'section',
                              'subsection', 'hybrid', 'subspecies', 'variety', 'form', 'infrahybrid')
              THEN coalesce(r.genus, p.genus) END AS genus
  FROM source_inaturalist_taxa t_recorded
  JOIN source_inaturalist_taxa t ON t.id = coalesce(t_recorded.current_taxon_id, t_recorded.id)
  JOIN inat p ON p.taxon_id = t_recorded.id
  LEFT JOIN reg r ON r.taxon_id = t_recorded.id;

-- --- Maplify's sightings as Postgres stored them -------------------------------------------
-- Postgres's ingest kept only what is in the map's scope, with its entity and collection
-- resolved; the mirror keeps everything Maplify returned, so the same rules apply here
-- (memory.maplify_entity, maplify_collection, memory.maplify_out_of_scope).
CREATE OR REPLACE TABLE pgdb.maplify.sightings AS
  SELECT s.id, s.name, s.scientific_name, s.location_lon, s.location_lat, s.number_sighted,
         s.created_at, s.comments, s.is_test, s.trusted, s.source,
         me.entity_id, mc.collection_id
  FROM source_maplify_sightings s
  LEFT JOIN memory.maplify_entity me
    ON me.name IS NOT DISTINCT FROM s.name AND me.scientific_name = s.scientific_name
  LEFT JOIN maplify_collection mc ON mc.id = s.id
  WHERE s.id NOT IN (SELECT id FROM memory.maplify_out_of_scope);

CREATE OR REPLACE TABLE pgdb.public.observations AS SELECT * FROM public.observations;
CREATE OR REPLACE TABLE pgdb.public.collections AS SELECT * FROM public.collections;
CREATE OR REPLACE TABLE pgdb.public.organizations AS SELECT * FROM public.organizations;

-- --- dwc._native_occurrences --------------------------------------------------------------
CREATE OR REPLACE TEMP VIEW dwc_native_occurrences AS
  SELECT 'salishsea:' || CAST(o.id AS VARCHAR) AS "occurrenceID",
         'HumanObservation' AS "basisOfRecord",
         strftime(timezone('UTC', o.observed_at), '%Y-%m-%dT%H:%M:%SZ') AS "eventDate",
         tc.scientific_name AS "scientificName",
         tc.taxon_rank AS "taxonRank",
         tc.kingdom, tc.phylum, tc.class, tc.order_ AS "order", tc.family, tc.genus,
         o.subject_location_lat AS "decimalLatitude",
         o.subject_location_lon AS "decimalLongitude",
         'WGS84' AS "geodeticDatum",
         nullif(o.accuracy, 0) AS "coordinateUncertaintyInMeters",
         CAST(o.count AS INTEGER) AS "individualCount",
         'present' AS "occurrenceStatus",
         nullif(trim(regexp_replace(o.body, '<[^>]+>', '', 'g')), '') AS "occurrenceRemarks",
         c.name AS "recordedBy",
         'SalishSea' AS "institutionCode",
         'SalishSea.io' AS "rightsHolder",
         'SalishSea.io — ' || c_coll.name AS "datasetName",
         'https://salishsea.io/datasets/occurrences-v1' AS "datasetID",
         'https://creativecommons.org/licenses/by-nc/4.0/legalcode' AS license,
         pg_jsonb_object([
           pg_jsonb_member('travelDirection', o.direction),
           pg_jsonb_list_member('unvalidatedIdentifiers', nullif(extract_identifiers(o.body), []))
         ]) AS "dynamicProperties",
         CAST(NULL AS VARCHAR) AS "informationWithheld",
         c.orcid AS "recordedByID"
  FROM public.observations o
  JOIN public.contributors c ON c.id = o.contributor_id
  JOIN inaturalist_taxon xw ON xw.entity_id = o.entity_id
  JOIN dwc_taxa_classification tc ON tc.taxon_id = xw.inaturalist_taxon_id
  JOIN public.collections c_coll ON c_coll.id = o.collection_id;

-- --- dwc._maplify_occurrences -------------------------------------------------------------
-- recordedBy: the observer in the parenthetical of the comments' first <br> segment,
-- '[Collection] text (Observer Name)'. Postgres takes a regular expression's greediness
-- from its first quantifier, so its `.+?` behaves greedily here and the match is the LAST
-- parenthetical in the segment; RE2 needs `.+` to say the same. Postgres's `.` also
-- matches a newline, and a segment before the first '<br>' can hold several lines, so RE2
-- needs (?s) as well.
CREATE OR REPLACE TEMP MACRO maplify_recorded_by(comments) AS (
  WITH first_line AS (SELECT split_part(comments, '<br>', 1) AS line),
       hit AS (SELECT CASE WHEN regexp_matches(line, '(?s)^\[[^\]]+\]\s+.+\(([^()]+)\)')
                           THEN regexp_extract(line, '(?s)^\[[^\]]+\]\s+.+\(([^()]+)\)', 1) END AS who
               FROM first_line)
  SELECT CASE WHEN regexp_matches(who, '[,]') OR regexp_matches(who, '^IDs?\s') THEN NULL ELSE who END
  FROM hit
);

CREATE OR REPLACE TEMP VIEW dwc_maplify_occurrences AS
  SELECT 'maplify:' || CAST(s.id AS VARCHAR) AS "occurrenceID",
         'HumanObservation' AS "basisOfRecord",
         strftime(s.created_at, '%Y-%m-%d') AS "eventDate",
         tc.scientific_name AS "scientificName",
         tc.taxon_rank AS "taxonRank",
         tc.kingdom, tc.phylum, tc.class, tc.order_ AS "order", tc.family, tc.genus,
         s.location_lat AS "decimalLatitude",
         s.location_lon AS "decimalLongitude",
         'WGS84' AS "geodeticDatum",
         CAST(NULL AS INTEGER) AS "coordinateUncertaintyInMeters",
         s.number_sighted AS "individualCount",
         'present' AS "occurrenceStatus",
         nullif(trim(regexp_replace(s.comments, '<[^>]+>', '', 'g')), '') AS "occurrenceRemarks",
         maplify_recorded_by(s.comments) AS "recordedBy",
         'SalishSea' AS "institutionCode",
         'SalishSea.io' AS "rightsHolder",
         'SalishSea.io — ' || coalesce(c_coll.name, 'Whale Alert (Global)') AS "datasetName",
         'https://salishsea.io/datasets/occurrences-v1' AS "datasetID",
         'https://creativecommons.org/licenses/by/4.0/legalcode' AS license,
         pg_jsonb_object([
           pg_jsonb_member('aggregatorChain', 'Whale Alert / Maplify (WASEAK) > ' || coalesce(c_coll.name, 'Whale Alert (Global)')),
           pg_jsonb_member('travelDirection', extract_travel_direction(s.comments)),
           pg_jsonb_member('aggregatorSource', coalesce(c_coll.name, 'Whale Alert (Global)')),
           pg_jsonb_list_member('unvalidatedIdentifiers', nullif(extract_identifiers(s.comments), []))
         ]) AS "dynamicProperties",
         CAST(NULL AS VARCHAR) AS "informationWithheld",
         CAST(NULL AS VARCHAR) AS "recordedByID"
  FROM pgdb.maplify.sightings s
  JOIN inaturalist_taxon xw ON xw.entity_id = s.entity_id
  JOIN dwc_taxa_classification tc ON tc.taxon_id = xw.inaturalist_taxon_id
  LEFT JOIN public.collections c_coll ON c_coll.id = s.collection_id
  WHERE NOT s.is_test AND s.number_sighted BETWEEN 1 AND 1000 AND s.source <> 'rwsas' AND s.trusted;

-- dwc.occurrences: the union, in a fixed order so the archive is the same bytes for the
-- same data (Postgres left it to the plan).
CREATE OR REPLACE TABLE pgdb.dwc.occurrences AS
  SELECT * FROM (SELECT * FROM dwc_native_occurrences UNION ALL SELECT * FROM dwc_maplify_occurrences)
  ORDER BY "occurrenceID";

-- --- dwc.multimedia -----------------------------------------------------------------------
CREATE OR REPLACE TABLE pgdb.dwc.multimedia AS
  SELECT 'salishsea:' || CAST(op.observation_id AS VARCHAR) AS "coreId",
         'StillImage' AS "type",
         op.href AS "identifier",
         CASE op.license_code
           WHEN 'cc0'         THEN 'https://creativecommons.org/publicdomain/zero/1.0/legalcode'
           WHEN 'cc-by'       THEN 'https://creativecommons.org/licenses/by/4.0/legalcode'
           WHEN 'cc-by-nc'    THEN 'https://creativecommons.org/licenses/by-nc/4.0/legalcode'
           WHEN 'cc-by-sa'    THEN 'https://creativecommons.org/licenses/by-sa/4.0/legalcode'
           WHEN 'cc-by-nd'    THEN 'https://creativecommons.org/licenses/by-nd/4.0/legalcode'
           WHEN 'cc-by-nc-sa' THEN 'https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode'
           WHEN 'cc-by-nc-nd' THEN 'https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode'
         END AS "license",
         c.name AS "rightsHolder",
         c.name AS "creator"
  FROM public.observation_photos op
  JOIN public.observations o ON o.id = op.observation_id
  JOIN public.contributors c ON c.id = o.contributor_id
  WHERE op.license_code IS NOT NULL AND op.license_code <> 'none'
  ORDER BY op.observation_id, op.seq;

-- --- dwc.export_coverage ------------------------------------------------------------------
CREATE OR REPLACE TABLE pgdb.dwc.export_coverage AS
  WITH native AS (
    SELECT count(*) AS source_rows,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.contributors c WHERE c.id = o.contributor_id)) AS no_contributor,
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM dwc_taxa_classification tc
             WHERE tc.taxon_id = (SELECT xw.inaturalist_taxon_id FROM inaturalist_taxon xw WHERE xw.entity_id = o.entity_id))) AS no_taxon,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.collections cc WHERE cc.id = o.collection_id)) AS no_collection
    FROM public.observations o
  ), maplify AS (
    SELECT count(*) AS source_rows,
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM dwc_taxa_classification tc
             WHERE tc.taxon_id = (SELECT xw.inaturalist_taxon_id FROM inaturalist_taxon xw WHERE xw.entity_id = s.entity_id))) AS no_taxon
    FROM pgdb.maplify.sightings s
    WHERE NOT s.is_test AND s.number_sighted BETWEEN 1 AND 1000 AND s.source <> 'rwsas' AND s.trusted
  )
  SELECT 'native' AS branch, source_rows, (SELECT count(*) FROM dwc_native_occurrences) AS exported_rows,
         no_contributor, no_taxon, no_collection
  FROM native
  UNION ALL
  SELECT 'maplify', source_rows, (SELECT count(*) FROM dwc_maplify_occurrences),
         CAST(NULL AS BIGINT), no_taxon, CAST(NULL AS BIGINT)
  FROM maplify;

-- --- dwc.datasets -------------------------------------------------------------------------
-- The one row (decision 027's text), dated by the build rather than CURRENT_DATE.
CREATE OR REPLACE TABLE pgdb.dwc.datasets AS
  SELECT 'https://salishsea.io/datasets/occurrences-v1' AS dataset_id,
         CAST(NULL AS VARCHAR) AS parent_dataset_id,
         'SalishSea.io Marine Mammal Occurrences (v1.3)' AS title,
         'Native and Maplify/Whale Alert marine mammal sighting records from the Salish Sea region. Authored from observation tables in the SalishSea.io database, expressed as DarwinCore-aligned columns. In practice the archive is overwhelmingly cetacean; see the taxonomic coverage statement for why.' AS abstract,
         CAST(getvariable('pub_date') AS VARCHAR) AS pub_date,
         'en' AS language,
         'https://creativecommons.org/licenses/by-nc/4.0/legalcode' AS intellectual_rights,
         'SalishSea.io' AS creator_name,
         'rainhead@gmail.com' AS creator_email,
         'originator' AS creator_role,
         'SalishSea.io' AS metadata_provider_name,
         'rainhead@gmail.com' AS metadata_provider_email,
         'Peter Abrahamsen' AS contact_name,
         'rainhead@gmail.com' AS contact_email,
         'pointOfContact' AS contact_role,
         CAST(NULL AS VARCHAR) AS geographic_coverage,
         CAST(NULL AS VARCHAR) AS temporal_coverage,
         'Salish Sea marine mammals, following the remit of the PSEMP Marine Mammal Working Group: Cetacea (whales, dolphins, porpoises), Pinnipedia (seals and sea lions), and Lutrinae (otters). The realized archive is overwhelmingly cetacean. Records sourced from iNaturalist and HappyWhale are excluded from this export because those platforms publish to GBIF themselves and re-export would duplicate them; they carry nearly all of the pinniped and otter observations SalishSea.io holds. Consumers seeking Salish Sea pinniped or otter records should consult those publishers directly.' AS taxonomic_coverage,
         CAST(NULL AS VARCHAR) AS methods;
