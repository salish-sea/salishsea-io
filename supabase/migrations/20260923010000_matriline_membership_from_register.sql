-- Matriline membership is read from the register (salish-ox2.5).
--
-- Until now a matriline's members were our own public.group_memberships rows, and the two
-- sides encoded the same animals differently. The register defines a matriline as a female
-- and all her descendants, so a matriarch is a member of her own
-- matriline and of every matriline above it: T065A is in T065As and in T065s. Our rows never
-- said so. A matriarch was social_groups.anchor_individual_id, and her one membership row
-- pointed at her mother's group, which had two consequences on the site:
--
--   * a report of "the T65As" reached T065A's children but never T065A herself, and
--   * a report of "the T65s" reached T065's children but not her grandchildren.
--
-- Measured in production against edition 2026.09.6: the register's reading reaches 636
-- living (animal, matriline) pairs where ours reached 329, and the inferred sighting links
-- on individual pages go from 31,542 to 57,318. Nothing here decides that; the register
-- does. This migration only stops us holding a second answer.
--
-- WHY register.ancestor AND NOT register.membership. The register keeps a redundant edge
-- from every sub-lineage member to the top-level lineage (T065A2 -> T065s directly, as well
-- as via T065As), so a count of membership rows is not a count of anything. The closure has
-- one row per (animal, group) pair and is the register's own derivation.

CREATE VIEW public.matriline_members AS
WITH lineage AS (
  -- Every matriline each catalogued animal belongs to.
  SELECT i.id AS individual_id, g.id AS group_id, g.entity_id AS group_entity_id
  FROM public.individuals i
  JOIN register.ancestor a ON a.entity_id = i.entity_id
  JOIN public.social_groups g ON g.entity_id = a.ancestor_id AND g.kind = 'matriline'
),
innermost AS (
  -- The one of those with no other of them inside it. An animal's matrilines form a
  -- single chain (T065As inside T065s), so there is exactly one; matriline-members.test.ts holds that.
  SELECT l.individual_id, l.group_id
  FROM lineage l
  WHERE NOT EXISTS (
    SELECT 1
    FROM lineage inner_l
    JOIN register.ancestor a ON a.entity_id = inner_l.group_entity_id
                            AND a.ancestor_id = l.group_entity_id
    WHERE inner_l.individual_id = l.individual_id
  )
)
SELECT l.group_id, l.individual_id, n.group_id AS innermost_group_id
FROM lineage l
JOIN innermost n ON n.individual_id = l.individual_id;

COMMENT ON VIEW public.matriline_members IS
  'Which catalogued animals belong to which matriline, as the register says: a matriarch '
  'and all her descendants, so an animal appears once for every matriline above her. '
  '`innermost_group_id` is her narrowest one, which is the matriline her own profile page '
  'shows. Deceased animals are included; life status is ours (public.individuals).';

REVOKE ALL ON public.matriline_members FROM anon, authenticated;
GRANT SELECT ON public.matriline_members TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- A group mention reaches every LIVING member, the matriarch included.
-- ---------------------------------------------------------------------------
--
-- Same columns and shape as before; only the membership source changes. "Current" was
-- group_memberships.is_current, which in every row meant the animal was alive — the
-- register records no end dates (all 1,001 rows open), so life status is what says
-- whether a deceased animal should be inferred present, and it says no.

CREATE OR REPLACE VIEW public.individual_occurrences AS
SELECT COALESCE(s.individual_id, mm.individual_id) AS individual_id,
  s.occurrence_id,
  o.observed_at,
  o.location,
  s.is_present,
  s.status,
  s.evidence,
  s.code,
  CASE WHEN s.individual_id IS NULL THEN g.designation ELSE NULL::text END AS via_group
FROM public.identifications s
LEFT JOIN (public.matriline_members mm
           JOIN public.individuals mi ON mi.id = mm.individual_id AND mi.life_status = 'alive')
  ON s.individual_id IS NULL AND mm.group_id = s.social_group_id
LEFT JOIN public.social_groups g ON g.id = s.social_group_id
JOIN public.occurrence_index o ON o.id = s.occurrence_id
WHERE COALESCE(s.individual_id, mm.individual_id) IS NOT NULL
UNION ALL
SELECT COALESCE(c.individual_id, mm.individual_id) AS individual_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'text_mention'::public.identification_evidence AS evidence,
  c.code,
  CASE WHEN c.individual_id IS NULL THEN g.designation ELSE NULL::text END AS via_group
FROM public.occurrence_identifier_candidates c
LEFT JOIN (public.matriline_members mm
           JOIN public.individuals mi ON mi.id = mm.individual_id AND mi.life_status = 'alive')
  ON c.individual_id IS NULL AND mm.group_id = c.social_group_id
LEFT JOIN public.social_groups g ON g.id = c.social_group_id
WHERE (c.individual_id IS NOT NULL OR c.social_group_id IS NOT NULL)
  AND COALESCE(c.individual_id, mm.individual_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND NOT s.individual_id IS DISTINCT FROM c.individual_id
      AND NOT s.social_group_id IS DISTINCT FROM c.social_group_id);

-- ---------------------------------------------------------------------------
-- An animal reaches its ecotype through the register, not through a membership row.
-- ---------------------------------------------------------------------------
--
-- Only individual_to_ecotype changes. It used to require a maternal membership row, so the
-- 65 matriarchs and the 70 animals in no matriline never reached the ecotype page; the
-- register places all 510 under Bigg's. The group half still walks
-- social_groups.parent_group_id, which the reconciliation found agrees with the register on
-- all 67 links; retiring it is a separate step.

CREATE OR REPLACE VIEW public.ecotype_occurrences AS
WITH RECURSIVE group_ecotype AS (
  SELECT social_groups.id AS group_id,
    social_groups.id AS node_id,
    social_groups.parent_group_id,
    social_groups.kind,
    ARRAY[social_groups.id] AS visited
  FROM public.social_groups
  UNION ALL
  SELECT ge.group_id, p.id, p.parent_group_id, p.kind, ge.visited || p.id
  FROM group_ecotype ge
  JOIN public.social_groups p ON p.id = ge.parent_group_id
  WHERE ge.kind <> 'ecotype'::public.social_group_kind AND NOT (p.id = ANY (ge.visited))
), group_to_ecotype AS (
  SELECT group_ecotype.group_id, group_ecotype.node_id AS ecotype_id
  FROM group_ecotype
  WHERE group_ecotype.kind = 'ecotype'::public.social_group_kind
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
