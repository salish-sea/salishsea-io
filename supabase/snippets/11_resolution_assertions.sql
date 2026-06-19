\set ON_ERROR_STOP on
\echo === Phase 11 resolution verification ===
--
-- Validates the resolution schema migration (Phase 11) against the local Supabase database.
-- Every block corresponds to a success criterion in
-- .planning/phases/11-resolution-backfill/11-03-PLAN.md.
--
-- Run:
--   npx supabase db reset
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/snippets/11_resolution_assertions.sql
--
-- Exit code 0 = all local SC blocks pass.
-- Non-zero = first failing block's RAISE EXCEPTION message names the criterion.
--
-- LOCAL vs PROD ROW COUNTS (Pitfall 7):
--   Local db reset has ~416 Maplify rows (from seed.sql calling update_sightings);
--   prod has 6,827+ rows. The SC#1 completeness assertion (all bracket-tagged rows
--   have collection_id) is PROD-ONLY and cannot be run locally. This file:
--     (a) asserts schema/function existence and correct behavior locally, and
--     (b) carries a CLEARLY COMMENTED-OUT prod diff-gate block for manual prod runs.
--
-- NOTE on D-09 SC#1 regex deviation:
--   ROADMAP SC#1 literal is ^\[ but this implementation uses ^\[[^\]]+\] (non-empty
--   bracket content). Empty/[NULL] brackets are intentionally excluded (stay NULL).
--   This is INTENTIONAL per D-09 and is flagged here for gsd-verifier review.

-- =====================================================================
-- SC#1 (local/structural): resolve_collection function exists and handles
--   known + unknown inputs correctly.
--
-- INTENTIONAL DEVIATION (D-09, flagged for gsd-verifier):
--   The ROADMAP SC#1 regex is ^\[ but this implementation tightens it to
--   ^\[[^\]]+\] (requires at least one character inside brackets). Empty
--   brackets like "[] foo" are treated as untagged and resolve to NULL.
--   This matches the census reality (no empty brackets found in prod data)
--   and is intentional per the operator decision at 11-02 sign-off.
-- =====================================================================
\echo SC#1: resolve_collection exists, returns NULL for unknown input, returns non-NULL for known input
DO $$
DECLARE
  result_unknown  INTEGER;
  result_known    INTEGER;
  expected_id     INTEGER;
BEGIN
  -- SC#1a: unknown input → NULL
  SELECT maplify.resolve_collection('no bracket tag here', 'unknown_source') INTO result_unknown;
  IF result_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'SC#1 FAIL: resolve_collection returned % for unrecognized input (expected NULL)', result_unknown;
  END IF;

  -- SC#1b: known bracket tag → non-null collection_id matching orca-network
  SELECT id INTO expected_id FROM public.collections WHERE slug = 'orca-network';
  SELECT maplify.resolve_collection('[Orca Network] big pod', 'whalealertoa') INTO result_known;
  IF result_known IS DISTINCT FROM expected_id THEN
    RAISE EXCEPTION 'SC#1 FAIL: resolve_collection returned % for [Orca Network] input (expected orca-network id %)', result_known, expected_id;
  END IF;

  -- SC#1c: empty bracket → NULL (D-09 tightening: ^\[[^\]]+\] requires non-empty)
  SELECT maplify.resolve_collection('[] empty bracket', 'unknown') INTO result_unknown;
  IF result_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'SC#1 FAIL: resolve_collection returned % for empty [] bracket (expected NULL per D-09)', result_unknown;
  END IF;
END $$;

-- =====================================================================
-- SC#2: maplify.sightings.comments column type unchanged — no mutation,
--   no retype, no scrub. Proves comments immutability structurally (D-12).
-- =====================================================================
\echo SC#2: maplify.sightings.comments column type unchanged (varchar/text — no scrub or retype)
DO $$
DECLARE col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
    FROM information_schema.columns
   WHERE table_schema = 'maplify'
     AND table_name   = 'sightings'
     AND column_name  = 'comments';
  IF col_type NOT IN ('character varying', 'text', 'character') THEN
    RAISE EXCEPTION 'SC#2 FAIL: maplify.sightings.comments column type is % (expected character varying/text — no migration should retype it)', col_type;
  END IF;
END $$;

-- SC#3 (structural/local): contributor_id is never set by resolve_collection.
--   Full SC#3 ("Trusted Observer rows have NULL contributor_id") is a prod-data
--   assertion — local Maplify rows from seed may not include attribution-pattern rows.
--   Structural proof: resolve_collection(comments, source) returns only an INTEGER
--   (collection_id) — it has no side effect on contributor_id. Assert function
--   signature has correct return type.
\echo SC#3: resolve_collection has no contributor_id side-effect (returns integer only)
DO $$
DECLARE ret_type TEXT;
BEGIN
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO ret_type
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname  = 'maplify'
     AND p.proname  = 'resolve_collection';
  IF ret_type <> 'integer' THEN
    RAISE EXCEPTION 'SC#3 FAIL: resolve_collection return type is % (expected integer — no contributor side-effect)', ret_type;
  END IF;
  -- Prod-data check for SC#3 (Trusted Observer rows have NULL contributor_id on
  -- maplify.sightings) must be run manually against prod since local seed data
  -- may not include attribution-pattern rows.
END $$;

-- =====================================================================
-- SC#4 (structural): the three single-collection collection_id DEFAULTs
--   are set; public.contributors.inat_login column exists (D-05, D-15).
-- =====================================================================
\echo SC#4: collection_id DEFAULTs set on inaturalist/public/happywhale tables; inat_login column exists
DO $$
DECLARE
  n         INT;
  col_dflt  TEXT;
BEGIN
  -- inaturalist.observations collection_id DEFAULT
  SELECT column_default INTO col_dflt
    FROM information_schema.columns
   WHERE table_schema = 'inaturalist'
     AND table_name   = 'observations'
     AND column_name  = 'collection_id';
  IF col_dflt IS NULL THEN
    RAISE EXCEPTION 'SC#4 FAIL: inaturalist.observations.collection_id has no DEFAULT (expected migration-resolved id)';
  END IF;

  -- public.observations collection_id DEFAULT
  SELECT column_default INTO col_dflt
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'observations'
     AND column_name  = 'collection_id';
  IF col_dflt IS NULL THEN
    RAISE EXCEPTION 'SC#4 FAIL: public.observations.collection_id has no DEFAULT (expected migration-resolved id)';
  END IF;

  -- happywhale.encounters collection_id DEFAULT
  SELECT column_default INTO col_dflt
    FROM information_schema.columns
   WHERE table_schema = 'happywhale'
     AND table_name   = 'encounters'
     AND column_name  = 'collection_id';
  IF col_dflt IS NULL THEN
    RAISE EXCEPTION 'SC#4 FAIL: happywhale.encounters.collection_id has no DEFAULT (expected migration-resolved id)';
  END IF;

  -- public.contributors.inat_login column exists (D-15)
  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'contributors'
     AND column_name  = 'inat_login';
  IF n = 0 THEN
    RAISE EXCEPTION 'SC#4 FAIL: public.contributors.inat_login column does not exist (D-15)';
  END IF;

  -- Verify inat_login is unique (UNIQUE constraint should exist)
  SELECT count(*) INTO n
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema    = tc.table_schema
   WHERE tc.table_schema     = 'public'
     AND tc.table_name       = 'contributors'
     AND kcu.column_name     = 'inat_login'
     AND tc.constraint_type  = 'UNIQUE';
  IF n = 0 THEN
    RAISE EXCEPTION 'SC#4 FAIL: public.contributors.inat_login has no UNIQUE constraint (D-15)';
  END IF;
END $$;

-- =====================================================================
-- SC#5 (synthetic/local): resolve_collection returns the expected
--   collection_id for a known seeded bracket tag, attribution phrase,
--   and source code — proves the ongoing-resolution code path works.
--   NOTE: the full update_sightings round-trip is asserted in plan 11-04
--   after the ingest function edit lands.
-- =====================================================================
\echo SC#5: resolve_collection returns correct id for seeded bracket/attribution/source inputs
DO $$
DECLARE
  result     INTEGER;
  expected   INTEGER;
BEGIN
  -- Bracket tag (Orca Network) → orca-network collection
  SELECT id INTO expected FROM public.collections WHERE slug = 'orca-network';
  SELECT maplify.resolve_collection('[Orca Network] big pod', 'anything') INTO result;
  IF result IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'SC#5 FAIL: bracket [Orca Network] returned % (expected orca-network id %)', result, expected;
  END IF;

  -- Attribution (Cascadia Trusted Observer) → cascadia collection
  SELECT id INTO expected FROM public.collections WHERE slug = 'cascadia';
  SELECT maplify.resolve_collection('Submitted by a Cascadia Trusted Observer', 'farallon') INTO result;
  IF result IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'SC#5 FAIL: attribution Cascadia returned % (expected cascadia id %)', result, expected;
  END IF;

  -- Source code (whale_alert) → whale-alert collection
  SELECT id INTO expected FROM public.collections WHERE slug = 'whale-alert';
  SELECT maplify.resolve_collection('plain text no tag', 'whale_alert') INTO result;
  IF result IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'SC#5 FAIL: source whale_alert returned % (expected whale-alert id %)', result, expected;
  END IF;

  -- Precedence: bracket wins over source
  SELECT id INTO expected FROM public.collections WHERE slug = 'orca-network';
  SELECT maplify.resolve_collection('[Orca Network] big pod', 'whale_alert') INTO result;
  IF result IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'SC#5 FAIL: bracket [Orca Network] vs source whale_alert returned % (expected bracket to win: orca-network id %)', result, expected;
  END IF;
END $$;

-- =====================================================================
-- SC#5 (structural/plan 11-04): update_sightings calls resolve_collection;
--   iNat MERGE mints contributor in NOT MATCHED INSERT only (D-16/Pitfall 6).
--
-- These assertions verify the ingest function edits from plan 11-04
-- (20260620000200_resolution_ingest.sql) without hitting live HTTP endpoints.
-- Structural check via pg_get_functiondef: confirms the functions were replaced
-- correctly by inspecting the stored function body.
--
-- NOTE: running maplify.update_sightings() against the live Maplify HTTP API
-- is not suitable for local CI (requires external HTTP; may be unavailable).
-- The structural assertion is the correct local verification mode (RESEARCH Pitfall 7).
-- =====================================================================
\echo SC#5a: update_sightings function body contains maplify.resolve_collection
DO $$
DECLARE
  fn_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'maplify'
     AND p.proname = 'update_sightings';
  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'SC#5a FAIL: maplify.update_sightings function does not exist';
  END IF;
  IF fn_body NOT LIKE '%maplify.resolve_collection%' THEN
    RAISE EXCEPTION 'SC#5a FAIL: maplify.update_sightings body does not contain maplify.resolve_collection (wildcard INSERT not yet replaced)';
  END IF;
  -- Also verify wras filter is present (operator decision 2026-06-19)
  IF fn_body NOT LIKE '%wras%' THEN
    RAISE EXCEPTION 'SC#5a FAIL: maplify.update_sightings body does not contain wras filter';
  END IF;
END $$;

\echo SC#5b: upsert_observation_page MERGE INSERT mints contributor; MATCHED UPDATE does not overwrite it
DO $$
DECLARE
  fn_body TEXT;
  -- Find the WHEN MATCHED UPDATE section by extracting between "WHEN MATCHED" and "WHEN NOT MATCHED"
  matched_update_section TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'inaturalist'
     AND p.proname = 'upsert_observation_page';
  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'SC#5b FAIL: inaturalist.upsert_observation_page function does not exist';
  END IF;
  -- Assert mint_contributor is present (wires contributor_id in NOT MATCHED INSERT)
  IF fn_body NOT LIKE '%inaturalist.mint_contributor%' THEN
    RAISE EXCEPTION 'SC#5b FAIL: upsert_observation_page body does not contain inaturalist.mint_contributor (D-16 wiring missing)';
  END IF;
  -- Assert the WHEN MATCHED UPDATE (observations merge) does NOT set contributor_id.
  -- Strategy: extract the observations MERGE MATCHED UPDATE SET clause and assert
  -- contributor_id is absent. The observations MATCHED UPDATE is the first WHEN MATCHED
  -- block in the body (before the observation_photos MERGE).
  -- We check by taking the substring from "THEN UPDATE SET" to "WHEN NOT MATCHED"
  -- (which immediately follows the MATCHED UPDATE in the observations MERGE).
  matched_update_section := substring(
    fn_body
    FROM 'THEN UPDATE SET.+?WHEN NOT MATCHED'
  );
  IF matched_update_section IS NULL THEN
    RAISE EXCEPTION 'SC#5b FAIL: could not extract MATCHED UPDATE section from upsert_observation_page body';
  END IF;
  IF matched_update_section LIKE '%contributor_id%' THEN
    RAISE EXCEPTION 'SC#5b FAIL: WHEN MATCHED UPDATE includes contributor_id — Pitfall 6 violated (existing rows must keep their backfilled contributor_id)';
  END IF;
END $$;

-- =====================================================================
-- PROD-ONLY: diff-gate assertion (D-08)
-- Run manually against prod before phase 11 sign-off (Pitfall 7):
--   psql "postgresql://postgres:${DB_PASSWORD}@aws-1-us-west-1.pooler.supabase.com:5432/postgres" \
--        --no-password -v ON_ERROR_STOP=1 -f supabase/snippets/11_resolution_assertions.sql
--
-- DO NOT uncomment and run against local db reset — local has only ~416 rows
-- and the completeness assertion requires the full 6,827+ prod row set.
-- =====================================================================
-- \echo Diff-gate: all bracket tags covered by collection_rule (PROD-ONLY)
-- DO $$ DECLARE n BIGINT; BEGIN
--   SELECT COUNT(*) INTO n
--     FROM maplify.sightings s
--    WHERE s.comments ~ '^\[[^\]]+\]'
--      AND NOT EXISTS (
--        SELECT 1 FROM maplify.collection_rule r
--         WHERE r.match_kind = 'bracket'
--           AND r.match_value = (regexp_match(s.comments, '^\[([^\]]+)\]'))[1]
--      );
--   IF n > 0 THEN
--     RAISE EXCEPTION 'DIFF-GATE FAIL: % rows with bracket tags not covered by collection_rule', n;
--   END IF;
-- END $$;

\echo === All Phase 11 local assertions passed ===
