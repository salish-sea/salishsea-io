-- The catalogue's three views over the register (decision 064, salish-9uu.2.3): which
-- group each group sits inside, which matrilines each individual belongs to, and the names
-- the register gives each entity. Twins of public.group_parents, public.matriline_members
-- and public.animal_names, which Postgres computes over its copy of the register; here
-- over the release the build fetched (ingest-register.ts). Run after derive/sources.sql,
-- derive/shared.sql and derive/lookups.sql, in the same session.
--
-- Each is written under the name the snapshot gave Postgres's view, one document per row
-- with its keys in jsonb's order (shorter first, then bytewise), so the pages and the
-- profile links read them unchanged. The groups and individuals they hang from are the
-- catalogue's own rows, read from their documents.

CREATE OR REPLACE TEMP VIEW catalogue_groups AS
  SELECT CAST(json_extract_string(doc, '$.id') AS INTEGER) AS id,
         json_extract_string(doc, '$.entity_id') AS entity_id,
         json_extract_string(doc, '$.kind') AS kind
  FROM snapshot.social_groups;

CREATE OR REPLACE TEMP VIEW catalogue_individuals AS
  SELECT CAST(json_extract_string(doc, '$.id') AS INTEGER) AS id,
         json_extract_string(doc, '$.entity_id') AS entity_id
  FROM snapshot.individuals;

-- public.group_parents: each group's nearest enclosing group, by the register's closure.
-- A group's ancestor is its parent unless another of its ancestors that is one of ours
-- sits beneath it.
CREATE OR REPLACE TABLE snapshot.group_parents AS
  SELECT CAST(to_json({'group_id': g.id, 'parent_group_id': p.id}) AS VARCHAR) AS doc
  FROM catalogue_groups g
  JOIN register.ancestor a ON a.entity_id = g.entity_id
  JOIN catalogue_groups p ON p.entity_id = a.ancestor_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM register.ancestor other
    JOIN catalogue_groups o ON o.entity_id = other.ancestor_id
    JOIN register.ancestor beneath
      ON beneath.entity_id = other.ancestor_id AND beneath.ancestor_id = a.ancestor_id
    WHERE other.entity_id = g.entity_id);

-- public.matriline_members: every matriline an individual is in (decision 050), with the
-- innermost of them.
CREATE OR REPLACE TABLE snapshot.matriline_members AS
  WITH lineage AS (
    SELECT i.id AS individual_id, g.id AS group_id, g.entity_id AS group_entity_id
    FROM catalogue_individuals i
    JOIN register.ancestor a ON a.entity_id = i.entity_id
    JOIN catalogue_groups g ON g.entity_id = a.ancestor_id AND g.kind = 'matriline'
  ),
  innermost AS (
    SELECT l.individual_id, l.group_id
    FROM lineage l
    WHERE NOT EXISTS (
      SELECT 1
      FROM lineage inner_l
      JOIN register.ancestor a ON a.entity_id = inner_l.group_entity_id AND a.ancestor_id = l.group_entity_id
      WHERE inner_l.individual_id = l.individual_id)
  )
  SELECT CAST(to_json({
           'group_id': l.group_id,
           'individual_id': l.individual_id,
           'innermost_group_id': n.group_id
         }) AS VARCHAR) AS doc
  FROM lineage l
  JOIN innermost n ON n.individual_id = l.individual_id;

-- public.animal_names: for every register entity, its preferred common name, the taxon it
-- is or sits under and that taxon's common name, and the scientific name of the
-- iNaturalist taxon it maps to (followed past retirement). Postgres reads that last from
-- its own copy of iNaturalist's taxa; here it is the mirror's (salish-xv35.9.3).
CREATE OR REPLACE TABLE snapshot.animal_names AS
  SELECT CAST(to_json({
           'entity_id': e.entity_id,
           'common_name': (SELECT n.name FROM entity_common_name n WHERE n.entity_id = e.entity_id),
           'taxon_entity_id': tf.entity_id,
           'taxon_common_name': tf.vernacular_name,
           'inaturalist_scientific_name': (
             SELECT cur.scientific_name
             FROM source_inaturalist_taxa rec
             JOIN source_inaturalist_taxa cur ON cur.id = coalesce(rec.current_taxon_id, rec.id)
             WHERE rec.id = it.inaturalist_taxon_id)
         }) AS VARCHAR) AS doc
  FROM register.entities e
  LEFT JOIN taxon_entity te ON te.entity_id = e.entity_id
  LEFT JOIN taxon_for tf ON tf.entity_id = te.taxon_entity_id
  LEFT JOIN inaturalist_taxon it ON it.entity_id = e.entity_id;
