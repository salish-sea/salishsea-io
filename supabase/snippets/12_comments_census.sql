\set ON_ERROR_STOP on
\echo === Phase 12 D-03: Trusted Maplify comments parenthetical census ===
--
-- Read-only census of parenthetical patterns in trusted maplify.sightings.comments.
-- Run BEFORE finalizing the recordedBy extraction regex in the Phase 12 migration.
-- Grounds the Wave 2 regex against the full ~6,800-row prod trusted corpus
-- (the 169-row sample in occurrence-bodies.tsv is insufficient for this purpose — D-03).
--
-- PROD-ONLY: This snippet must be run against prod via the IPv4 session pooler.
-- Local `supabase db reset` has no Maplify rows (they are not in seed.sql).
-- Running against local yields 0 rows and provides no useful signal.
--
-- Run against prod:
--   psql "postgresql://postgres.grztmjpzamcxlzecmqca:${DB_PASSWORD}@aws-1-us-west-1.pooler.supabase.com:5432/postgres" \
--        --no-password -v ON_ERROR_STOP=1 \
--        -f supabase/snippets/12_comments_census.sql \
--        > .planning/phases/12-dwc-view-rebuild/maplify_trusted_comments_census.tsv
--
-- Commit the output as:
--   .planning/phases/12-dwc-view-rebuild/maplify_trusted_comments_census.tsv
--
-- DO NOT run against `supabase db reset` — local has no Maplify data.
-- Per project memory: prod pooler host = aws-1-us-west-1.pooler.supabase.com:5432
--                     user            = postgres.<project-ref>
--                     password        = DB_PASSWORD (GitHub Actions secret / env var)
--
-- This file contains NO credentials. Supply the DSN at run time.

-- =====================================================================
-- Query (a): Candidate-extraction census
--
-- Extracts the first parenthetical in the headline segment (before the
-- first <br>) using the exact Wave 2 regex:
--
--   ^\[[^\]]+\]\s+.+?\(([^()]+)\)
--
-- Pattern anatomy:
--   ^\[[^\]]+\]     — mandatory bracket tag at start of headline (e.g. [Orca Network])
--   \s+             — whitespace after the tag
--   .+?             — lazy match of description text (stops at first opening paren)
--   \(([^()]+)\)    — capture group: first parenthetical, no nested parens
--
-- Rows without a bracket tag (e.g. Whale Alert Global, FARPB) return NULL — correct
-- per D-02 ("when no parenthetical name is present, recordedBy = NULL").
--
-- The GROUP BY / ORDER BY reveals how many unique parenthetical values the regex
-- matches across all trusted rows.  The dominant values should be single human names.
-- NULL rows are untagged (no bracket tag in headline) — expected and correct.
-- =====================================================================
\echo Query (a): Candidate-extraction census (all trusted rows, Wave 2 regex)
SELECT
    (regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] AS extracted,
    COUNT(*) AS n
FROM maplify.sightings
WHERE trusted = TRUE
GROUP BY 1
ORDER BY n DESC;

-- =====================================================================
-- Query (b): NULL-out audit
--
-- Among non-NULL extracted values, flag rows that MUST become NULL in
-- the Wave 2 view per RESEARCH Pitfall 3:
--
--   ~ ','        — multi-name comma lists (e.g. "Howard Garrett, Alisa Schulman-Janiger")
--   ~ '^IDs?\s'  — identification credits (e.g. "ID Rachel Haight", "IDs Rachel Haight")
--
-- Expected: every flagged row has a non-empty extracted value that the
-- regex would keep WITHOUT the guard — confirming the guard is necessary.
-- If this returns 0 rows the guards are still correct (they prevent
-- future regressions), but the D-03 census confirms it.
-- =====================================================================
\echo Query (b): NULL-out audit — multi-name and ID-credit parentheticals that must become NULL
SELECT
    (regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] AS extracted,
    CASE
        WHEN (regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ ','
            THEN 'multi-name (comma)'
        WHEN (regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ '^IDs?\s'
            THEN 'ID-credit prefix'
        ELSE 'other'
    END AS null_reason,
    COUNT(*) AS n
FROM maplify.sightings
WHERE trusted = TRUE
  AND (regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] IS NOT NULL
  AND (
      (regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ ','
      OR
      (regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ '^IDs?\s'
  )
GROUP BY 1, 2
ORDER BY n DESC;

\echo === D-03 census queries complete. Commit output as maplify_trusted_comments_census.tsv. ===
