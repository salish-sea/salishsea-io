\set ON_ERROR_STOP on
\echo === Phase 10 source-table FK column verification ===
--
-- Validates the FK-column migration (Phase 10) against the local Supabase database.
-- Every block corresponds to a success criterion in
-- .planning/phases/10-source-table-fk-columns/10-01-PLAN.md.
--
-- Run:
--   supabase db reset                                       -- (apply migrations + seed)
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/snippets/10_fk_columns_assertions.sql
--
-- Exit code 0 = SC#1–SC#4 + belt-and-suspenders checks all pass.
-- Non-zero = first failing block's RAISE EXCEPTION message names the criterion.
--
-- Local fresh-reset row counts (confirmed 2026-06-19):
--   public.observations (native):   0 rows
--   inaturalist.observations:      201 rows
--   happywhale.encounters:           0 rows
--   maplify.sightings:             416 rows
--
-- SC#3-native and the HappyWhale URL-shape check are trivially satisfied locally
-- on 0-row tables, but are structurally correct and become load-bearing against
-- prod data (native 436, maplify 6,827, iNat 8,759, HW 5,601). All assertions
-- use the IS DISTINCT FROM / NOT LIKE count-zero form, which is correct on 0 rows,
-- rather than a SKIP message.

-- =====================================================================
-- SC#1: All four provenance columns exist on all four source tables,
--       with correct nullability:
--         provider_id   NOT NULL  (D-05 intentional deviation from ROADMAP SC#1)
--         collection_id nullable
--         contributor_id nullable
--         source_url    (present; nullability not constrained by SC#1)
-- =====================================================================
\echo SC#1: all four columns present on all four tables; provider_id NOT NULL; collection_id + contributor_id nullable
DO $$
DECLARE
  t    TEXT[];
  tbls TEXT[][] := ARRAY[
    ARRAY['public',      'observations'],
    ARRAY['maplify',     'sightings'],
    ARRAY['inaturalist', 'observations'],
    ARRAY['happywhale',  'encounters']
  ];
  n    INT;
BEGIN
  FOREACH t SLICE 1 IN ARRAY tbls LOOP
    -- all four columns present
    SELECT count(*) INTO n
      FROM information_schema.columns
     WHERE table_schema = t[1]
       AND table_name   = t[2]
       AND column_name IN ('provider_id', 'collection_id', 'contributor_id', 'source_url');
    IF n <> 4 THEN
      RAISE EXCEPTION 'SC#1 FAIL: %.% missing FK columns (found %/4)', t[1], t[2], n;
    END IF;

    -- provider_id NOT NULL (D-05 deviation: stricter than ROADMAP SC#1 "all nullable")
    PERFORM 1 FROM information_schema.columns
      WHERE table_schema = t[1]
        AND table_name   = t[2]
        AND column_name  = 'provider_id'
        AND is_nullable  = 'NO';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SC#1 FAIL: %.%.provider_id is nullable (expected NOT NULL per D-05)', t[1], t[2];
    END IF;

    -- collection_id nullable
    PERFORM 1 FROM information_schema.columns
      WHERE table_schema = t[1]
        AND table_name   = t[2]
        AND column_name  = 'collection_id'
        AND is_nullable  = 'YES';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SC#1 FAIL: %.%.collection_id is NOT NULL (must be nullable per D-12)', t[1], t[2];
    END IF;

    -- contributor_id nullable
    PERFORM 1 FROM information_schema.columns
      WHERE table_schema = t[1]
        AND table_name   = t[2]
        AND column_name  = 'contributor_id'
        AND is_nullable  = 'YES';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SC#1 FAIL: %.%.contributor_id is NOT NULL (must be nullable per D-10/D-11)', t[1], t[2];
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- SC#2: collection_id is indexed on the two exported tables
--       (public.observations and maplify.sightings only — D-13)
-- =====================================================================
\echo SC#2: collection_id indexed on public.observations and maplify.sightings
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n
    FROM pg_indexes
   WHERE ((schemaname = 'public'   AND tablename = 'observations')
       OR (schemaname = 'maplify'  AND tablename = 'sightings'))
     AND indexdef ILIKE '%collection_id%';
  IF n < 2 THEN
    RAISE EXCEPTION 'SC#2 FAIL: collection_id index missing on an exported table (found %/2 matching index rows)', n;
  END IF;
END $$;

-- =====================================================================
-- SC#3: source_url tracks url/uri on native and iNat tables
--   - public.observations: rows where url IS NOT NULL must have source_url = url
--   - inaturalist.observations: every row must have source_url = uri
-- Note: local native table has 0 rows — assertion is trivially satisfied but
-- structurally correct for prod data.
-- =====================================================================
\echo SC#3: native source_url = url (where url not null); iNat source_url = uri for all rows
DO $$
DECLARE n INT;
BEGIN
  -- native: source_url must equal url wherever url is populated
  SELECT count(*) INTO n
    FROM public.observations
   WHERE url IS NOT NULL
     AND source_url IS DISTINCT FROM url;
  IF n > 0 THEN
    RAISE EXCEPTION 'SC#3 FAIL: % native row(s) where url IS NOT NULL and source_url <> url', n;
  END IF;

  -- iNat: source_url must equal uri for every row (uri is NOT NULL so every row populates)
  SELECT count(*) INTO n
    FROM inaturalist.observations
   WHERE source_url IS DISTINCT FROM uri;
  IF n > 0 THEN
    RAISE EXCEPTION 'SC#3 FAIL: % iNat row(s) where source_url <> uri', n;
  END IF;
END $$;

-- =====================================================================
-- SC#4: A new Maplify insert with NULL collection_id succeeds and
--       auto-defaults provider_id; row count is restored after DELETE.
--
-- Note (RESEARCH Pitfall 5): maplify.sightings has an AFTER-INSERT NOTIFY
-- trigger (occurrences_changed_after_maplify_sightings). The NOTIFY fires but
-- has no listener in this test context — harmless. The explicit DELETE restores
-- the row count.
--
-- NOT NULL columns for the synthetic insert (from initial_schema.sql lines 201-217):
--   id, project_id, trip_id, scientific_name, location, number_sighted,
--   created_at, in_ocean, moderated, trusted, is_test, source
-- =====================================================================
\echo SC#4: NULL-collection Maplify insert succeeds; provider_id defaulted; row count restored
DO $$
DECLARE
  before_n  BIGINT;
  after_n   BIGINT;
  defaulted INT;
  coll_id   INT;
BEGIN
  SELECT count(*) INTO before_n FROM maplify.sightings;

  INSERT INTO maplify.sightings
    (id, project_id, trip_id, scientific_name, location, number_sighted,
     created_at, in_ocean, moderated, trusted, is_test, source)
  VALUES
    (999999999, 0, 0, 'Orcinus orca',
     gis.ST_Point(-123, 48)::gis.geography, 1, now(), true, 0::smallint, false, true, 'test');

  -- provider_id DEFAULT must have applied (non-NULL)
  SELECT provider_id, collection_id INTO defaulted, coll_id
    FROM maplify.sightings
   WHERE id = 999999999;

  IF defaulted IS NULL THEN
    DELETE FROM maplify.sightings WHERE id = 999999999;
    RAISE EXCEPTION 'SC#4 FAIL: provider_id DEFAULT did not apply on the inserted row';
  END IF;

  IF coll_id IS NOT NULL THEN
    DELETE FROM maplify.sightings WHERE id = 999999999;
    RAISE EXCEPTION 'SC#4 FAIL: collection_id is % (expected NULL — no NOT NULL constraint should have been added)', coll_id;
  END IF;

  DELETE FROM maplify.sightings WHERE id = 999999999;

  SELECT count(*) INTO after_n FROM maplify.sightings;
  IF before_n <> after_n THEN
    RAISE EXCEPTION 'SC#4 FAIL: row count changed % -> % after insert+delete (expected unchanged)', before_n, after_n;
  END IF;
END $$;

-- =====================================================================
-- Belt-and-suspenders 1: provider_id fully backfilled on all four tables
--   (no NULLs anywhere — belt-and-suspenders on the UPDATE slug-join)
-- =====================================================================
\echo Belt-and-suspenders: provider_id NULL count = 0 on all four tables
DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM public.observations      WHERE provider_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'B&S FAIL: % native rows with NULL provider_id (backfill incomplete)', n; END IF;

  SELECT count(*) INTO n FROM maplify.sightings        WHERE provider_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'B&S FAIL: % maplify rows with NULL provider_id (backfill incomplete)', n; END IF;

  SELECT count(*) INTO n FROM inaturalist.observations WHERE provider_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'B&S FAIL: % iNat rows with NULL provider_id (backfill incomplete)', n; END IF;

  SELECT count(*) INTO n FROM happywhale.encounters    WHERE provider_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'B&S FAIL: % HappyWhale rows with NULL provider_id (backfill incomplete)', n; END IF;
END $$;

-- =====================================================================
-- Belt-and-suspenders 2: HappyWhale source_url structural shape check
--   Every non-NULL HW source_url must match 'https://happywhale.com/individual/%;enc=%'
--   (repo-canonical form: individual_id + encounter id, individual/%;enc=% pattern).
--   On a local 0-row HW table this passes trivially; becomes load-bearing vs prod.
-- =====================================================================
\echo Belt-and-suspenders: HappyWhale source_url matches individual/%;enc=% shape
DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n
    FROM happywhale.encounters
   WHERE source_url IS NULL
      OR source_url NOT LIKE 'https://happywhale.com/individual/%;enc=%';
  IF n > 0 THEN
    RAISE EXCEPTION 'B&S FAIL: % HappyWhale row(s) have NULL or malformed source_url (expected individual/%%enc=%% shape)', n;
  END IF;
END $$;

\echo === All Phase 10 assertions passed ===
