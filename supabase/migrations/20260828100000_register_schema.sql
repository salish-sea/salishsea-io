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
  'One row. The release tag and register.db digest this schema was loaded from — the '
  '`register_edition` a consumer is expected to record (animals ADR-0006/0013).';

-- Columns mirror the published TSVs. Text, because the register''s own types are text:
-- an SSA identifier is opaque (ADR-0002) and a rank is an open vocabulary (ADR-0004).
CREATE TABLE register.entities (
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
-- A name is looked up by what someone typed, so the search direction is indexed too.
CREATE INDEX names_name_idx ON register.names (lower(name));

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
SELECT
  split_part(m.object_id, ':', 2)::integer AS inat_taxon_id,
  e.entity_id,
  e.label   AS entity_label,
  n.name    AS common_name
FROM register.mappings m
JOIN register.entities e ON e.entity_id = m.subject_id
JOIN register.names    n ON n.entity_id = e.entity_id AND n.type = 'common'
WHERE m.predicate_id = 'skos:exactMatch'
  AND m.object_id LIKE 'inaturalist.taxon:%'
  AND split_part(m.object_id, ':', 2) ~ '^[0-9]+$';

COMMENT ON VIEW register.inaturalist_taxon_name IS
  'iNaturalist taxon id -> the register''s common name for that animal. Exact matches '
  'only; see the view definition for why broadMatch is excluded.';

-- SELECT grants ship with the tables that need them (CLAUDE.md): without these the
-- occurrences view''s join silently returns nothing for anon, which is the whole app.
GRANT USAGE ON SCHEMA register TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA register TO anon, authenticated;
