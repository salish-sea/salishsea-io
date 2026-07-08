-- Index identification candidates ahead of read time (bd salishsea-io-be4,
-- deferred in decision 015).
--
-- The live resolver regexed every sighting body on every read; worse, any join
-- to public.occurrences pays ~1.6s for the view scan alone (photo aggregation
-- etc.), so a per-individual page query cost ~2s on prod. This caches the
-- expensive part — code extraction + catalog resolution, plus the occurrence
-- attributes profile pages need (observed_at, location) — in a materialized
-- view refreshed by pg_cron a minute after each 5-minute ingest tick.
--
-- What stays LIVE, deliberately:
--   * stored claims in public.identifications (curation, decision 014): a
--     curator's validated/rejected/absence row must take effect immediately,
--     so the reader views keep that branch uncached. While curation volume is
--     ~zero the planner never scans occurrences for it (nested loop over an
--     empty outer); revisit alongside the curation UI (bd salishsea-io-ek3).
--   * the shadow rule: a stored claim still suppresses the cached candidate
--     for the same (occurrence, subject).
--
-- Freshness contract: text-extraction candidates lag ingest by up to ~6
-- minutes; catalog reseeds must REFRESH explicitly (scripts/seed/seed-biggs.ts
-- does). Unresolved codes are cached too so occurrence_unresolved_codes stops
-- regexing as well.

-- One row per (occurrence, extracted code) — resolved to an individual, a
-- matriline, or (both NULL) unresolved. DISTINCT ON because
-- extract_identifiers keeps duplicate mentions within one body.
CREATE MATERIALIZED VIEW public.occurrence_identifier_candidates AS
SELECT DISTINCT ON (o.id, ident.code)
  o.id AS occurrence_id,
  ident.code AS code,
  d.individual_id AS individual_id,
  grp.id AS social_group_id,
  o.observed_at,
  o.location
FROM public.occurrences o
CROSS JOIN LATERAL unnest(o.identifiers) AS ident(code)
LEFT JOIN public.social_groups grp
  ON ident.code ~ 's$'
  AND grp.kind = 'matriline'
  AND grp.designation = public.normalize_designation(regexp_replace(ident.code, 's$', ''))
LEFT JOIN public.designations d
  ON ident.code !~ 's$'
  AND d.code = public.normalize_designation(ident.code);

-- Required by REFRESH ... CONCURRENTLY (and the natural key).
CREATE UNIQUE INDEX occurrence_identifier_candidates_key
  ON public.occurrence_identifier_candidates (occurrence_id, code);
CREATE INDEX ON public.occurrence_identifier_candidates (individual_id);
CREATE INDEX ON public.occurrence_identifier_candidates (social_group_id);

-- Internal read path: clients read through the views below. (Supabase default
-- privileges would otherwise expose the matview via PostgREST.)
REVOKE ALL ON public.occurrence_identifier_candidates FROM anon, authenticated;

-- ============================================================================
-- Repoint the reader views at the cache. Output columns and semantics are
-- unchanged from 20260707220211 / 20260707224748.
-- ============================================================================

CREATE OR REPLACE VIEW public.occurrence_identifications AS
SELECT
  id, occurrence_id, individual_id, social_group_id, is_present,
  evidence, method, status, asserted_by_party_id, confidence, code, created_at
FROM public.identifications
UNION ALL
SELECT
  NULL::integer AS id,
  c.occurrence_id,
  c.individual_id,
  c.social_group_id,
  true AS is_present,
  'text_mention'::public.identification_evidence AS evidence,
  'text_extraction'::public.identification_method AS method,
  'candidate'::public.identification_status AS status,
  NULL::integer AS asserted_by_party_id,
  NULL::real AS confidence,
  c.code,
  NULL::timestamptz AS created_at
FROM public.occurrence_identifier_candidates c
WHERE (c.individual_id IS NOT NULL OR c.social_group_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND s.individual_id IS NOT DISTINCT FROM c.individual_id
      AND s.social_group_id IS NOT DISTINCT FROM c.social_group_id
  );

CREATE OR REPLACE VIEW public.occurrence_unresolved_codes AS
SELECT c.occurrence_id, c.code
FROM public.occurrence_identifier_candidates c
WHERE c.individual_id IS NULL AND c.social_group_id IS NULL;

-- Two branches so the common case (no stored claims yet) never touches the
-- expensive occurrences view: candidates carry their own observed_at/location.
CREATE OR REPLACE VIEW public.individual_occurrences AS
SELECT
  COALESCE(s.individual_id, gm.individual_id) AS individual_id,
  s.occurrence_id,
  o.observed_at,
  o.location,
  s.is_present,
  s.status,
  s.evidence,
  s.code,
  CASE WHEN s.individual_id IS NULL THEN g.designation END AS via_group
FROM public.identifications s
LEFT JOIN public.group_memberships gm
  ON s.individual_id IS NULL AND gm.group_id = s.social_group_id AND gm.is_current
LEFT JOIN public.social_groups g
  ON g.id = s.social_group_id
JOIN public.occurrences o
  ON o.id = s.occurrence_id
WHERE COALESCE(s.individual_id, gm.individual_id) IS NOT NULL
UNION ALL
SELECT
  COALESCE(c.individual_id, gm.individual_id) AS individual_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'text_mention'::public.identification_evidence AS evidence,
  c.code,
  CASE WHEN c.individual_id IS NULL THEN g.designation END AS via_group
FROM public.occurrence_identifier_candidates c
LEFT JOIN public.group_memberships gm
  ON c.individual_id IS NULL AND gm.group_id = c.social_group_id AND gm.is_current
LEFT JOIN public.social_groups g
  ON g.id = c.social_group_id
WHERE (c.individual_id IS NOT NULL OR c.social_group_id IS NOT NULL)
  AND COALESCE(c.individual_id, gm.individual_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND s.individual_id IS NOT DISTINCT FROM c.individual_id
      AND s.social_group_id IS NOT DISTINCT FROM c.social_group_id
  );

-- Refresh one minute after each */5 ingest tick. CONCURRENTLY keeps readers
-- unblocked; cron.schedule upserts by name.
SELECT cron.schedule(
  'refresh-identifier-candidates',
  '1-59/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.occurrence_identifier_candidates$$
);
