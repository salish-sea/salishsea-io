-- Fix a production timeout in ecotype_occurrences (bd salishsea-io-zw6).
--
-- The original definition (20260708031133) reached the ecotype's sightings
-- through group_occurrences and individual_occurrences, both of which join the
-- public.occurrences VIEW in their stored-claims branch. occurrences is a 4-way
-- UNION (maplify/inaturalist/happywhale/native) with photo/observer aggregation
-- and no usable index on its computed text id. Filtered by a single subject
-- (the individual/matriline pages) the planner leaves that branch's outer empty
-- and never builds it — but an ecotype-wide aggregate is unfiltered, so the
-- planner materialized the entire occurrences union: ~62s on prod, past
-- PostgREST's statement timeout, so the REST endpoint 500'd.
--
-- This reads only the cached occurrence_identifier_candidates matview (which
-- already carries observed_at/location per resolved code) and the small group
-- tables, never touching occurrences: ~25ms. Stored curator claims
-- (identifications) are consequently not reflected in the ecotype aggregate yet
-- — a no-op while curation volume is zero; the durable fix is a cheap indexed
-- occurrence-timestamp source the stored branch can join instead of the
-- occurrences view (bd salishsea-io-8uz, a prerequisite for the curation UI
-- salishsea-io-ek3). Every row here is an unverified text mention, which is what
-- the ecotype page presents.
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
-- when it names both a matriline and one of its members, so the result is one
-- row per (ecotype, occurrence) and never overflows PostgREST's max_rows cap.
--
-- Branch A: a descendant matriline named as a unit.
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
UNION
-- Branch B: an individual named directly, via its maternal matriline.
SELECT
  ite.ecotype_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status
FROM public.occurrence_identifier_candidates c
JOIN individual_to_ecotype ite ON ite.individual_id = c.individual_id
WHERE c.individual_id IS NOT NULL;

-- Restated for a self-contained migration (CREATE OR REPLACE preserves the
-- existing grant, but be explicit).
GRANT SELECT ON public.ecotype_occurrences TO anon, authenticated;
