-- individual_occurrences — the per-individual read path for profile pages
-- (GitHub #49). Flattens occurrence_identifications to one row per
-- (individual, occurrence) link so a page can answer "when has this animal
-- been reported?" with a single PostgREST filter on individual_id — powering
-- both the recent-observations list and the presence-by-month grid from the
-- same result set.
--
-- A group claim (e.g. a "T65As" text mention) reaches every CURRENT member of
-- that group; via_group carries the group designation so the UI can label the
-- weaker inference ("via T065As"), NULL for a direct claim. An occurrence
-- mentioning both the individual and its group therefore yields two rows —
-- readers dedupe by occurrence_id, preferring the direct row.
--
-- Honesty invariant (decision 014 / rights-policy §2.4) flows through
-- unchanged: status/evidence come straight from occurrence_identifications,
-- and regex candidates stay labeled 'candidate'. Resolution remains live
-- (regex over occurrences at read time, ~2s/query on prod today); indexing
-- ahead of time is deliberately deferred.
CREATE VIEW public.individual_occurrences AS
SELECT
  COALESCE(oi.individual_id, gm.individual_id) AS individual_id,
  oi.occurrence_id,
  o.observed_at,
  o.location,
  oi.is_present,
  oi.status,
  oi.evidence,
  oi.code,
  CASE WHEN oi.individual_id IS NULL THEN g.designation END AS via_group
FROM public.occurrence_identifications oi
LEFT JOIN public.group_memberships gm
  ON oi.individual_id IS NULL AND gm.group_id = oi.social_group_id AND gm.is_current
LEFT JOIN public.social_groups g
  ON g.id = oi.social_group_id
JOIN public.occurrences o
  ON o.id = oi.occurrence_id
WHERE COALESCE(oi.individual_id, gm.individual_id) IS NOT NULL;

-- Redundant with Supabase's default privileges when applied via `db push`, but
-- explicit per repo convention — and load-bearing when a migration is applied
-- by other means (default privileges only attach for the roles they were
-- configured for).
GRANT SELECT ON public.individual_occurrences TO anon, authenticated;
