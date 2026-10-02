-- The read-path build derives the profile pages' links to sightings itself (decision 061,
-- salish-xv35.13): public.individual_occurrences, group_occurrences and ecotype_occurrences,
-- whose twins it checks against the views. Each view starts from the identifications people
-- assert, which override what a sighting's text or an Orcasound bout suggests. Everything
-- else those views read, the build already reads.
--
-- Only the columns the views read: not who asserted an identification (a party), when, by
-- what method, or with what machine confidence.
--
-- The table has row-level security, and its one policy names anon and authenticated, so a
-- read policy for read_path, as 20260930130000 gave the tables before it.
--
-- Pinned in supabase/read-path-grants.test.ts.

GRANT SELECT (occurrence_id, individual_id, social_group_id, is_present, evidence, status, code,
              certainty)
  ON public.identifications TO read_path;

CREATE POLICY "The read-path build may read identifications." ON public.identifications
  FOR SELECT TO read_path USING (true);
