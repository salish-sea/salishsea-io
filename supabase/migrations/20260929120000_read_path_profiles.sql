-- The read-path build renders the profile pages now (decision 057), so read_path
-- reads what they show: the catalogue and the four sighting-link views. No more
-- than anon reads, and not the verbatim Bigg's-sheet text rights policy D-21
-- keeps off every page (decision 015): nicknames.story, which anon can't read
-- either, and individuals.notes, which anon can but no page renders.
--
-- Grants alone are not enough for five of these tables. They carry row-level
-- security whose read policies name anon and authenticated, so read_path needs
-- its own policy or it sees no rows at all — a silent empty catalogue, not an
-- error. supabase/read-path-grants.test.ts checks both: what the role may read,
-- and that it sees every row anon does.

GRANT SELECT ON
  public.designations,
  public.parties,
  public.social_groups,
  public.haulouts,
  public.group_parents,
  public.matriline_members,
  public.animal_names,
  public.individual_occurrences,
  public.group_occurrences,
  public.ecotype_occurrences,
  public.haulout_occurrences
TO read_path;

GRANT SELECT (id, individual_id, name, named_year, namer_id, social_group_id, status, theme)
  ON public.nicknames TO read_path;
GRANT SELECT (id, entity_id, primary_designation, sex, born_earliest, born_latest, life_status,
              mother_id, maternity_certainty, father_id, paternity_certainty)
  ON public.individuals TO read_path;

-- haulouts' read policy is TO public already; these five name anon and authenticated.
CREATE POLICY "The read-path build may read individuals." ON public.individuals
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read designations." ON public.designations
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read nicknames." ON public.nicknames
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read parties." ON public.parties
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read social groups." ON public.social_groups
  FOR SELECT TO read_path USING (true);

-- animal_names calls this, and a function in a view is executed with the
-- caller's EXECUTE privilege; anon holds it. SECURITY DEFINER, so it reaches
-- register.inaturalist_taxon as its owner and read_path gains no table by it.
GRANT EXECUTE ON FUNCTION register.inaturalist_taxon_for(text) TO read_path;
