-- Materialize the animals register (salish-ayb.5).
--
-- ADR-0012 in salish-sea/animals: "This register is authoritative for animal identity in
-- the Salish Sea. The SalishSea.io catalogue stops holding independent identity and
-- becomes a materialization of it." This schema is that materialization — the same
-- identifiers, loaded and presented.
--
-- NOT AN ANTI-CORRUPTION MIRROR, which is what distinguishes it from `inaturalist`,
-- `maplify` and `happywhale`. Decision 008 makes those verbatim landing zones whose
-- vocabulary must not reach our UI. The register is the opposite case: it is the
-- authority we have adopted, and its names are exactly what we intend to display. Both
-- are loaded from elsewhere; only one is allowed to be believed.
--
-- Loaded by scripts/register/load.ts from a pinned GitHub release, not from a working
-- tree. ADR-0014 frames the register as a publication rather than a service, so a
-- consumer records the edition it read — hence register.edition below, which answers
-- "which claims are these?" when a name later changes.

CREATE SCHEMA IF NOT EXISTS register;

COMMENT ON SCHEMA register IS
  'Materialization of the salish-sea/animals register (its ADR-0012). Authoritative for '
  'animal identity; unlike the per-source schemas, its vocabulary is meant to be shown.';

-- Which edition is loaded. ADR-0006 makes git history the assertion-time axis, so the
-- tag alone dates every row in here; the digest is what makes the claim checkable.
CREATE TABLE register.edition (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  tag        text NOT NULL,
  sha256     text NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE register.edition IS
  'One row. The release tag and the SHA-256 of register-tsv.tar.gz — the artefact these '
  'rows were actually loaded from, and the one the loader verified. Together they are the '
  '`register_edition` a consumer is expected to record (animals ADR-0006/0013). Note the '
  'digest attests provenance within a release, not authenticity: SHA256SUMS ships from '
  'the same release, so it detects corruption, not tampering.';

-- Columns mirror the published TSVs. Text, because the register''s own types are text:
-- an SSA identifier is opaque (ADR-0002) and a rank is an open vocabulary (ADR-0004).
CREATE TABLE register.entities (
  -- Mirrors the register's own constraint (its schema.sql), so a shape it would not
  -- publish cannot be loaded here either. Deliberately not looser: ADR-0002 makes the
  -- identifier opaque, and an opaque identifier with a stated format is still checkable.
  entity_id  text PRIMARY KEY CHECK (entity_id ~ '^SSA:[0-9]{7}$'),
  kind       text NOT NULL,
  rank       text,
  label      text NOT NULL,
  taxon_id   text,
  born       text,
  sex        text,
  source_id  text,
  note       text
);

CREATE TABLE register.names (
  entity_id  text NOT NULL REFERENCES register.entities (entity_id) ON DELETE CASCADE,
  name       text NOT NULL,
  type       text NOT NULL,
  language   text,
  source_id  text,
  note       text
);
CREATE INDEX names_entity_idx ON register.names (entity_id);

-- A duplicate row is a corrupt load, not data, so refuse it. NOT a unique constraint on
-- (entity_id) WHERE type='common', which would be the obvious way to guarantee the
-- crosswalk view returns one row per taxon: the register legitimately gives an entity
-- several common names — 38 do in edition 2026.08.1, individuals with two nicknames — so
-- that constraint would reject a valid edition outright. Uniqueness for display is the
-- view's job (see DISTINCT ON below); this only stops the same row loading twice.
ALTER TABLE register.names ADD CONSTRAINT names_unique UNIQUE (entity_id, name, type);

COMMENT ON COLUMN register.names.type IS
  'preferred | common | historical | hidden. A `hidden` name MATCHES but must never be '
  'DISPLAYED — it is evidence a string is in use, not a name the register offers '
  '(animals ADR-0011). Anything rendering a name must filter on this.';

CREATE TABLE register.mappings (
  subject_id             text NOT NULL REFERENCES register.entities (entity_id) ON DELETE CASCADE,
  predicate_id           text NOT NULL,
  object_id              text NOT NULL,
  object_label           text,
  mapping_justification  text,
  confidence             numeric,
  source_id              text,
  note                   text
);
CREATE INDEX mappings_object_idx ON register.mappings (object_id);
ALTER TABLE register.mappings ADD CONSTRAINT mappings_unique
  UNIQUE (subject_id, predicate_id, object_id);

-- ---------------------------------------------------------------------------
-- The crosswalk our occurrences actually travel.
--
-- Only `skos:exactMatch`. A broadMatch or closeMatch says the concepts are related, not
-- that they are the same animal, and resolving a display name through one would put a
-- narrower or wider claim on the map than the data supports — the register is explicit
-- that an ecotype is `skos:broadMatch` to its species precisely so this cannot happen.
--
-- Only `type = 'common'`. `preferred` is a canonical designation, often notation rather
-- than English ('J17s'); `hidden` must never be displayed. See the column comment above.
-- ---------------------------------------------------------------------------
CREATE VIEW register.inaturalist_taxon_name AS
SELECT DISTINCT ON (split_part(m.object_id, ':', 2)::integer)
  split_part(m.object_id, ':', 2)::integer AS inat_taxon_id,
  e.entity_id,
  e.label   AS entity_label,
  n.name    AS common_name
FROM register.mappings m
JOIN register.entities e ON e.entity_id = m.subject_id
JOIN register.names    n ON n.entity_id = e.entity_id AND n.type = 'common'
WHERE m.predicate_id = 'skos:exactMatch'
  -- The WHOLE identifier is matched, not a prefix plus one field. A prefix test with
  -- split_part accepts 'inaturalist.taxon:41777:legacy' — split_part returns 41777 and
  -- the trailing segment is never examined — so a malformed mapping would silently
  -- crosswalk as if it were the canonical one.
  --
  -- Length-bounded too: an unbounded digit string is still numeric and would overflow the
  -- ::integer cast at query time, breaking every read of public.occurrences rather than
  -- skipping one bad row.
  AND m.object_id ~ '^inaturalist\.taxon:[0-9]{1,9}$'
-- DISTINCT ON is load-bearing, not tidiness. public.occurrences LEFT JOINs this view, so
-- two rows for one taxon id would DUPLICATE every occurrence of that animal on the map —
-- silently, and only for the taxa that happened to acquire a second name.
--
-- Nothing upstream forbids it. 38 entities in edition 2026.08.1 already carry more than
-- one `common` row; they are individuals with two nicknames (Helena/Lucy) and none are
-- crosswalked, so the view is currently unique by luck rather than by design. An edition
-- that typed both 'Harbour seal' and 'Harbor seal' as common on one taxon would break the
-- map, and the register has no rule against doing so.
--
-- The tie-break is English first, then the shorter string, then alphabetical: stable
-- across reloads, and biased toward what a map label wants. It is a fallback, not an
-- editorial choice — a taxon with two common names is a question for the register, and
-- the short forms that actually belong to us live in salish-ayb.6 (animals ADR-0011).
--
-- It also masks a genuine upstream error: two entities claiming exactMatch to one iNat
-- taxon would be silently reduced to one here. That is the animals crosswalk check's job
-- to catch, not this view's — better a stable map than a duplicated one.
ORDER BY split_part(m.object_id, ':', 2)::integer,
         (n.language = 'en') DESC NULLS LAST,
         length(n.name),
         n.name;

COMMENT ON VIEW register.inaturalist_taxon_name IS
  'iNaturalist taxon id -> the register''s common name for that animal. Exact matches '
  'only; see the view definition for why broadMatch is excluded.';

-- SELECT grants ship with the tables that need them (CLAUDE.md). Note what they do NOT
-- do: public.occurrences is a plain view owned by postgres with no security_invoker, so
-- its join to this schema runs with definer rights and works for anon with or without
-- these. And `register` is not in PostgREST's exposed schemas (supabase/config.toml), so
-- the API cannot reach these tables directly either. The grants are here so that a future
-- security_invoker view, or an exposed schema, does not fail silently — not because
-- anything today depends on them.
--
-- ALL TABLES is one-shot: it covers what exists now, including the view below. A table
-- added by a later migration needs its own grant.
GRANT USAGE ON SCHEMA register TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA register TO anon, authenticated;
