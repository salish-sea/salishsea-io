-- Phase 11: Resolution Backfill (RESOLVE-03)
-- Implements RESOLVE-03 from .planning/REQUIREMENTS.md.
--
-- One-time idempotent backfill UPDATEs for all four provider tables (collection_id)
-- and iNat contributor_id. All statements are guarded by WHERE ... IS NULL (D-07)
-- so re-running this migration is a no-op.
--
-- Intentional deviations / locked decisions honoured:
--   D-07:  Every UPDATE guarded by IS NULL — idempotent by construction.
--   D-12:  maplify.sightings.comments is never written. resolve_collection READS it only.
--   D-13:  maplify.sightings.contributor_id is NOT set (stays NULL). Attribution lines
--          → collection/org only, never contributor_id.
--   D-14:  native contributor_id unchanged (already 100% populated). HappyWhale
--          contributor_id deferred. Only iNat contributor_id is populated (D-15).
--   D-15:  inaturalist.observations.contributor_id backfilled via mint_contributor;
--          iNat and native contributors remain unlinked (cross-provider unification deferred).
--
-- NOTE: The collection_id/contributor_id backfill UPDATEs are no-ops on a local
-- `supabase db reset` because prod historical rows are not present locally (D-07).
-- That is expected behaviour for a data migration — the migration still applies cleanly.
--
-- This migration MUST run AFTER 20260620000000_resolution_schema.sql (plan 11-03)
-- because it calls maplify.resolve_collection and inaturalist.mint_contributor
-- which are created in that migration (RESEARCH Pitfall 3).
--
-- wras operator decision (2026-06-19, see .planning/phases/11-resolution-backfill/maplify_census.tsv):
--   source='wras' (50 rows) should not exist. A one-time DELETE is included below.
--   The ongoing-ingest filter (WHERE source IS DISTINCT FROM 'wras') is in plan 11-04
--   Task 2 (update_sightings edit). Together they ensure wras rows cannot persist.

-- =====================================================================
-- 1. collection_id slug-join backfill for three single-collection tables (D-07)
--    These tables each map to exactly one collection; the DEFAULT (plan 11-03)
--    handles new rows going forward; existing rows need a one-time UPDATE.
--    Pattern mirrors Phase 10 provider_id backfill (20260619203013_source_table_fk_columns.sql).
-- =====================================================================

-- inaturalist.observations → 'inaturalist' collection
UPDATE inaturalist.observations
  SET collection_id = c.id
  FROM public.collections c
 WHERE c.slug = 'inaturalist'
   AND collection_id IS NULL;

-- public.observations (native) → 'salishsea-direct' collection
UPDATE public.observations
  SET collection_id = c.id
  FROM public.collections c
 WHERE c.slug = 'salishsea-direct'
   AND collection_id IS NULL;

-- happywhale.encounters → 'happywhale' collection
UPDATE happywhale.encounters
  SET collection_id = c.id
  FROM public.collections c
 WHERE c.slug = 'happywhale'
   AND collection_id IS NULL;

-- =====================================================================
-- 2. maplify.sightings collection_id backfill via resolver (D-07, D-12, RESOLVE-02)
--    maplify.resolve_collection(comments, source) returns:
--      - collection_id for rows with a known bracket tag, attribution, or source code
--      - NULL for unmatched rows (FARPB stays NULL, D-09)
--    comments is READ only — never written (D-12/SC#2).
--    Maplify contributor_id stays NULL (D-13/SC#3) — NOT SET here.
-- =====================================================================
UPDATE maplify.sightings
  SET collection_id = maplify.resolve_collection(comments, source)
 WHERE collection_id IS NULL;

-- =====================================================================
-- 3. iNat contributor_id backfill (D-15, RESOLVE-03)
--    inaturalist.mint_contributor(username) is SECURITY DEFINER + SET search_path = ''
--    (created in plan 11-03 to bypass RLS on public.contributors — RESEARCH Pitfall 2).
--    ON CONFLICT (inat_login) DO NOTHING inside mint_contributor makes this idempotent.
--    Guard: username IS NOT NULL — rows without a username cannot be linked.
--    NOTE: iNat contributors and native contributors remain unlinked (D-14/D-15);
--    cross-provider unification (jmaughn ↔ James Maughn) is explicitly deferred.
-- =====================================================================
UPDATE inaturalist.observations
  SET contributor_id = inaturalist.mint_contributor(username)
 WHERE contributor_id IS NULL
   AND username IS NOT NULL;

-- =====================================================================
-- 4. wras cleanup (operator decision 2026-06-19)
--    These 50 records (source='wras', per maplify_census.tsv) should not exist.
--    A one-time guarded DELETE removes any remaining wras rows.
--    The ongoing-ingest filter (WHERE source IS DISTINCT FROM 'wras') in
--    maplify.update_sightings (plan 11-04 Task 2) prevents new wras rows.
--    This DELETE does NOT touch maplify.sightings.comments (D-12/SC#2).
--    Idempotent: re-running returns 0 rows affected when no wras rows remain.
-- =====================================================================
DELETE FROM maplify.sightings WHERE source = 'wras';
