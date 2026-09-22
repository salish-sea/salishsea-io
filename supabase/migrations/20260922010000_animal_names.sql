-- What the register calls an animal, reachable from the browser (salish-53t.3).
--
-- The client cannot read `register.*`: that schema is deliberately absent from PostgREST's
-- exposed list (supabase/config.toml), so every register name reaching the UI so far has
-- arrived pre-resolved inside `public.occurrences`. The individual profile page has no
-- occurrence to hang off — it renders a catalogue entity — so it had no route to the
-- register at all, and carried its own table instead:
--
--   const TAXON_LABELS: Record<number, string> = { 41521: 'Killer whale' };
--
-- with "Bigg's killer whale" hard-coded beside it. Both are strings the register now holds
-- (`SSA:0000900` and `SSA:0000002`), and composing a name we could have read is the second
-- opinion decision 033 forbids. This view is the route that lets that table go.
--
-- NOT `public.taxon_names`. Decision 033 rejected a local table of that name as its first
-- proposal and recorded the rejection "so it is not proposed a third time". This is the
-- opposite object: it asserts nothing, holds nothing, and can only ever say what the
-- register says.
--
-- TWO ANSWERS PER ROW, because the page needs both and they differ.
--
--   common_name        what the register calls THIS entity. For an ecotype that is
--                      "Bigg's killer whale"; for most individuals it is their nickname.
--   taxon_common_name  what it calls the TAXON the entity belongs to — "Killer whale" for
--                      anything under Orcinus orca, however deep.
--
-- The page prefers the first where the group chain proves an ecotype and falls back to the
-- second, which is a composition rule and therefore ours (animals ADR-0011). The register
-- supplies both strings and neither is invented here.
--
-- LATERAL rather than calling register.taxon_for() twice: it is STABLE, not IMMUTABLE, so
-- the planner is under no obligation to collapse two identical calls into one. The LEFT is
-- defensive rather than load-bearing — that function is total over every entity today and
-- returns a scalar, so LATERAL yields a row either way. The name is fetched by a correlated
-- subquery for a reason that IS load-bearing: joining register.names would drop the 360
-- entities the register has not given a common name, and a caller would see no row at all
-- where it should see a row with NULL and fall back to the taxon.
CREATE VIEW public.animal_names AS
SELECT
  e.entity_id,
  -- Same tie-break as register.inaturalist_taxon_name, so the profile page and the map
  -- cannot disagree about what to call one animal: English first, then shortest, then
  -- alphabetical. `hidden` is excluded because ADR-0011 says it must never be displayed,
  -- and `preferred` because it is a designation ('J17s') rather than a name.
  (SELECT n.name FROM register.names n
    WHERE n.entity_id = e.entity_id AND n.type = 'common'
    ORDER BY (n.language = 'en') DESC NULLS LAST, length(n.name), n.name
    LIMIT 1) AS common_name,
  t.entity_id AS taxon_entity_id,
  t.vernacular_name AS taxon_common_name
FROM register.entities e
LEFT JOIN LATERAL register.taxon_for(e.entity_id) t ON true;

COMMENT ON VIEW public.animal_names IS
  'The register''s display names, reachable from the browser: what it calls an entity, and '
  'what it calls the taxon that entity belongs to. A read-only projection of register.* — '
  'it asserts nothing of its own. Exists because the `register` schema is not exposed to '
  'PostgREST and the profile page has no occurrence to carry a resolved name for it.';

-- REVOKE BEFORE GRANT, and it is not ceremony. Supabase sets ALTER DEFAULT PRIVILEGES on
-- the `public` schema, so a new object here arrives already granting anon and authenticated
-- REFERENCES, TRIGGER and TRUNCATE — none of which anything asked for. The register tables
-- added in 20260921010000 show the contrast: they live in `register`, where no such default
-- applies, and came out holding SELECT alone. supabase/public-grants.test.ts is what caught
-- this, and salish-cuu tracks the default itself.
--
-- The grant that remains is load-bearing rather than defensive: unlike the register tables,
-- which anon may read but PostgREST never exposes, the browser fetches this view directly.
REVOKE ALL ON public.animal_names FROM anon, authenticated;
GRANT SELECT ON public.animal_names TO anon, authenticated;
