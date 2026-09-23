-- Designations are compared by the register's fold (animals ADR-0019, salish-8vr.18).
--
-- Until now a code in sighting text was matched against the catalogue by our own
-- normalize_designation(): upper-case it and pad the first number to three digits
-- (T65A5 -> T065A5). The register publishes the rule instead: fold both sides and compare
-- (lower-case; drop apostrophes and hyphens; collapse whitespace; compare digit runs as
-- numbers, T065A5 and T65A5 -> t65a5). Two rules for one question is how two systems come
-- to disagree about which animal a report named, so ours goes.
--
-- WHAT IT CHANGES, measured in production on 2026-09-23 over all 469 distinct codes in
-- sighting text: two, and both were wrong. lpad() does not only pad, it TRUNCATES, so
-- T1242s (9 reports) was read as the T124 matriline and T1241 (1 report) as the animal
-- T124. Neither code names anything in the catalogue, and under the fold neither matches.
-- Nothing else moves, and no two designations fold together.
--
-- THE TRAILING s. ADR-0019 refuses to fold it away, because T090 is an animal and T090s the
-- matriline she anchors. We never folded it either: the s decides which KIND a code is
-- matched against, and is compared, not dropped — a group matches as its designation
-- plus s, which folds the same way (fold(x || 's') = fold(x) || 's').

CREATE FUNCTION register.fold(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$
  -- The four steps of ADR-0019, in order. The last strips every run of leading zeros that
  -- precedes another digit, which is "digit runs compare as numbers" without parsing
  -- them: T090 -> t90, T000 -> t0, T002C10 -> t2c10 (the 0 in 10 follows a digit).
  SELECT regexp_replace(
    btrim(regexp_replace(translate(lower(name), '''’-', ''), '\s+', ' ', 'g')),
    '(?<!\d)0+(?=\d)', '', 'g')
$$;

COMMENT ON FUNCTION register.fold(text) IS
  'The register''s name-comparison rule (animals ADR-0019): compare fold(a) = fold(b). '
  'Never used to rewrite what is stored or shown. Twins: src/fold.ts (checked against the '
  'published cases) and a hand copy in infra/lib/edge-handler.';

GRANT EXECUTE ON FUNCTION register.fold(text) TO anon, authenticated;

-- The folded forms the browser and the edge look things up by. Stored, so a lookup is an
-- index scan and PostgREST can filter on them as plain columns.
ALTER TABLE public.designations
  ADD COLUMN code_folded text GENERATED ALWAYS AS (register.fold(code)) STORED;
CREATE INDEX designations_code_folded_idx ON public.designations (code_folded);

ALTER TABLE public.social_groups
  ADD COLUMN designation_folded text GENERATED ALWAYS AS (register.fold(designation)) STORED;
CREATE INDEX social_groups_designation_folded_idx ON public.social_groups (designation_folded);

-- ---------------------------------------------------------------------------
-- The candidate cache, rebuilt on the fold.
-- ---------------------------------------------------------------------------
--
-- A materialized view cannot be replaced in place, so it and the five views reading it are
-- dropped and recreated. Each view's body below is its current definition, unchanged; only
-- the two joins in the cache differ.

DROP MATERIALIZED VIEW public.occurrence_identifier_candidates CASCADE;

CREATE MATERIALIZED VIEW public.occurrence_identifier_candidates AS
SELECT DISTINCT ON (o.id, ident.code) o.id AS occurrence_id,
  ident.code,
  d.individual_id,
  grp.id AS social_group_id,
  o.observed_at,
  o.location
FROM public.occurrences o
CROSS JOIN LATERAL unnest(o.identifiers) ident(code)
LEFT JOIN public.social_groups grp
  ON ident.code::text ~ 's$' AND grp.kind = 'matriline'
 AND grp.designation_folded || 's' = register.fold(ident.code::text)
LEFT JOIN public.designations d
  ON ident.code::text !~ 's$' AND d.code_folded = register.fold(ident.code::text);

CREATE UNIQUE INDEX occurrence_identifier_candidates_key
  ON public.occurrence_identifier_candidates (occurrence_id, code);
CREATE INDEX occurrence_identifier_candidates_individual_id_idx
  ON public.occurrence_identifier_candidates (individual_id);
CREATE INDEX occurrence_identifier_candidates_social_group_id_idx
  ON public.occurrence_identifier_candidates (social_group_id);

REVOKE ALL ON public.occurrence_identifier_candidates FROM anon, authenticated;

CREATE VIEW public.occurrence_unresolved_codes AS
SELECT occurrence_id, code
FROM public.occurrence_identifier_candidates c
WHERE individual_id IS NULL AND social_group_id IS NULL;

CREATE VIEW public.occurrence_identifications AS
SELECT identifications.id,
  identifications.occurrence_id,
  identifications.individual_id,
  identifications.social_group_id,
  identifications.is_present,
  identifications.evidence,
  identifications.method,
  identifications.status,
  identifications.asserted_by_party_id,
  identifications.confidence,
  identifications.code,
  identifications.created_at
FROM public.identifications
UNION ALL
SELECT NULL::integer AS id,
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
  NULL::timestamp with time zone AS created_at
FROM public.occurrence_identifier_candidates c
WHERE (c.individual_id IS NOT NULL OR c.social_group_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND NOT s.individual_id IS DISTINCT FROM c.individual_id
      AND NOT s.social_group_id IS DISTINCT FROM c.social_group_id);

CREATE VIEW public.group_occurrences AS
SELECT s.social_group_id, s.occurrence_id, o.observed_at, o.location,
  s.is_present, s.status, s.evidence, s.code
FROM public.identifications s
JOIN public.occurrence_index o ON o.id = s.occurrence_id
WHERE s.social_group_id IS NOT NULL
UNION ALL
SELECT c.social_group_id, c.occurrence_id, c.observed_at, c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'text_mention'::public.identification_evidence AS evidence,
  c.code
FROM public.occurrence_identifier_candidates c
WHERE c.social_group_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.identifications s
                  WHERE s.occurrence_id = c.occurrence_id AND s.social_group_id = c.social_group_id);

-- As migration 20260923010000 defined it.
CREATE VIEW public.individual_occurrences AS
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

-- As migration 20260923020000 defined it.
CREATE VIEW public.ecotype_occurrences AS
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

-- The five views were readable before the drop; they are again, and nothing more.
REVOKE ALL ON public.occurrence_unresolved_codes, public.occurrence_identifications,
  public.group_occurrences, public.individual_occurrences, public.ecotype_occurrences
  FROM anon, authenticated;
GRANT SELECT ON public.occurrence_unresolved_codes, public.occurrence_identifications,
  public.group_occurrences, public.individual_occurrences, public.ecotype_occurrences
  TO anon, authenticated;

-- Nothing calls it now.
DROP FUNCTION public.normalize_designation(text);
