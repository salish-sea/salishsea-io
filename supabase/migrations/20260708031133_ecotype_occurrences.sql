-- An ecotype's sighting record for its profile page (bd salishsea-io-zw6,
-- decision 017): the UNION of every descendant's reports — member individuals
-- (resolved via their current maternal matriline up the parent chain) AND
-- descendant matrilines named directly.
--
-- This DELIBERATELY fans out, unlike group_occurrences (decision 016). A
-- matriline page shows reports naming the group as a unit ("T65As"); an
-- ecotype's membership is instead structural and complete, so aggregating all
-- members' reports is exactly the record the page wants. Scoped through the
-- social_groups tree (not "every individual"), so it stays correct when a
-- second ecotype (SRKW) lands: each subject's chain terminates at its own
-- kind='ecotype' root, partitioning cleanly by ecotype_id.
--
-- No via_group/individual_id columns: ecotype rows are structural. The client
-- (dedupeOccurrenceLinks) collapses the two branches to one row per occurrence.
CREATE VIEW public.ecotype_occurrences AS
WITH RECURSIVE group_ecotype AS (
  -- Seed: every group, carrying itself as the current walk node.
  SELECT id AS group_id, id AS node_id, parent_group_id, kind, ARRAY[id] AS visited
  FROM public.social_groups
  UNION ALL
  -- Walk one hop up parent_group_id. parent_group_id is a plain self-FK with no
  -- schema-level cycle prevention, so track visited ids and stop on a repeat —
  -- otherwise a bad loop would hang every read (Postgres has no built-in cycle
  -- detection). Mirrors the guard in groupChain() (src/catalog.ts).
  SELECT ge.group_id, p.id, p.parent_group_id, p.kind, ge.visited || p.id
  FROM group_ecotype ge
  JOIN public.social_groups p ON p.id = ge.parent_group_id
  WHERE NOT p.id = ANY(ge.visited)
),
group_to_ecotype AS (
  -- Each group mapped to the ecotype root at the top of its chain.
  SELECT group_id, node_id AS ecotype_id
  FROM group_ecotype
  WHERE kind = 'ecotype'
)
-- Branch A: a descendant matriline named as a unit.
SELECT
  gte.ecotype_id,
  go.occurrence_id,
  go.observed_at,
  go.location,
  go.is_present,
  go.status
FROM public.group_occurrences go
JOIN group_to_ecotype gte ON gte.group_id = go.social_group_id
UNION ALL
-- Branch B: an individual member, resolved through its current maternal
-- matriline to the ecotype. Individuals with no maternal membership row drop
-- here (a no-op today — all cataloged individuals have one — and they would
-- still surface via branch A if their matriline is named).
SELECT
  gte.ecotype_id,
  io.occurrence_id,
  io.observed_at,
  io.location,
  io.is_present,
  io.status
FROM public.individual_occurrences io
JOIN public.group_memberships gm
  ON gm.individual_id = io.individual_id
  AND gm.is_current
  AND gm.basis = 'maternal'
JOIN group_to_ecotype gte ON gte.group_id = gm.group_id;

-- Views don't inherit table policies; grant reads explicitly (same convention
-- as group_occurrences / individual_occurrences).
GRANT SELECT ON public.ecotype_occurrences TO anon, authenticated;
