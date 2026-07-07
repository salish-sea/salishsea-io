-- Rights-policy D-21 (docs/rights-policy.md §7.1): a minority of the Bigg's
-- sheet's story cells are creative prose carrying a thin copyright. The mirror
-- is an internal baseline — the prose may not be republished verbatim, in the
-- UI or via the anon API. Facts about a naming (name, namer, year, theme,
-- status) remain public; the story column becomes readable only by privileged
-- roles until entries are restated as facts or permission is secured.
--
-- Column-level SELECT means PostgREST requests naming `story` (or `select=*`
-- expansion including it) fail for anon/authenticated; app code selects
-- explicit nickname columns.
REVOKE SELECT ON public.nicknames FROM anon, authenticated;
GRANT SELECT (id, individual_id, social_group_id, name, namer_id, theme, status, named_year)
  ON public.nicknames TO anon, authenticated;
