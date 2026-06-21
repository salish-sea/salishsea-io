-- =====================================================================
-- Phase 12 — DwC occurrence view rebuild (26-column aggregator attribution)
-- =====================================================================
--
-- This migration DROPs and recreates the three dwc occurrence views to
-- emit 26 columns (up from 25), adding `institutionCode` at ordinal 19
-- and applying aggregator-pattern attribution:
--
--   * institutionCode = 'SalishSea' (constant on every row)
--   * rightsHolder    = 'SalishSea.io' (constant — was contributor/org name)
--   * datasetName     = 'SalishSea.io — ' || collection.name (per-collection FK join)
--   * Maplify recordedBy: view-time regex over s.comments headline (Wave-1 census grounded)
--   * Maplify WHERE: adds AND s.trusted (D-05 trusted-only export filter)
--   * dwc.datasets title: v1.2 → v1.3
--
-- DROP order: dwc.occurrences first (it depends on the branches), then
-- the branches. dwc.multimedia is NOT touched (RESEARCH Pattern 1 / Pitfall 8).
-- No CASCADE — reverse dependency order avoids it.
--
-- UNION discipline (RESEARCH Pattern 2): both branch views emit 26 columns
-- in identical order with identical names and types. Every scalar carries an
-- explicit ::text / ::double precision / ::integer cast. CREATE VIEW
-- dwc.occurrences AS SELECT * UNION ALL SELECT * enforces type parity at
-- compile time — any drift causes the migration to fail loudly.
--
-- Security: no new privileges added to the dwc schema (T-12-02-EXPO). The existing
-- GRANT SELECT ON ALL TABLES IN SCHEMA dwc covers new and recreated views.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Step 1: DROP in reverse-dependency order (occurrences → branches)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS dwc.occurrences;
DROP VIEW IF EXISTS dwc._maplify_occurrences;
DROP VIEW IF EXISTS dwc._native_occurrences;

-- ---------------------------------------------------------------------
-- Step 2: Recreate dwc._native_occurrences (26 columns)
-- ---------------------------------------------------------------------
--
-- Column order mirrors the 25-col baseline (20260617203900_dwc_schema.sql)
-- with institutionCode inserted at ordinal 19, rightsHolder made constant,
-- and datasetName replaced with per-collection FK join via c_coll.
--
-- public.observations.collection_id has a NOT NULL DEFAULT pointing to the
-- 'salishsea-direct' collection (Phase 10 backfill), so the plain JOIN is
-- always non-null → 'SalishSea.io — SalishSea.io Direct' on every native row.
CREATE VIEW dwc._native_occurrences AS
SELECT
  -- 0. occurrenceID (ALIGN-02, ALIGN-06)
  ('salishsea:' || o.id::text)::text                                            AS "occurrenceID",
  -- 1. basisOfRecord (ALIGN-02 / POLICY §3.1)
  'HumanObservation'::text                                                      AS "basisOfRecord",
  -- 2. eventDate (ALIGN-02, ALIGN-05) — full ISO-8601 UTC with Z suffix.
  to_char(o.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')::text AS "eventDate",
  -- 3. scientificName (ALIGN-02, ALIGN-03)
  tc.scientific_name::text                                                      AS "scientificName",
  -- 4. taxonRank (ALIGN-03)
  tc.taxon_rank::text                                                           AS "taxonRank",
  -- 5-10. kingdom..genus (ALIGN-03)
  tc.kingdom::text                                                              AS "kingdom",
  tc.phylum::text                                                               AS "phylum",
  tc.class::text                                                                AS "class",
  tc.order_::text                                                               AS "order",
  tc.family::text                                                               AS "family",
  tc.genus::text                                                                AS "genus",
  -- 11. decimalLatitude (ALIGN-04)
  gis.ST_Y(o.subject_location::gis.geometry)::double precision                  AS "decimalLatitude",
  -- 12. decimalLongitude (ALIGN-04)
  gis.ST_X(o.subject_location::gis.geometry)::double precision                  AS "decimalLongitude",
  -- 13. geodeticDatum (ALIGN-04)
  'WGS84'::text                                                                 AS "geodeticDatum",
  -- 14. coordinateUncertaintyInMeters (ALIGN-04)
  NULLIF(o.accuracy, 0)::integer                                                AS "coordinateUncertaintyInMeters",
  -- 15. individualCount
  o.count::integer                                                              AS "individualCount",
  -- 16. occurrenceStatus
  'present'::text                                                               AS "occurrenceStatus",
  -- 17. occurrenceRemarks
  NULLIF(TRIM(regexp_replace(o.body, '<[^>]+>', '', 'g')), '')::text             AS "occurrenceRemarks",
  -- 18. recordedBy (D-09 / POLICY §2.1) — contributor name (unchanged)
  c.name::text                                                                  AS "recordedBy",
  -- 19. institutionCode (NEW — D-01 / ATTR-01)
  'SalishSea'::text                                                             AS "institutionCode",
  -- 20. rightsHolder (D-01 / ATTR-01) — CONSTANT (was c.name)
  'SalishSea.io'::text                                                          AS "rightsHolder",
  -- 21. datasetName (D-04 / ATTR-02) — per-collection via FK join
  ('SalishSea.io — ' || c_coll.name)::text                                      AS "datasetName",
  -- 22. datasetID (D-17 / POLICY §6.3) — unchanged
  'https://salishsea.io/datasets/occurrences-v1'::text                          AS "datasetID",
  -- 23. license (D-20 / POLICY §1.1) — CC-BY-NC 4.0
  'https://creativecommons.org/licenses/by-nc/4.0/legalcode'::text              AS "license",
  -- 24. dynamicProperties (POLICY §2.3 + §2.4)
  NULLIF(jsonb_strip_nulls(jsonb_build_object('travelDirection', o.direction::text, 'unvalidatedIdentifiers', NULLIF(public.extract_identifiers(o.body), ARRAY[]::varchar[])))::text, '{}'::text) AS "dynamicProperties",
  -- 25. informationWithheld
  NULL::text                                                                    AS "informationWithheld"
FROM public.observations o
JOIN public.contributors c        ON c.id = o.contributor_id
JOIN dwc.taxa_classification tc   ON tc.taxon_id = o.taxon_id
JOIN public.collections c_coll    ON c_coll.id = o.collection_id;

COMMENT ON VIEW dwc._native_occurrences IS 'Phase 12 rebuild: 26-col native occurrence view. institutionCode=SalishSea (col 19), rightsHolder=SalishSea.io (col 20), datasetName per-collection FK (col 21). Internal — Phase 6 reads dwc.occurrences (the UNION).';

-- ---------------------------------------------------------------------
-- Step 3: Recreate dwc._maplify_occurrences (26 columns)
-- ---------------------------------------------------------------------
--
-- Column order MUST be identical to dwc._native_occurrences above.
-- Key Phase 12 changes vs baseline (20260617203900_dwc_schema.sql):
--   * CROSS JOIN LATERAL source CASE replaced by LEFT JOIN public.collections
--     (collection_id FK backfilled by Phase 11; NULL rows fall through COALESCE)
--   * recordedBy: view-time regex extraction from s.comments headline (D-02)
--     Regex: ^\[[^\]]+\]\s+.+?\(([^()]+)\) — Wave-1 census grounded (12-01)
--     Guards: comma → NULL (multi-name list), ^IDs?\s → NULL (ID credit)
--   * institutionCode: 'SalishSea'::text (constant, new col 19)
--   * rightsHolder: 'SalishSea.io'::text (constant, was dn.display_name)
--   * datasetName: per-collection FK join + COALESCE fallback (D-06)
--   * WHERE adds AND s.trusted (D-05)
--   * dynamicProperties: aggregatorSource/aggregatorChain now use collection
--     name via c_coll instead of dn.display_name (same semantic)
--
-- LEFT JOIN required: maplify.sightings.collection_id can be NULL
-- (FARPB rows and any trusted rows without a resolvable tag). The
-- COALESCE fallback ensures datasetName is always non-NULL (D-06).
CREATE VIEW dwc._maplify_occurrences AS
SELECT
  -- 0. occurrenceID (ALIGN-02, ALIGN-06)
  ('maplify:' || s.id::text)::text                                              AS "occurrenceID",
  -- 1. basisOfRecord (ALIGN-02 / POLICY §3.2)
  'HumanObservation'::text                                                      AS "basisOfRecord",
  -- 2. eventDate (ALIGN-02, ALIGN-05) — date-precision only per POLICY §3.2
  ((s.created_at AT TIME ZONE 'GMT')::date)::text                               AS "eventDate",
  -- 3. scientificName (ALIGN-02, ALIGN-03)
  tc.scientific_name::text                                                      AS "scientificName",
  -- 4. taxonRank (ALIGN-03)
  tc.taxon_rank::text                                                           AS "taxonRank",
  -- 5-10. kingdom..genus (ALIGN-03)
  tc.kingdom::text                                                              AS "kingdom",
  tc.phylum::text                                                               AS "phylum",
  tc.class::text                                                                AS "class",
  tc.order_::text                                                               AS "order",
  tc.family::text                                                               AS "family",
  tc.genus::text                                                                AS "genus",
  -- 11. decimalLatitude (ALIGN-04)
  gis.ST_Y(s.location::gis.geometry)::double precision                          AS "decimalLatitude",
  -- 12. decimalLongitude (ALIGN-04)
  gis.ST_X(s.location::gis.geometry)::double precision                          AS "decimalLongitude",
  -- 13. geodeticDatum (ALIGN-04)
  'WGS84'::text                                                                 AS "geodeticDatum",
  -- 14. coordinateUncertaintyInMeters (POLICY §3.2 gap — no source column)
  NULL::integer                                                                 AS "coordinateUncertaintyInMeters",
  -- 15. individualCount
  s.number_sighted::integer                                                     AS "individualCount",
  -- 16. occurrenceStatus
  'present'::text                                                               AS "occurrenceStatus",
  -- 17. occurrenceRemarks — strip HTML tags from comments
  NULLIF(TRIM(regexp_replace(s.comments, '<[^>]+>', '', 'g')), '')::text         AS "occurrenceRemarks",
  -- 18. recordedBy (D-02 / ATTR-01) — view-time regex over comments headline.
  --   Extracts the parenthetical observer name from the bracket-tag pattern:
  --   [Collection Tag] Description text (Observer Name)<br>...
  --   Guards (Wave-1 census validated — 12-01):
  --     ~ '[,]'     → NULL (multi-name comma list — 353 prod rows)
  --     ~ '^IDs?\s' → NULL (identification credit — 82 prod rows)
  --   Rows without bracket tag or parenthetical → regexp_match returns NULL → NULL.
  NULLIF(
    (CASE
      WHEN (regexp_match(split_part(s.comments, '<br>', 1),
                         '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ '[,]'
        OR (regexp_match(split_part(s.comments, '<br>', 1),
                         '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ '^IDs?\s'
      THEN NULL
      ELSE (regexp_match(split_part(s.comments, '<br>', 1),
                         '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1]
    END)::text,
    NULL
  )                                                                              AS "recordedBy",
  -- 19. institutionCode (NEW — D-01 / ATTR-01)
  'SalishSea'::text                                                             AS "institutionCode",
  -- 20. rightsHolder (D-01 / ATTR-01) — CONSTANT (was dn.display_name)
  'SalishSea.io'::text                                                          AS "rightsHolder",
  -- 21. datasetName (D-04/D-06 / ATTR-02) — per-collection FK + COALESCE fallback
  ('SalishSea.io — ' || COALESCE(c_coll.name, 'Whale Alert (Global)'))::text   AS "datasetName",
  -- 22. datasetID (D-17 / POLICY §6.3) — unchanged
  'https://salishsea.io/datasets/occurrences-v1'::text                          AS "datasetID",
  -- 23. license (D-20 / POLICY §1.1) — CC-BY 4.0 (Maplify / Acartia)
  'https://creativecommons.org/licenses/by/4.0/legalcode'::text                 AS "license",
  -- 24. dynamicProperties (POLICY §2.3) — aggregatorSource now from collection name
  NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'travelDirection',        public.extract_travel_direction(s.comments)::text,
    'aggregatorSource',       COALESCE(c_coll.name, 'Whale Alert (Global)'),
    'aggregatorChain',        'Whale Alert / Maplify (WASEAK) > ' || COALESCE(c_coll.name, 'Whale Alert (Global)'),
    'unvalidatedIdentifiers', NULLIF(public.extract_identifiers(s.comments), ARRAY[]::varchar[])
  ))::text, '{}'::text)                                                         AS "dynamicProperties",
  -- 25. informationWithheld
  NULL::text                                                                    AS "informationWithheld"
FROM maplify.sightings s
JOIN dwc.taxa_classification tc ON tc.taxon_id = s.taxon_id
-- LEFT JOIN required: s.collection_id can be NULL (FARPB rows, unresolved trusted rows)
LEFT JOIN public.collections c_coll ON c_coll.id = s.collection_id
-- D-05: trusted-only export; D-13: number_sighted bounds; POLICY §5.3: rwsas filter
WHERE NOT s.is_test
  AND s.number_sighted BETWEEN 1 AND 1000
  AND s.source != 'rwsas'
  AND s.trusted;

COMMENT ON VIEW dwc._maplify_occurrences IS 'Phase 12 rebuild: 26-col Maplify occurrence view. recordedBy via regex over comments (Wave-1 census), institutionCode=SalishSea (col 19), rightsHolder=SalishSea.io (col 20), datasetName per-collection FK+COALESCE (col 21), trusted-only (D-05). Internal — Phase 6 reads dwc.occurrences (the UNION).';

-- ---------------------------------------------------------------------
-- Step 4: Recreate dwc.occurrences (UNION ALL of the two 26-col branches)
-- ---------------------------------------------------------------------
--
-- SRC-01 by construction (D-11): exactly two branches. No WHERE filter.
-- Postgres enforces 26-column/type parity at CREATE VIEW time (UNION discipline).
CREATE VIEW dwc.occurrences AS
SELECT * FROM dwc._native_occurrences
UNION ALL
SELECT * FROM dwc._maplify_occurrences;

COMMENT ON VIEW dwc.occurrences IS 'Phase 12 rebuild: 26-col UNION ALL of dwc._native_occurrences and dwc._maplify_occurrences. SRC-01 (iNat/HappyWhale exclusion) preserved by construction. Read by Phase 6 (DuckDB ATTACH + COPY to CSV/GeoParquet).';

-- ---------------------------------------------------------------------
-- Step 5: Bump dwc.datasets title v1.2 → v1.3
-- ---------------------------------------------------------------------
--
-- CREATE OR REPLACE VIEW works here: column count and types are unchanged;
-- only the 'title' VALUES literal changes (RESEARCH Pattern 7 / Pitfall 4).
-- datasetID slug (/occurrences-v1) is intentionally unchanged — only the
-- human-readable title carries the version string (RESEARCH Pattern 7).
CREATE OR REPLACE VIEW dwc.datasets AS
SELECT * FROM (
  VALUES (
    'https://salishsea.io/datasets/occurrences-v1'::text,           -- dataset_id (D-17)
    NULL::text,                                                     -- parent_dataset_id (D-16)
    'SalishSea.io Cetacean Occurrences (v1.3)'::text,               -- title v1.2 → v1.3
    'Native and Maplify/Whale Alert cetacean sighting records from the Salish Sea region. Authored from observation tables in the SalishSea.io database, expressed as DarwinCore-aligned columns.'::text,  -- abstract
    CURRENT_DATE::text,                                             -- pub_date
    'en'::text,                                                     -- language
    'https://creativecommons.org/licenses/by-nc/4.0/legalcode'::text, -- intellectual_rights
    'SalishSea.io'::text,                                           -- creator_name
    'rainhead@gmail.com'::text,                                     -- creator_email
    'originator'::text,                                             -- creator_role
    'SalishSea.io'::text,                                           -- metadata_provider_name
    'rainhead@gmail.com'::text,                                     -- metadata_provider_email
    'Peter Abrahamsen'::text,                                       -- contact_name
    'rainhead@gmail.com'::text,                                     -- contact_email
    'pointOfContact'::text,                                         -- contact_role
    NULL::text,                                                     -- geographic_coverage
    NULL::text,                                                     -- temporal_coverage
    'Cetacea (Order)'::text,                                        -- taxonomic_coverage
    NULL::text                                                      -- methods
  )
) AS d (
  dataset_id,
  parent_dataset_id,
  title,
  abstract,
  pub_date,
  language,
  intellectual_rights,
  creator_name,
  creator_email,
  creator_role,
  metadata_provider_name,
  metadata_provider_email,
  contact_name,
  contact_email,
  contact_role,
  geographic_coverage,
  temporal_coverage,
  taxonomic_coverage,
  methods
);

COMMENT ON VIEW dwc.datasets IS 'Phase 12: title bumped v1.2 → v1.3. M-03 single-row dataset reification (D-15..D-18). Phase 6 reads this for EML.';
