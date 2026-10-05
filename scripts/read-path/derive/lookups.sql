-- The lookups more than one derivation joins (decision 061): iNaturalist's taxa and their
-- species, and the register's names and its iNaturalist crosswalk; which collection a
-- Maplify sighting came through is derive/maplify-collection.sql. Twins of the Postgres
-- objects each names, quirks kept, as derive/occurrences.sql's are. Run after derive/sources.sql and derive/shared.sql,
-- before derive/occurrences.sql and derive/dwc.sql.

-- --- Shared shapes ---------------------------------------------------------------------

-- pg_ts, pg_float and pg_lon_lat (how to_jsonb renders a timestamp and a coordinate) and
-- taxon_entity (register.taxon_entity_for) are in derive/shared.sql, which runs first:
-- the profile links' twins use them too.

-- An enum label's position in its type's declared order, for the two comparisons that
-- use it.
CREATE OR REPLACE TEMP VIEW rank_position AS
  SELECT label AS rank, position FROM types.enums WHERE type = 'inaturalist.rank';
CREATE OR REPLACE TEMP VIEW certainty_position AS
  SELECT label AS certainty, position FROM types.enums WHERE type = 'public.identification_certainty';

-- inaturalist.species_id(taxon): the species a taxon is, or is under. Below species, its
-- parent (followed past retirement); at species, itself; above, nothing. "Below" is the
-- rank enum's order: rank < 'species'.
CREATE OR REPLACE TEMP VIEW taxa AS
  SELECT t.*,
         CASE
           WHEN r.position < (SELECT position FROM rank_position WHERE rank = 'species')
             THEN (SELECT coalesce(p.current_taxon_id, p.id) FROM source_inaturalist_taxa p WHERE p.id = t.parent_id)
           WHEN t.rank = 'species' THEN coalesce(t.current_taxon_id, t.id)
           ELSE NULL
         END AS species_id
  FROM source_inaturalist_taxa t
  LEFT JOIN rank_position r ON r.rank = t.rank;

-- --- The register ----------------------------------------------------------------------

-- The common name the register prefers for an entity: English first, then the shortest,
-- then alphabetical. The correlated subquery in the Maplify and native views, and in
-- register.taxon_for.
CREATE OR REPLACE TEMP VIEW entity_common_name AS
  SELECT entity_id, name
  FROM register.names
  WHERE type = 'common'
  QUALIFY row_number() OVER (
    PARTITION BY entity_id
    ORDER BY (language = 'en') DESC NULLS LAST, length(name), name COLLATE en_us) = 1;

-- A mapping to an iNaturalist taxon, with the taxon id it names.
CREATE OR REPLACE TEMP VIEW inaturalist_mapping AS
  SELECT subject_id, predicate_id, object_id,
         CAST(split_part(object_id, ':', 2) AS INTEGER) AS inaturalist_taxon_id,
         predicate_id = 'skos:exactMatch' AS exact
  FROM register.mappings
  WHERE predicate_id IN ('skos:exactMatch', 'skos:closeMatch')
    AND regexp_full_match(object_id, 'inaturalist\.taxon:[0-9]{1,9}');

-- register.inaturalist_taxon: each entity's iNaturalist taxon, from itself, its nearest
-- mapped ancestor, or, for a deprecated entity, its replacement and that one's ancestors.
CREATE OR REPLACE TEMP VIEW inaturalist_taxon AS
  WITH candidate AS (
    SELECT e.entity_id, e.entity_id AS via, 0 AS depth FROM register.entities e
    UNION ALL
    SELECT a.entity_id, a.ancestor_id, a.depth FROM register.ancestor a
    UNION ALL
    SELECT d.entity_id, d.replaced_by, 1000000 FROM register.deprecations d WHERE d.replaced_by IS NOT NULL
    UNION ALL
    SELECT d.entity_id, a.ancestor_id, 1000000 + a.depth
    FROM register.deprecations d JOIN register.ancestor a ON a.entity_id = d.replaced_by
  )
  SELECT c.entity_id, m.inaturalist_taxon_id
  FROM candidate c JOIN inaturalist_mapping m ON m.subject_id = c.via
  QUALIFY row_number() OVER (
    PARTITION BY c.entity_id ORDER BY c.depth, m.exact DESC, m.object_id COLLATE en_us) = 1;

-- register.inaturalist_taxon_name: for each iNaturalist taxon an entity maps to, that
-- entity and its preferred common name. Only entities that have one.
CREATE OR REPLACE TEMP VIEW inaturalist_taxon_name AS
  SELECT m.inaturalist_taxon_id AS inat_taxon_id, e.entity_id, e.label AS entity_label, n.name AS common_name
  FROM inaturalist_mapping m
  JOIN register.entities e ON e.entity_id = m.subject_id
  JOIN register.names n ON n.entity_id = e.entity_id AND n.type = 'common'
  QUALIFY row_number() OVER (
    PARTITION BY m.inaturalist_taxon_id
    ORDER BY m.exact DESC, (n.language = 'en') DESC NULLS LAST, length(n.name), n.name COLLATE en_us) = 1;

-- register.taxon_for(entity), for a taxon entity: its label, preferred common name, the
-- species of the iNaturalist taxon it maps to (or that taxon itself when the mirror
-- doesn't hold it), and itself.
CREATE OR REPLACE TEMP VIEW taxon_for AS
  SELECT e.entity_id,
         e.label AS scientific_name,
         (SELECT name FROM entity_common_name n WHERE n.entity_id = e.entity_id) AS vernacular_name,
         coalesce(
           (SELECT x.species_id FROM taxa x WHERE x.id = inat.inaturalist_taxon_id),
           inat.inaturalist_taxon_id
         ) AS species_id
  FROM register.entities e
  LEFT JOIN (
    SELECT subject_id, inaturalist_taxon_id FROM inaturalist_mapping
    QUALIFY row_number() OVER (PARTITION BY subject_id ORDER BY exact DESC) = 1
  ) inat ON inat.subject_id = e.entity_id;
