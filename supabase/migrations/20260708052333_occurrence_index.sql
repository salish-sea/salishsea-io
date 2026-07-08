-- occurrence_index: a cheap indexed (id, observed_at, location) source for
-- stored-claims branches (bd salishsea-io-8uz, the durable fix promised in
-- decision 017 / migration 20260708040216; prerequisite for the curation UI
-- salishsea-io-ek3).
--
-- public.occurrences is a 4-way UNION with photo/observer aggregation and no
-- usable index on its computed text id, so any join against it that the
-- planner can't prune materializes the whole view (~62s on prod). The reader
-- views' stored-claims branches only need an occurrence's timestamp and
-- location; this matview caches exactly that, unique-indexed on id, refreshed
-- on the same cron tick as occurrence_identifier_candidates.
--
-- Freshness: like the candidates cache, the index lags ingest by up to ~6
-- minutes. A stored claim's *content* (status, is_present, shadowing) still
-- takes effect immediately — only the occurrence's timestamp/location come
-- from the cache, and curators claim against occurrences that are already
-- ingested (and thus already indexed), so the lag is immaterial in practice.
CREATE MATERIALIZED VIEW public.occurrence_index AS
SELECT id, observed_at, location
FROM public.occurrences;

-- Required by REFRESH ... CONCURRENTLY (and the natural key).
CREATE UNIQUE INDEX occurrence_index_id ON public.occurrence_index (id);

-- Internal read path: clients read through the views below, which run with
-- definer rights (same convention as occurrence_identifier_candidates).
REVOKE ALL ON public.occurrence_index FROM anon, authenticated;

-- Same tick as refresh-identifier-candidates, but a separate job: pg_cron runs
-- a job's command as one multi-statement string inside an implicit
-- transaction, and REFRESH ... CONCURRENTLY refuses to run in a transaction
-- block, so the two refreshes cannot share a job. cron.schedule upserts by
-- name. Unlike the candidates cache, this depends only on occurrences (no
-- catalog tables), so catalog reseeds need not refresh it.
SELECT cron.schedule(
  'refresh-occurrence-index',
  '1-59/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.occurrence_index$$
);

-- ============================================================================
-- Repoint the stored-claims branches at the index. Output columns and
-- semantics are unchanged; the only edit in each per-subject view is
-- occurrences → occurrence_index, so these no longer degrade the moment
-- curation adds identifications rows.
-- ============================================================================

-- Unchanged from 20260708000104 except the stored branch's timestamp source.
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
JOIN public.occurrence_index o
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

-- Unchanged from 20260708021011 except the stored branch's timestamp source.
CREATE OR REPLACE VIEW public.group_occurrences AS
SELECT
  s.social_group_id,
  s.occurrence_id,
  o.observed_at,
  o.location,
  s.is_present,
  s.status,
  s.evidence,
  s.code
FROM public.identifications s
JOIN public.occurrence_index o
  ON o.id = s.occurrence_id
WHERE s.social_group_id IS NOT NULL
UNION ALL
SELECT
  c.social_group_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'text_mention'::public.identification_evidence AS evidence,
  c.code
FROM public.occurrence_identifier_candidates c
WHERE c.social_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND s.social_group_id = c.social_group_id
  );

-- ============================================================================
-- ecotype_occurrences: restore the stored-claims branches dropped by the perf
-- fix (20260708040216), now that they have a cheap join target. Structure
-- (recursive CTEs, UNION dedup, candidate branches A/B) is unchanged from that
-- migration; branches C/D add stored claims, and A/B gain the same per-subject
-- shadow rule as the per-subject views: a stored claim suppresses the cached
-- candidate for the same (occurrence, subject) — and only that subject, so a
-- claim about an individual never suppresses a group candidate (or vice versa).
-- Stored rows carry their real is_present/status (validated, rejected,
-- absence), so a curator's verdict reaches the ecotype aggregate immediately.
-- ============================================================================
CREATE OR REPLACE VIEW public.ecotype_occurrences AS
WITH RECURSIVE group_ecotype AS (
  SELECT id AS group_id, id AS node_id, parent_group_id, kind, ARRAY[id] AS visited
  FROM public.social_groups
  UNION ALL
  SELECT ge.group_id, p.id, p.parent_group_id, p.kind, ge.visited || p.id
  FROM group_ecotype ge
  JOIN public.social_groups p ON p.id = ge.parent_group_id
  -- Stop at the ecotype root (don't walk past it) and never revisit (cycle guard).
  WHERE ge.kind <> 'ecotype' AND NOT p.id = ANY(ge.visited)
),
group_to_ecotype AS (
  SELECT group_id, node_id AS ecotype_id
  FROM group_ecotype
  WHERE kind = 'ecotype'
),
-- An individual's ecotype is a birthright: use its maternal matriline whether or
-- not the membership is still current (a deceased or reorganized member's
-- historical sightings still belong to the ecotype).
individual_to_ecotype AS (
  SELECT DISTINCT gm.individual_id, gte.ecotype_id
  FROM public.group_memberships gm
  JOIN group_to_ecotype gte ON gte.group_id = gm.group_id
  WHERE gm.basis = 'maternal'
)
-- UNION (not UNION ALL) collapses the bit-identical rows an occurrence produces
-- when it names both a matriline and one of its members, so the result stays
-- near one row per (ecotype, occurrence) and under PostgREST's max_rows cap.
-- (Stored rows with a differing status/is_present survive as distinct rows;
-- curation volume keeps that contribution small.)
--
-- Branch A: a descendant matriline named as a unit (candidate).
SELECT
  gte.ecotype_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status
FROM public.occurrence_identifier_candidates c
JOIN group_to_ecotype gte ON gte.group_id = c.social_group_id
WHERE c.social_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND s.social_group_id = c.social_group_id
  )
UNION
-- Branch B: an individual named directly, via its maternal matriline (candidate).
SELECT
  ite.ecotype_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status
FROM public.occurrence_identifier_candidates c
JOIN individual_to_ecotype ite ON ite.individual_id = c.individual_id
WHERE c.individual_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND s.individual_id = c.individual_id
  )
UNION
-- Branch C: a stored claim naming a descendant matriline.
SELECT
  gte.ecotype_id,
  s.occurrence_id,
  o.observed_at,
  o.location,
  s.is_present,
  s.status
FROM public.identifications s
JOIN public.occurrence_index o ON o.id = s.occurrence_id
JOIN group_to_ecotype gte ON gte.group_id = s.social_group_id
WHERE s.social_group_id IS NOT NULL
UNION
-- Branch D: a stored claim naming an individual, via its maternal matriline.
SELECT
  ite.ecotype_id,
  s.occurrence_id,
  o.observed_at,
  o.location,
  s.is_present,
  s.status
FROM public.identifications s
JOIN public.occurrence_index o ON o.id = s.occurrence_id
JOIN individual_to_ecotype ite ON ite.individual_id = s.individual_id
WHERE s.individual_id IS NOT NULL;

-- Restated for a self-contained migration (CREATE OR REPLACE preserves the
-- existing grants, but be explicit).
GRANT SELECT ON public.individual_occurrences TO anon, authenticated;
GRANT SELECT ON public.group_occurrences TO anon, authenticated;
GRANT SELECT ON public.ecotype_occurrences TO anon, authenticated;
