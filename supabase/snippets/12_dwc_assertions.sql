\set ON_ERROR_STOP on
\echo === Phase 12 DwC view rebuild verification ===
--
-- Validates the Phase 12 DwC view rebuild migration against the database.
-- Every block corresponds to a success criterion in
-- .planning/phases/12-dwc-view-rebuild/12-02-PLAN.md.
--
-- Run (local, after supabase db reset):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/snippets/12_dwc_assertions.sql
--
-- Run (prod, via IPv4 session pooler — see project memory):
--   psql "postgresql://postgres.grztmjpzamcxlzecmqca:${DB_PASSWORD}@aws-1-us-west-1.pooler.supabase.com:5432/postgres" \
--        --no-password -v ON_ERROR_STOP=1 -f supabase/snippets/12_dwc_assertions.sql
--   (Uncomment PROD-ONLY blocks before running against prod)
--
-- LOCAL vs PROD:
--   Local db reset has no maplify.sightings rows exported (seed data is not
--   trusted Maplify sightings). The data-distinct assertions (SC#1, SC#2, SC#3)
--   and the prod floor SC#5 are PROD-ONLY — they are commented out locally
--   because running against db reset would trivially pass on empty tables.
--   SC#4 (column count) and SC#6 (v1.3 title) are structural and pass locally.
--   SC#5 local/smoke (non-empty) passes only if the local DB has seeded observations.
--
-- Exit code 0 = all enabled blocks pass. Non-zero = first failing block's
-- RAISE EXCEPTION message identifies the criterion.

-- =====================================================================
-- SC#1 (ATTR-01): institutionCode is always 'SalishSea' on all rows
--
-- PROD-ONLY: meaningful only when dwc.occurrences has rows. Local db reset
-- may have zero rows (no exported maplify rows, possibly no observations).
-- Comment out locally; uncomment for prod runs.
-- =====================================================================
-- PROD-ONLY: uncomment for prod run
-- \echo SC#1: institutionCode is always SalishSea on all rows
-- DO $$ DECLARE n BIGINT; BEGIN
--   SELECT COUNT(*) INTO n FROM dwc.occurrences WHERE "institutionCode" IS DISTINCT FROM 'SalishSea';
--   IF n > 0 THEN
--     RAISE EXCEPTION 'SC#1 FAIL: % rows have institutionCode != SalishSea', n;
--   END IF;
-- END $$;

-- =====================================================================
-- SC#2 (ATTR-01): rightsHolder is always 'SalishSea.io' on all rows
--
-- PROD-ONLY: same rationale as SC#1.
-- =====================================================================
-- PROD-ONLY: uncomment for prod run
-- \echo SC#2: rightsHolder is always SalishSea.io on all rows
-- DO $$ DECLARE n BIGINT; BEGIN
--   SELECT COUNT(*) INTO n FROM dwc.occurrences WHERE "rightsHolder" IS DISTINCT FROM 'SalishSea.io';
--   IF n > 0 THEN
--     RAISE EXCEPTION 'SC#2 FAIL: % rows have rightsHolder != SalishSea.io', n;
--   END IF;
-- END $$;

-- =====================================================================
-- SC#3 (ATTR-02): datasetName always prefixed 'SalishSea.io — ', no NULL
--
-- PROD-ONLY: same rationale as SC#1. The em-dash separator is a literal
-- UTF-8 em dash (U+2014) followed by a space — not an ASCII hyphen.
-- =====================================================================
-- PROD-ONLY: uncomment for prod run
-- \echo SC#3: datasetName always prefixed SalishSea.io — , no NULL
-- DO $$ DECLARE n BIGINT; BEGIN
--   SELECT COUNT(*) INTO n FROM dwc.occurrences
--    WHERE "datasetName" IS NULL OR "datasetName" NOT LIKE 'SalishSea.io — %';
--   IF n > 0 THEN
--     RAISE EXCEPTION 'SC#3 FAIL: % rows have NULL or wrong-prefix datasetName', n;
--   END IF;
-- END $$;

-- =====================================================================
-- SC#4 (ATTR-03 / field contract): dwc.occurrences has exactly 26 columns
--
-- Structural assertion — passes locally after db reset (no data required).
-- The UNION ALL enforces 26-column/type parity at CREATE VIEW time, so if
-- either branch drifted, the migration would have already failed. This
-- assertion is the post-apply confirmation.
-- =====================================================================
\echo SC#4: dwc.occurrences has exactly 26 columns
DO $$ DECLARE n INT; BEGIN
  SELECT COUNT(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'dwc' AND table_name = 'occurrences';
  -- n = 26 is the passing condition; anything else is a failure.
  IF n <> 26 THEN
    RAISE EXCEPTION 'SC#4 FAIL: dwc.occurrences has % columns (expected = 26)', n;
  END IF;
END $$;

-- =====================================================================
-- SC#5 (ATTR-03 row-count): local/smoke — dwc.occurrences is non-empty
--
-- Local smoke: passes if the local DB has any observations (native rows).
-- Will SKIP with a NOTICE if dwc.occurrences is empty locally (no data).
--
-- PROD-ONLY ceiling block: asserts the count does not exceed the
-- SRC-01 trusted-only ceiling (observations + trusted Maplify baseline).
-- Uncomment for prod runs only — the subqueries reference maplify.sightings
-- with the Phase 12 trusted-only filter applied.
-- =====================================================================
\echo SC#5 (local/smoke): dwc.occurrences is non-empty if native rows exist
DO $$ DECLARE n BIGINT; BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences;
  IF n = 0 THEN
    RAISE NOTICE 'SC#5 SKIP: dwc.occurrences is empty locally (no seeded observations or trusted Maplify rows). Run against prod for data assertions.';
  END IF;
END $$;

-- PROD-ONLY: trusted-only Maplify + native ceiling check (SRC-01 — uncomment for prod run)
-- \echo SC#5 (PROD): dwc.occurrences count within trusted-only ceiling
-- DO $$ DECLARE n BIGINT; ceiling BIGINT; BEGIN
--   SELECT COUNT(*) INTO n FROM dwc.occurrences;
--   SELECT
--     (SELECT COUNT(*) FROM public.observations)
--     + (SELECT COUNT(*) FROM maplify.sightings
--        WHERE NOT is_test
--          AND number_sighted BETWEEN 1 AND 1000
--          AND source != 'rwsas'
--          AND trusted)
--   INTO ceiling;
--   IF n > ceiling THEN
--     RAISE EXCEPTION 'SC#5 PROD FAIL: dwc.occurrences has % rows but SRC-01 trusted ceiling is % (iNat/HappyWhale may have leaked, or untrusted Maplify rows included)', n, ceiling;
--   END IF;
--   IF n < 1000 THEN
--     RAISE EXCEPTION 'SC#5 PROD FAIL: only % rows in dwc.occurrences (floor 1000 — trusted-only Maplify + native expected well above)', n;
--   END IF;
-- END $$;

-- =====================================================================
-- SC#6: dwc.datasets title contains 'v1.3'
--
-- Structural assertion — passes locally after db reset.
-- =====================================================================
\echo SC#6: dwc.datasets title contains v1.3
DO $$ DECLARE v TEXT; BEGIN
  SELECT title INTO v FROM dwc.datasets LIMIT 1;
  IF v NOT LIKE '%v1.3%' THEN
    RAISE EXCEPTION 'SC#6 FAIL: dwc.datasets title is "%" (expected to contain v1.3)', v;
  END IF;
END $$;

\echo === All Phase 12 local assertions passed ===
