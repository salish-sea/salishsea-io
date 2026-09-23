-- Which group sits inside which is read from the register (decision 051, salish-ox2.5).
--
-- social_groups.parent_group_id was our own copy of the register's tree. Checked against
-- production on 2026-09-22: all 132 of its links are what this view derives, and the
-- ecotype has none on either side, so dropping it loses nothing. Keeping
-- it would mean holding a second answer to a question the register owns, and one a
-- hierarchical tagging UI will ask of the register directly.

-- ---------------------------------------------------------------------------
-- A group's parent: its nearest ancestor that we also catalogue.
-- ---------------------------------------------------------------------------
--
-- "Nearest" because register.ancestor is a closure: T065As has both T065s and Bigg's above
-- it. The parent is the one with no other catalogued ancestor of T065As beneath it. Taken
-- among OUR groups because a page walks our rows; a group the register holds and we do not
-- (a pod, a clan) is stepped over rather than breaking the chain. A group with no
-- catalogued ancestor — the ecotype — has no row.

CREATE VIEW public.group_parents AS
SELECT g.id AS group_id, p.id AS parent_group_id
FROM public.social_groups g
JOIN register.ancestor a ON a.entity_id = g.entity_id
JOIN public.social_groups p ON p.entity_id = a.ancestor_id
WHERE NOT EXISTS (
  SELECT 1
  FROM register.ancestor other
  JOIN public.social_groups o ON o.entity_id = other.ancestor_id
  JOIN register.ancestor beneath ON beneath.entity_id = other.ancestor_id
                                AND beneath.ancestor_id = a.ancestor_id
  WHERE other.entity_id = g.entity_id
);

COMMENT ON VIEW public.group_parents IS
  'Each catalogued group''s nearest catalogued ancestor, as the register says it (decision '
  '051). One row per group that has one; the ecotype has none. A projection of '
  'register.ancestor — it asserts nothing of its own.';

REVOKE ALL ON public.group_parents FROM anon, authenticated;
GRANT SELECT ON public.group_parents TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- The ecotype views read the closure directly.
-- ---------------------------------------------------------------------------
--
-- The recursive walk up parent_group_id becomes one join: the register's closure already
-- says every group's and every animal's ecotype. A mention of the ecotype itself ("Biggs")
-- still counts toward it, as the walk's base case did.

CREATE OR REPLACE VIEW public.ecotype_occurrences AS
WITH group_to_ecotype AS (
  SELECT g.id AS group_id, e.id AS ecotype_id
  FROM public.social_groups g
  JOIN register.ancestor a ON a.entity_id = g.entity_id
  JOIN public.social_groups e ON e.entity_id = a.ancestor_id AND e.kind = 'ecotype'
  UNION ALL
  SELECT e.id, e.id FROM public.social_groups e WHERE e.kind = 'ecotype'
), individual_to_ecotype AS (
  SELECT i.id AS individual_id, e.id AS ecotype_id
  FROM public.individuals i
  JOIN register.ancestor a ON a.entity_id = i.entity_id
  JOIN public.social_groups e ON e.entity_id = a.ancestor_id AND e.kind = 'ecotype'
)
SELECT gte.ecotype_id, c.occurrence_id, c.observed_at, c.location,
  true AS is_present, 'candidate'::public.identification_status AS status
FROM public.occurrence_identifier_candidates c
JOIN group_to_ecotype gte ON gte.group_id = c.social_group_id
WHERE c.social_group_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = c.occurrence_id AND s.social_group_id = c.social_group_id)
UNION
SELECT ite.ecotype_id, c.occurrence_id, c.observed_at, c.location,
  true AS is_present, 'candidate'::public.identification_status AS status
FROM public.occurrence_identifier_candidates c
JOIN individual_to_ecotype ite ON ite.individual_id = c.individual_id
WHERE c.individual_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = c.occurrence_id AND s.individual_id = c.individual_id)
UNION
SELECT gte.ecotype_id, s.occurrence_id, o.observed_at, o.location, s.is_present, s.status
FROM public.identifications s
JOIN public.occurrence_index o ON o.id = s.occurrence_id
JOIN group_to_ecotype gte ON gte.group_id = s.social_group_id
WHERE s.social_group_id IS NOT NULL
UNION
SELECT ite.ecotype_id, s.occurrence_id, o.observed_at, o.location, s.is_present, s.status
FROM public.identifications s
JOIN public.occurrence_index o ON o.id = s.occurrence_id
JOIN individual_to_ecotype ite ON ite.individual_id = s.individual_id
WHERE s.individual_id IS NOT NULL;

-- Nothing reads it now.
ALTER TABLE public.social_groups DROP COLUMN parent_group_id;
