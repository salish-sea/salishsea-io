-- The identifier candidates, derived in the build (decision 061, salish-xv35.3): a DuckDB
-- twin of Postgres's derived.identifier_candidates, which pairs each designation an
-- occurrence names (T065A, J27s) with the individual or matriline the catalogue says it
-- means (supabase/migrations/20260928120000_occurrences_stored.sql@6898775). Postgres keeps them in
-- derived.occurrence_identifier_candidates, and the profile pages' link views read them.
--
-- Reads build.occurrences, which carries each occurrence's source, identifiers and exact
-- location, and the catalogue as the snapshot holds it (documents). Checked against the
-- stored candidates by compare-identifier-candidates.ts.

-- register.fold(name), the register's name-comparison rule (its ADR-0019, src/fold.ts):
-- lowercased, apostrophes and hyphens dropped, whitespace collapsed and trimmed, and every
-- run of leading zeros before a digit dropped. Postgres spells the last with a lookbehind,
-- (?<!\d)0+(?=\d), which RE2 lacks; consuming the character before the zeros is the same
-- rule, because that character can never be the digit a previous match ended on. And
-- Postgres's \s is Unicode whitespace in a UTF-8 database (src/fold.ts's too), where
-- RE2's is ASCII, so the class is spelled out: an em-space in a code folds the same here.
CREATE OR REPLACE TEMP MACRO register_fold(name) AS
  regexp_replace(
    trim(regexp_replace(translate(lower(name), '''’-', ''), '[\s\p{Z}]+', ' ', 'g')),
    '(^|[^0-9])0+([0-9])', '\1\2', 'g');

CREATE OR REPLACE TABLE build.occurrence_identifier_candidates AS
  WITH ident AS (
    SELECT o.id AS occurrence_id, code, o.observed_at, o.location
    FROM build.occurrences o, unnest(o.identifiers) AS t(code)
    -- Bouts carry register identifiers, not text; see public.acoustic_identifications.
    WHERE o.source <> 'orcasound'
  ),
  matriline AS (
    SELECT CAST(doc->>'id' AS INTEGER) AS id, doc->>'designation_folded' AS designation_folded
    FROM snapshot.social_groups WHERE doc->>'kind' = 'matriline'
  ),
  designation AS (
    SELECT CAST(doc->>'individual_id' AS INTEGER) AS individual_id, doc->>'code_folded' AS code_folded
    FROM snapshot.designations
  )
  -- DISTINCT ON (occurrence, code): a code repeated in one occurrence's text is one
  -- candidate. Postgres picks any row among duplicates; no code folds to two
  -- individuals or two matrilines today, so the pick is the same row either way —
  -- but the fold columns carry no unique index and the register reassigns codes
  -- across editions, so the pick is ORDERED here: the same input must build the same
  -- bytes (Stelis's determinism rule), whatever the data comes to hold (salish-xv35.20).
  SELECT DISTINCT ON (i.occurrence_id, i.code)
         i.occurrence_id, i.code, d.individual_id, g.id AS social_group_id, i.observed_at,
         i.location.lon AS location_lon, i.location.lat AS location_lat
  FROM ident i
  LEFT JOIN matriline g
    ON regexp_matches(i.code, 's$') AND g.designation_folded || 's' = register_fold(i.code)
  LEFT JOIN designation d
    ON NOT regexp_matches(i.code, 's$') AND d.code_folded = register_fold(i.code)
  ORDER BY i.occurrence_id, i.code, d.individual_id NULLS LAST, g.id NULLS LAST;
