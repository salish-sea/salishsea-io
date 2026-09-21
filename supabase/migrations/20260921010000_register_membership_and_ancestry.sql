-- The register's group structure, and a taxon for any entity in it (salish-53t.1).
--
-- Until now this schema held entities, names and mappings: enough to answer "what is this
-- animal called", which is all decision 033 needed. It could not answer "what IS this
-- animal" for anything that is not a taxon. J pod has no iNaturalist taxon id, so nothing
-- keyed on `inaturalist.taxa` can place it, and an Orcasound bout — whose identity is a
-- register entity and nothing else — has no species to put on the map (salish-8vr.26).
--
-- The register already knows. `dist/ancestor.tsv` is the transitive closure of membership,
-- and it runs all the way into the taxon:
--
--   SSA:0000020  J pod  ->  SSA:0000011  J clan            depth 1
--                       ->  SSA:0000010  Southern Resident depth 2
--                       ->  SSA:0000003  Resident          depth 3
--                       ->  SSA:0000900  Orcinus orca      depth 4   <- kind = taxon
--
-- WHY BOTH membership AND ancestor. `membership` is the register's assertion — the edges a
-- curator wrote, with the start/end dates that make a matriline's history checkable.
-- `ancestor` is derived from it by the register's own builder. Loading only the edges
-- would mean re-deriving the closure here in a recursive CTE, which is a second
-- implementation of someone else's rule and would drift from it silently; loading only the
-- closure would throw away the dates and the provenance. So both, with the closure marked
-- as derived so nobody edits it expecting the register to agree.
--
-- The first `dist/` artefacts this loader reads. ADR-0013 makes dist/ part of the
-- published distribution rather than a build by-product, so this is reading the
-- publication, not reaching into someone's working tree.

-- ---------------------------------------------------------------------------
-- Deprecations, loaded first because the resolver below depends on them.
-- ---------------------------------------------------------------------------

CREATE TABLE register.deprecations (
  entity_id    text PRIMARY KEY REFERENCES register.entities (entity_id) ON DELETE CASCADE,
  reason       text NOT NULL,
  replaced_by  text REFERENCES register.entities (entity_id),
  consider     text,
  date         text,
  source_id    text,
  note         text
);

COMMENT ON TABLE register.deprecations IS
  'Retired identifiers and where they went (animals ADR-0002). `replaced_by` is set for a '
  'merge, where substitution is safe; a split sets `consider` instead and leaves '
  '`replaced_by` NULL, because no single successor is correct. Nothing here should be '
  'followed blindly for a split — salish-8vr.5 carries that question.';

-- ---------------------------------------------------------------------------
-- Membership: the asserted edges.
-- ---------------------------------------------------------------------------

CREATE TABLE register.membership (
  member_id  text NOT NULL REFERENCES register.entities (entity_id) ON DELETE CASCADE,
  group_id   text NOT NULL REFERENCES register.entities (entity_id) ON DELETE CASCADE,
  start      text,
  "end"      text,
  source_id  text,
  note       text
);
CREATE INDEX membership_member_idx ON register.membership (member_id);
CREATE INDEX membership_group_idx  ON register.membership (group_id);

-- Not a primary key on (member_id, group_id): an animal can leave a group and rejoin it,
-- which is two rows differing only in their dates. The register permits that and so must
-- this. The constraint below is the one that actually holds — a duplicate including the
-- dates is a corrupt load, not history.
--
-- NULLS NOT DISTINCT, and without it this constraint would be decorative. A plain UNIQUE
-- treats every NULL as distinct, so two identical rows with no end date would both be
-- accepted — and in edition 2026.09.3 ALL 1,001 membership rows have a NULL end, because
-- an open membership is the normal case and a closed one the exception. The constraint
-- would have guarded precisely nothing. Requires PG 15+; local and production are 17.6.
ALTER TABLE register.membership ADD CONSTRAINT membership_unique
  UNIQUE NULLS NOT DISTINCT (member_id, group_id, start, "end");

COMMENT ON TABLE register.membership IS
  'Which entity belongs to which group, as the register asserts it. `start` and `end` are '
  'the register''s own text dates, not parsed here. "end" is quoted because it is a '
  'reserved word; the column is named for the published column and not renamed.';

-- ---------------------------------------------------------------------------
-- Ancestor: the closure, derived upstream.
-- ---------------------------------------------------------------------------

CREATE TABLE register.ancestor (
  entity_id      text NOT NULL REFERENCES register.entities (entity_id) ON DELETE CASCADE,
  ancestor_id    text NOT NULL REFERENCES register.entities (entity_id) ON DELETE CASCADE,
  depth          integer NOT NULL,
  ancestor_label text,
  ancestor_kind  text,
  ancestor_rank  text,
  PRIMARY KEY (entity_id, ancestor_id)
);
CREATE INDEX ancestor_entity_kind_idx ON register.ancestor (entity_id, ancestor_kind);

COMMENT ON TABLE register.ancestor IS
  'DERIVED, not asserted: the transitive closure of register.membership, computed by the '
  'register''s own builder and published in dist/. Do not edit it and do not recompute it '
  'here — a second implementation of the closure would drift from the register''s silently. '
  'No depth-0 self row: an entity is not its own ancestor in this table, which is why '
  'register.taxon_entity_for() tests `kind = ''taxon''` before it looks for an ancestor.';

-- ---------------------------------------------------------------------------
-- The resolver: any entity -> the taxon entity it belongs to.
-- ---------------------------------------------------------------------------
--
-- Two hops, in this order.
--
-- FOLLOW A DEPRECATION FIRST. SSA:0000001 is the only non-taxon entity of 733 that reaches
-- no taxon ancestor, and it is a tombstone: Q1 settled that Southern Resident is a
-- community within the Resident ecotype rather than an ecotype itself, so it merged into
-- SSA:0000010. The register's own note says "substitution is safe: both identifiers always
-- denoted the same animals". Following `replaced_by` makes this function total — 733 of
-- 733 — and matches decision 032, which already resolves retired iNaturalist taxa on read.
-- A SPLIT deprecation sets `consider` and leaves `replaced_by` NULL, so it falls through to
-- NULL here rather than guessing; salish-8vr.5 decides what should happen instead.
--
-- THEN TAKE THE TAXON. If the entity is itself `kind = 'taxon'` it is its own answer, which
-- has to be tested separately because the closure carries no depth-0 row. Otherwise the
-- nearest taxon ancestor wins — `ORDER BY depth` rather than `min(depth)` over a set,
-- because an entity has exactly one taxon ancestor in practice and the ordering states
-- which would win if that ever stopped being true.
--
-- SECURITY DEFINER, deliberately. A SQL function's body is checked against the CALLER, not
-- the owner, and the planner may inline it into a view that would otherwise run with
-- definer rights. Migration 20260829040000 learned this the hard way: a table read added
-- inside a function broke production for `anon` while working perfectly as postgres. The
-- grants below cover `anon` anyway, so this is belt and braces — but the belt is what
-- broke last time.
CREATE FUNCTION register.taxon_entity_for(p_entity_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = register, pg_catalog
AS $$
  WITH resolved AS (
    SELECT COALESCE(d.replaced_by, e.entity_id) AS entity_id
    FROM register.entities e
    LEFT JOIN register.deprecations d ON d.entity_id = e.entity_id
    WHERE e.entity_id = p_entity_id
  )
  SELECT COALESCE(
    -- Itself, when it is already a taxon.
    (SELECT e.entity_id FROM register.entities e
      JOIN resolved r ON r.entity_id = e.entity_id
     WHERE e.kind = 'taxon'),
    -- Otherwise the nearest taxon above it.
    (SELECT a.ancestor_id FROM register.ancestor a
      JOIN resolved r ON r.entity_id = a.entity_id
     WHERE a.ancestor_kind = 'taxon'
     ORDER BY a.depth
     LIMIT 1)
  );
$$;

COMMENT ON FUNCTION register.taxon_entity_for(text) IS
  'The taxon entity an entity belongs to: itself if it is a taxon, else its nearest taxon '
  'ancestor, following a merge deprecation first. NULL for an entity the register cannot '
  'place — today only a split deprecation, which has no single correct successor.';

-- ---------------------------------------------------------------------------
-- The whole taxon, for a source whose identity is a register entity.
-- ---------------------------------------------------------------------------
--
-- This is what a fifth branch of public.occurrences needs (salish-8vr.26): an Orcasound
-- bout cites register entities and nothing else, so it must build a `public.taxon` without
-- an iNaturalist taxon id to start from. Every other branch starts from `inaturalist.taxa`
-- and reaches the register for a name; this goes the other way.
--
-- The four fields, and where each comes from:
--
--   scientific_name  the taxon entity's label. It is the register's canonical designation
--                    for a taxon, which for `kind = taxon` is the scientific name.
--   vernacular_name  its `common` name, with the SAME tie-break as
--                    register.inaturalist_taxon_name so the two cannot disagree about what
--                    to call one animal: English first, then shortest, then alphabetical.
--   species_id       the crosswalked iNaturalist id, normalised to species level.
--   entity_id        the TAXON entity, not the entity asked about. `SHORT_MAP_FORMS` in
--                    src/symbology.ts keys on this to shorten a name, so it has to be the
--                    thing being named. Which pod or matriline a bout cited is carried by
--                    the occurrence's identifiers, not by its taxon.
--
-- WHY species_id GOES THROUGH THE MIRROR. src/segments.ts refuses to chain two occurrences
-- into one track when their species_id differs, so a bout must carry the same value a
-- sighting of the same animal does or the two will never join. That value is defined by
-- inaturalist.species_id() — the species-level id, with a subspecies rolled up to its
-- parent — so this asks that function rather than reimplementing the rule. Where the
-- mirror has no row for the crosswalked id, the id passes through unnormalised: the
-- register's taxon entities crosswalk to species-level taxa, so there is nothing to roll
-- up, and a NULL here would silently stop tracks chaining.
--
-- NULL when the entity reaches no taxon, rather than a row of NULLs: the caller's LEFT
-- JOIN should see no taxon at all, not an occurrence claiming to be an unnamed animal.
--
-- IT STOPS AT THE SPECIES, AND WALKS PAST THE ECOTYPE ON THE WAY. A Bigg's matriline
-- resolves to `Orcinus orca` / "Killer whale", not to SSA:0000002 / "Bigg's killer whale",
-- even though that ecotype now has both a name and an iNaturalist crosswalk of its own
-- (edition 2026.09.2, decision 033's Amendment). Three reasons, and the first is the one
-- that decides it:
--
--   1. An ecotype is `kind = 'group'`, not `kind = 'taxon'`. Animals ADR-0008 is explicit
--      that an ecotype "is not a taxonomic rank ... not making any claim about formal
--      taxonomy". A `public.taxon` built from one would put a group where a taxon goes.
--   2. `species_id` has a job: src/segments.ts refuses to chain occurrences whose
--      species_id differs. Keying a Bigg's bout on the rectipinnus id would stop it ever
--      chaining with a sighting recorded as plain Orcinus orca, which is most of them.
--   3. The ecotype is not lost. It reaches the map through the label rather than the
--      taxon — `labelForSegment` already answers "Biggs" or "SRKW" from prose, and a
--      bout's cited entities belong in the occurrence's identifiers. Decision 029 wants
--      that distinction shown, and this is where it is shown.
--
-- So the rule is: the taxon says what SPECIES it is, the label says which whales. Changing
-- that is a decision about salish-8vr.26's branch, not a tweak to this function.
CREATE FUNCTION register.taxon_for(p_entity_id text)
RETURNS public.taxon
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = register, public, pg_catalog
AS $$
  WITH t AS (SELECT register.taxon_entity_for(p_entity_id) AS entity_id),
  inat AS (
    SELECT split_part(m.object_id, ':', 2)::integer AS inat_taxon_id
    FROM register.mappings m JOIN t ON t.entity_id = m.subject_id
    WHERE m.predicate_id IN ('skos:exactMatch', 'skos:closeMatch')
      AND m.object_id ~ '^inaturalist\.taxon:[0-9]{1,9}$'
    ORDER BY (m.predicate_id = 'skos:exactMatch') DESC
    LIMIT 1
  )
  SELECT ROW(
    e.label::character varying,
    (SELECT n.name FROM register.names n
      WHERE n.entity_id = e.entity_id AND n.type = 'common'
      ORDER BY (n.language = 'en') DESC NULLS LAST, length(n.name), n.name
      LIMIT 1)::character varying,
    COALESCE(
      (SELECT inaturalist.species_id(x.*) FROM inaturalist.taxa x
        WHERE x.id = (SELECT inat_taxon_id FROM inat)),
      (SELECT inat_taxon_id FROM inat)
    ),
    e.entity_id
  )::public.taxon
  FROM register.entities e JOIN t ON t.entity_id = e.entity_id;
$$;

COMMENT ON FUNCTION register.taxon_for(text) IS
  'A public.taxon for any register entity — the taxon it belongs to, named as the register '
  'names it. For a source keyed on register identifiers rather than iNaturalist ones '
  '(Orcasound bouts). NULL where the entity reaches no taxon.';

-- ---------------------------------------------------------------------------
-- Grants. Migration 20260828100000's `GRANT SELECT ON ALL TABLES` was one-shot and does
-- NOT reach a table added later, which is exactly this case. Without these a future
-- security_invoker view, or exposing the schema to PostgREST, fails silently for anon.
-- ---------------------------------------------------------------------------

GRANT SELECT ON register.deprecations, register.membership, register.ancestor
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION register.taxon_entity_for(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION register.taxon_for(text) TO anon, authenticated;
