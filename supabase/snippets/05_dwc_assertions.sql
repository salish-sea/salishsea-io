\set ON_ERROR_STOP on
\echo === Phase 5 DwC projection verification ===
--
-- This harness validates 04-POLICY encoding in the dwc.* views against
-- the local Supabase database. Every block corresponds to a row in
-- .planning/phases/05-db-projection-dwc-schema/05-VALIDATION.md
-- §"Per-Task Verification Map".
--
-- Run:
--   supabase db reset                                       -- (apply migrations + seed)
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/snippets/05_dwc_assertions.sql
--
-- Exit code 0 = every ALIGN-01..06 + M-05 + POLICY §1.4 + DWCA-03
-- readiness + D-15/D-16 + D-20 assertion holds. Non-zero = first
-- failing block's RAISE EXCEPTION message identifies the requirement.
--
-- Empty-table handling: assertions that would trivially pass on an
-- empty dwc.occurrences emit a SKIP message rather than RAISE EXCEPTION.
-- Assertions where empty IS a problem (e.g., dwc.taxa_classification
-- empty when inaturalist.taxa has rows) catch the case via count-match.

-- =====================================================================
-- ALIGN-01: dwc.occurrences source prefixes are EXACTLY {salishsea, maplify}
-- =====================================================================
\echo ALIGN-01: dwc.occurrences source filter (native + Maplify only)
DO $$
DECLARE
  total INTEGER;
  arr   TEXT[];
BEGIN
  SELECT COUNT(*) INTO total FROM dwc.occurrences;
  IF total = 0 THEN
    RAISE NOTICE 'ALIGN-01 SKIP: dwc.occurrences is empty in local DB; assertion deferred to first data fixture.';
  ELSE
    SELECT array_agg(DISTINCT split_part("occurrenceID", ':', 1) ORDER BY 1)
      INTO arr FROM dwc.occurrences;
    IF NOT (arr <@ ARRAY['maplify','salishsea']::text[]) THEN
      RAISE EXCEPTION 'ALIGN-01 FAIL: dwc.occurrences carries unexpected source prefix(es): %', arr;
    END IF;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-02: 4 GBIF-required terms are NOT NULL on every row
-- =====================================================================
\echo ALIGN-02: occurrenceID / basisOfRecord / scientificName / eventDate NOT NULL
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences
   WHERE "occurrenceID" IS NULL
      OR "basisOfRecord" IS NULL
      OR "scientificName" IS NULL
      OR "eventDate" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'ALIGN-02 FAIL: % row(s) in dwc.occurrences have a NULL GBIF-required term (occurrenceID / basisOfRecord / scientificName / eventDate)', n;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-03: Higher-rank taxon emits no fabricated binomial
-- =====================================================================
\echo ALIGN-03: no fabricated binomial (genus NULL for family-and-above)
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences
   WHERE "taxonRank" IN ('family','subfamily','superfamily','order','class','phylum','kingdom')
     AND "genus" IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'ALIGN-03 FAIL: % row(s) in dwc.occurrences have a non-NULL genus at family-or-higher rank (fabricated binomial)', n;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-03: taxonRank populated for every row
-- =====================================================================
\echo ALIGN-03: taxonRank populated for every row
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences WHERE "taxonRank" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'ALIGN-03 FAIL: % row(s) in dwc.occurrences have NULL taxonRank', n;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-04: lat/lon within valid global range
-- =====================================================================
\echo ALIGN-04: decimalLatitude/decimalLongitude in valid range
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences
   WHERE "decimalLatitude"  NOT BETWEEN -90  AND 90
      OR "decimalLongitude" NOT BETWEEN -180 AND 180;
  IF n > 0 THEN
    RAISE EXCEPTION 'ALIGN-04 FAIL: % row(s) in dwc.occurrences have out-of-range latitude or longitude', n;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-04: axis sanity — nearest point to (48.5N, -123W) lands in the
-- Salish Sea bbox (lat 47..50, lon -125..-122). Catches X/Y swap.
-- =====================================================================
\echo ALIGN-04: axis sanity (nearest point to mid-Haro-Strait lands in Salish Sea bbox)
DO $$
DECLARE
  total INTEGER;
  best_lat DOUBLE PRECISION;
  best_lon DOUBLE PRECISION;
BEGIN
  SELECT COUNT(*) INTO total FROM dwc.occurrences;
  IF total = 0 THEN
    RAISE NOTICE 'ALIGN-04 axis-sanity SKIP: dwc.occurrences is empty in local DB.';
  ELSE
    SELECT "decimalLatitude", "decimalLongitude"
      INTO best_lat, best_lon
      FROM dwc.occurrences
     ORDER BY ABS("decimalLatitude" - 48.5) + ABS("decimalLongitude" + 123.0)
     LIMIT 1;
    IF NOT (best_lat BETWEEN 47 AND 50 AND best_lon BETWEEN -125 AND -122) THEN
      RAISE EXCEPTION 'ALIGN-04 FAIL (axis-sanity): nearest point (%, %) is outside the Salish Sea bbox — likely ST_X/ST_Y swap', best_lat, best_lon;
    END IF;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-04: coordinateUncertaintyInMeters is never 0
-- =====================================================================
\echo ALIGN-04: coordinateUncertaintyInMeters never 0
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences
   WHERE "coordinateUncertaintyInMeters" = 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'ALIGN-04 FAIL: % row(s) in dwc.occurrences have coordinateUncertaintyInMeters = 0 (POLICY: omit when unknown, never emit 0)', n;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-04: geodeticDatum constant (at most one distinct value)
-- =====================================================================
\echo ALIGN-04: geodeticDatum constant (at most one distinct value)
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(DISTINCT "geodeticDatum") INTO n FROM dwc.occurrences;
  IF n > 1 THEN
    RAISE EXCEPTION 'ALIGN-04 FAIL: dwc.occurrences carries % distinct geodeticDatum values (expected 0 or 1 — constant WGS84)', n;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-05: Maplify eventDate is date-only (no `T` separator)
-- =====================================================================
\echo ALIGN-05: Maplify eventDate is date-precision only (no T)
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences
   WHERE "occurrenceID" LIKE 'maplify:%'
     AND "eventDate" LIKE '%T%';
  IF n > 0 THEN
    RAISE EXCEPTION 'ALIGN-05 FAIL: % Maplify row(s) in dwc.occurrences carry a T (time component) in eventDate (POLICY §3.2: date precision only)', n;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-05: Native eventDate carries the time component (`T`)
-- =====================================================================
\echo ALIGN-05: Native eventDate includes time (T) component
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences
   WHERE "occurrenceID" LIKE 'salishsea:%'
     AND "eventDate" NOT LIKE '%T%';
  IF n > 0 THEN
    RAISE EXCEPTION 'ALIGN-05 FAIL: % native row(s) in dwc.occurrences are missing the T (time component) in eventDate (POLICY §3.1: full precision ISO-8601)', n;
  END IF;
END $$;

-- =====================================================================
-- ALIGN-06: occurrenceID unique across all rows in dwc.occurrences
-- =====================================================================
\echo ALIGN-06: occurrenceID unique across all rows
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM (
    SELECT "occurrenceID" FROM dwc.occurrences GROUP BY 1 HAVING COUNT(*) > 1
  ) dup;
  IF n > 0 THEN
    RAISE EXCEPTION 'ALIGN-06 FAIL: % duplicate occurrenceID value(s) in dwc.occurrences', n;
  END IF;
END $$;

-- =====================================================================
-- M-05: dwc.taxa_classification.genus is NULL for family-and-above taxa
-- =====================================================================
\echo M-05: taxa_classification genus NULL for family-and-above leaf rank
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n
    FROM dwc.taxa_classification tc
    JOIN inaturalist.taxa t ON t.id = tc.taxon_id
   WHERE t.rank IN ('family','subfamily','superfamily','order','class','phylum','kingdom')
     AND tc.genus IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'M-05 FAIL: % row(s) in dwc.taxa_classification have non-NULL genus for a family-and-above leaf taxon', n;
  END IF;
END $$;

-- =====================================================================
-- M-05: dwc.taxa_classification has one row per inaturalist.taxa row
-- =====================================================================
\echo M-05: taxa_classification one row per inaturalist.taxa row
DO $$
DECLARE
  tc_n INTEGER;
  it_n INTEGER;
BEGIN
  SELECT COUNT(*) INTO tc_n FROM dwc.taxa_classification;
  SELECT COUNT(*) INTO it_n FROM inaturalist.taxa;
  IF tc_n <> it_n THEN
    RAISE EXCEPTION 'M-05 FAIL: row-count mismatch — dwc.taxa_classification has % row(s); inaturalist.taxa has % row(s) (expected equal)', tc_n, it_n;
  END IF;
END $$;

-- =====================================================================
-- POLICY §1.4: dwc.multimedia excludes 'none' and NULL license rows
-- =====================================================================
\echo POLICY §1.4: dwc.multimedia license never NULL (none/NULL excluded)
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM dwc.multimedia WHERE "license" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'POLICY §1.4 FAIL: % row(s) in dwc.multimedia have a NULL license — none/NULL exclusion did not apply', n;
  END IF;
END $$;

-- =====================================================================
-- DWCA-03 readiness: every dwc.multimedia.coreId joins dwc.occurrences
-- =====================================================================
\echo DWCA-03 readiness: every dwc.multimedia.coreId resolves in dwc.occurrences
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n
    FROM dwc.multimedia m
    LEFT JOIN dwc.occurrences o ON o."occurrenceID" = m."coreId"
   WHERE o."occurrenceID" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'DWCA-03 FAIL: % multimedia row(s) reference a coreId not present in dwc.occurrences', n;
  END IF;
END $$;

-- =====================================================================
-- D-15 / D-16 wiring: every dwc.occurrences.datasetID joins dwc.datasets
-- =====================================================================
\echo D-15/D-16: dwc.occurrences.datasetID joins dwc.datasets.dataset_id
DO $$
DECLARE
  total INTEGER;
  n     INTEGER;
BEGIN
  SELECT COUNT(*) INTO total FROM dwc.occurrences;
  IF total = 0 THEN
    RAISE NOTICE 'D-15/D-16 SKIP: dwc.occurrences is empty in local DB; dataset-wiring assertion deferred.';
  ELSE
    SELECT COUNT(*) INTO n
      FROM dwc.occurrences o
      LEFT JOIN dwc.datasets d ON d.dataset_id = o."datasetID"
     WHERE d.dataset_id IS NULL;
    IF n > 0 THEN
      RAISE EXCEPTION 'D-15/D-16 FAIL: % row(s) in dwc.occurrences have a datasetID not present in dwc.datasets', n;
    END IF;
  END IF;
END $$;

-- =====================================================================
-- D-20 / §1.1: dwc.occurrences.license is a subset of the two canonical
-- /legalcode URIs (CC-BY-NC native, CC-BY Maplify)
-- =====================================================================
\echo D-20 / §1.1: dwc.occurrences.license values are canonical /legalcode URIs
DO $$
DECLARE
  total INTEGER;
  arr   TEXT[];
BEGIN
  SELECT COUNT(*) INTO total FROM dwc.occurrences;
  IF total = 0 THEN
    RAISE NOTICE 'D-20 SKIP: dwc.occurrences is empty in local DB; license-URI assertion deferred.';
  ELSE
    SELECT array_agg(DISTINCT "license" ORDER BY 1) INTO arr FROM dwc.occurrences;
    IF NOT (arr <@ ARRAY[
      'https://creativecommons.org/licenses/by-nc/4.0/legalcode',
      'https://creativecommons.org/licenses/by/4.0/legalcode'
    ]::text[]) THEN
      RAISE EXCEPTION 'D-20 FAIL: dwc.occurrences.license carries unexpected URI(s): %', arr;
    END IF;
  END IF;
END $$;

\echo === All assertions passed ===
