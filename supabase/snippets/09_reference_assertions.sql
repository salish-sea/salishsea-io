\set ON_ERROR_STOP on
\echo === Phase 9 Reference Table verification ===
--
-- Validates the reference table foundation (Phase 9) against the
-- local Supabase database. Every block corresponds to a success criterion
-- in .planning/phases/09-reference-table-foundation/09-01-PLAN.md.
--
-- Run:
--   supabase db reset                                       -- (apply migrations)
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/snippets/09_reference_assertions.sql
--
-- Exit code 0 = SC-1..SC-5 + RLS write-closed check all pass.
-- Non-zero = first failing block's RAISE EXCEPTION message names the criterion.

-- =====================================================================
-- SC-1: providers has exactly 4 rows; anon role can SELECT
-- =====================================================================
\echo SC-1: providers — exactly 4 rows, anon-readable

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.providers;
  IF n <> 4 THEN
    RAISE EXCEPTION 'SC-1 FAIL: providers has % rows (expected 4: direct, maplify, inaturalist, happywhale)', n;
  END IF;
END $$;

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.providers
   WHERE slug NOT IN ('direct', 'maplify', 'inaturalist', 'happywhale');
  IF n > 0 THEN
    RAISE EXCEPTION 'SC-1 FAIL: providers contains unexpected slug(s): %', n;
  END IF;
END $$;

SET ROLE anon;
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.providers;
  IF n = 0 THEN
    RAISE EXCEPTION 'SC-1 FAIL: anon role cannot SELECT from providers (RLS policy missing or denying)';
  END IF;
END $$;
RESET ROLE;

-- =====================================================================
-- SC-2: organizations has rows with non-null url; anon-readable
-- =====================================================================
\echo SC-2: organizations — rows with non-null url, anon-readable

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.organizations WHERE url IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'SC-2 FAIL: % organization(s) have NULL url (ORG-01 requires non-null url)', n;
  END IF;
END $$;

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.organizations;
  -- IN-02: assert the parent-institution seed actually landed (5 canonical orgs:
  -- orca-network, cascadia, tmmc, mbari, orcasound), not merely "> 0".
  IF n < 5 THEN
    RAISE EXCEPTION 'SC-2 FAIL: organizations has only % rows (expected >= 5 canonical parent institutions)', n;
  END IF;
END $$;

-- IN-02: ORG-01 requires rights-holder text on every organization.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.organizations WHERE rights_holder_text IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'SC-2 FAIL: % organization(s) have NULL rights_holder_text (ORG-01 requires rights-holder text)', n;
  END IF;
END $$;

SET ROLE anon;
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.organizations;
  IF n = 0 THEN
    RAISE EXCEPTION 'SC-2 FAIL: anon role cannot SELECT from organizations (RLS policy missing or denying)';
  END IF;
END $$;
RESET ROLE;

-- =====================================================================
-- SC-3: collections — ~15+ rows; kind enum excludes aggregator_ingest;
--        anon-readable; stubs have NULL kind; named have non-null kind
-- =====================================================================
\echo SC-3: collections — rows with valid kind enum; no aggregator_ingest; anon-readable

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.collections;
  -- Seed is 10 named + 11 acronym stubs = 21 (WR-03: guard reflects the real
  -- seed size, not the stale "~10" header; losing ~half the seed must fail).
  IF n < 20 THEN
    RAISE EXCEPTION 'SC-3 FAIL: collections has only % rows (expected >= 20: 10 named + ~11 stubs)', n;
  END IF;
END $$;

-- Verify aggregator_ingest is not in the enum by construction (D-09)
DO $$
BEGIN
  PERFORM 'aggregator_ingest'::public.collection_kind;
  RAISE EXCEPTION 'SC-3 FAIL: aggregator_ingest exists as a collection_kind enum value — must be absent by construction (D-09)';
EXCEPTION
  WHEN invalid_text_representation THEN
    -- Expected: cast fails because aggregator_ingest is not in the enum
    RAISE NOTICE 'SC-3 PASS: aggregator_ingest correctly absent from collection_kind enum';
END $$;

-- Named collections (iNaturalist, HappyWhale, direct, Orca Network, Cascadia, TMMC, Orcasound, MBARI,
--  Whale Alert Global, Whale Alert Alaska) should have non-null kind
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.collections
   WHERE slug IN ('inaturalist', 'happywhale', 'salishsea-direct',
                  'orca-network', 'cascadia', 'tmmc', 'orcasound', 'mbari',
                  'whale-alert-global', 'whale-alert-alaska')
     AND kind IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'SC-3 FAIL: % named collection(s) have NULL kind (only stubs should have NULL kind)', n;
  END IF;
END $$;

-- IN-01: acronym stubs must carry NULL kind (D-06/D-09). Assert the stub side
-- explicitly so a regression that back-fills a guessed kind onto stubs fails.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.collections WHERE kind IS NULL;
  IF n < 10 THEN
    RAISE EXCEPTION 'SC-3 FAIL: only % stub collection(s) with NULL kind (expected ~11 acronym stubs)', n;
  END IF;
END $$;

-- WR-02: collection -> organization FK subqueries must have RESOLVED. A mistyped
-- org slug in the seed silently yields NULL organization_id with no error, which
-- would defeat the FK and the Phase 12 EML join. The five org-backed collections
-- (orca-network, cascadia, tmmc, mbari, orcasound) must each carry a non-null FK.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.collections
   WHERE slug IN ('orca-network', 'cascadia', 'tmmc', 'mbari', 'orcasound')
     AND organization_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'SC-3 FAIL: % org-backed collection(s) have NULL organization_id — FK subquery did not resolve (check org slug spelling in seed)', n;
  END IF;
END $$;

-- WR-02 (cont.): every collection.organization_id that IS set must point at a
-- real organizations row (no dangling FK values).
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.collections c
   WHERE c.organization_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = c.organization_id);
  IF n > 0 THEN
    RAISE EXCEPTION 'SC-3 FAIL: % collection(s) reference a non-existent organization_id', n;
  END IF;
END $$;

SET ROLE anon;
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.collections;
  IF n = 0 THEN
    RAISE EXCEPTION 'SC-3 FAIL: anon role cannot SELECT from collections (RLS policy missing or denying)';
  END IF;
END $$;
RESET ROLE;

-- =====================================================================
-- SC-4: public.contributors has orcid column (nullable)
-- =====================================================================
\echo SC-4: orcid column exists on public.contributors

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'contributors'
     AND column_name  = 'orcid';
  IF n = 0 THEN
    RAISE EXCEPTION 'SC-4 FAIL: orcid column not found on public.contributors';
  END IF;
END $$;

-- Verify it is nullable
DO $$
DECLARE col_is_nullable TEXT;
BEGIN
  SELECT is_nullable INTO col_is_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'contributors'
     AND column_name  = 'orcid';
  IF col_is_nullable <> 'YES' THEN
    RAISE EXCEPTION 'SC-4 FAIL: orcid column on public.contributors is NOT NULL — must be nullable';
  END IF;
END $$;

-- =====================================================================
-- SC-5: per-provider contributor model intact — no cross-provider merge
-- =====================================================================
\echo SC-5: per-provider contributor model intact (contributors referenced per-provider)

-- Verify public.contributors still has its existing rows
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.contributors;
  -- Prod has 28 native contributors; local may have 0 after reset, which is fine
  -- The structural check is that the table exists and no migration dropped/altered it incorrectly
  RAISE NOTICE 'SC-5 INFO: public.contributors has % rows', n;
END $$;

-- No contributor_id shared across provider FKs yet (Phase 10 adds those columns)
-- This assertion confirms the table structure was not changed inappropriately
DO $$
DECLARE has_provider_id BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'contributors'
       AND column_name  = 'provider_id'
  ) INTO has_provider_id;
  IF has_provider_id THEN
    RAISE EXCEPTION 'SC-5 FAIL: provider_id column found on public.contributors — should not exist (Phase 10 adds FK columns on source tables, not on contributors)';
  END IF;
END $$;

-- =====================================================================
-- T-09-01 mitigation: RLS write-closed check
-- anon can SELECT but cannot INSERT/UPDATE/DELETE on reference tables
-- =====================================================================
\echo T-09-01: RLS write-closed — anon INSERT/UPDATE/DELETE on all reference tables must not mutate

-- WR-01: the title claims "write-closed" but only INSERT was tested. INSERT under
-- a no-policy RLS table raises insufficient_privilege, but UPDATE/DELETE do NOT
-- raise — they silently match zero rows (the RLS USING clause filters every row).
-- So UPDATE/DELETE must be asserted via affected-row count, and all three
-- reference tables must be covered (a permissive write policy on any of them is
-- a privilege-escalation regression this block now catches).
SET ROLE anon;

-- INSERT must be rejected on every reference table.
DO $$
DECLARE tbl TEXT; cols TEXT; vals TEXT;
BEGIN
  FOR tbl, cols, vals IN
    SELECT * FROM (VALUES
      ('providers',     '(slug, name)',                  $i$('x-evil', 'x')$i$),
      ('organizations', '(slug, name, url, rights_holder_text)', $i$('x-evil', 'x', 'https://x', 'x')$i$),
      ('collections',   '(slug, name)',                  $i$('x-evil', 'x')$i$)
    ) AS t(tbl, cols, vals)
  LOOP
    BEGIN
      EXECUTE format('INSERT INTO public.%I %s VALUES %s', tbl, cols, vals);
      RAISE EXCEPTION 'T-09-01 FAIL: anon INSERT into public.% succeeded — RLS write-closed policy missing/misconfigured', tbl;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'T-09-01 PASS: anon INSERT into % rejected with insufficient_privilege', tbl;
    END;
  END LOOP;
END $$;

-- UPDATE/DELETE must affect zero rows (silently filtered by RLS, not raised).
DO $$
DECLARE tbl TEXT; affected INTEGER;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['providers', 'organizations', 'collections'])
  LOOP
    EXECUTE format('UPDATE public.%I SET slug = slug', tbl);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
      RAISE EXCEPTION 'T-09-01 FAIL: anon UPDATE on public.% affected % row(s) — expected 0 (RLS write-closed)', tbl, affected;
    END IF;

    EXECUTE format('DELETE FROM public.%I', tbl);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
      RAISE EXCEPTION 'T-09-01 FAIL: anon DELETE on public.% affected % row(s) — expected 0 (RLS write-closed)', tbl, affected;
    END IF;
  END LOOP;
  RAISE NOTICE 'T-09-01 PASS: anon UPDATE/DELETE affected 0 rows on all reference tables';
END $$;
RESET ROLE;

\echo === All Phase 9 assertions passed ===
