-- register.taxon_for and register.taxon_entity_for run with an empty search_path (salish-c94).
--
-- Both are SECURITY DEFINER. taxon_for had `register, public, pg_catalog`: naming
-- pg_catalog explicitly, after public, means an object created in public is found BEFORE
-- the built-in of the same name — a definer-rights function resolving split_part, length,
-- or an operator to someone else's code. taxon_entity_for had `register, pg_catalog`,
-- which does not include public but is set the same way for the same rule: every other
-- definer-rights function of ours already uses '' (register.inaturalist_taxon_for was
-- written that way after CodeRabbit flagged the pattern on #482), and
-- supabase/definer-search-path.test.ts now holds all of them to it.
--
-- Both bodies already schema-qualify every relation, function and type they name
-- (register.*, inaturalist.*, public.taxon), so ALTER is enough; the bodies are unchanged.
ALTER FUNCTION register.taxon_for(text) SET search_path = '';
ALTER FUNCTION register.taxon_entity_for(text) SET search_path = '';
