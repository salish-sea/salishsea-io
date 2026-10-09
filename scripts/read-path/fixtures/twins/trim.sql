-- Applied after seed.sql, before the capture (salish-9uu.11): cut the catalogue, the
-- register, iNaturalist's taxa and the haul-out sites down to what the seeded sightings
-- reach, so the fixture is small enough to read. Postgres computed its answers after
-- this, over the same rows the fixture holds. Like seed.sql, kept as the record of how
-- the fixture was made; nothing runs it any more.

BEGIN;

-- The catalogue: the Bigg's ecotype and two of its matrilines, T065As and T137s, with
-- every matriline inside them, every animal in them, and those animals' parents.
CREATE TEMP TABLE keep_group AS
  SELECT g.id, g.entity_id FROM public.social_groups g
  WHERE g.designation = 'Biggs'
     OR (g.kind = 'matriline' AND (g.entity_id IN ('SSA:0002163', 'SSA:0002078')
         OR EXISTS (SELECT 1 FROM register.ancestor a
                    WHERE a.entity_id = g.entity_id AND a.ancestor_id IN ('SSA:0002163', 'SSA:0002078'))));
CREATE TEMP TABLE keep_ind AS
  WITH RECURSIVE kin AS (
    SELECT DISTINCT m.individual_id AS id FROM public.matriline_members m
    WHERE m.group_id IN (SELECT id FROM keep_group)
    UNION
    SELECT p.parent FROM public.individuals i JOIN kin ON i.id = kin.id,
           LATERAL (VALUES (i.mother_id), (i.father_id)) AS p(parent)
    WHERE p.parent IS NOT NULL
  )
  SELECT id FROM kin;

-- The register: what the catalogue keeps, what the sightings name, the populations and
-- J pod the Orcasound bout is tagged with, and every ancestor of any of them.
CREATE TEMP TABLE keep_seed AS
  SELECT entity_id FROM keep_group WHERE entity_id IS NOT NULL
  UNION SELECT entity_id FROM public.individuals WHERE id IN (SELECT id FROM keep_ind) AND entity_id IS NOT NULL
  UNION SELECT unnest(ARRAY['SSA:0000900', 'SSA:0000901', 'SSA:0000904', 'SSA:0000001', 'SSA:0000002',
                            'SSA:0000003', 'SSA:0000010', 'SSA:0000020', 'SSA:0000101', 'SSA:0020047'])
  UNION SELECT subject_id FROM register.mappings
        WHERE object_id IN ('inaturalist.taxon:41521', 'inaturalist.taxon:1602533', 'inaturalist.taxon:41566',
                            'inaturalist.taxon:41708');
CREATE TEMP TABLE keep_entity AS
  SELECT entity_id FROM keep_seed
  UNION SELECT a.ancestor_id FROM register.ancestor a WHERE a.entity_id IN (SELECT entity_id FROM keep_seed);

-- iNaturalist's taxa: those the sightings and the kept register entities name, and
-- every taxon above them.
CREATE TEMP TABLE keep_taxon AS
  WITH RECURSIVE up AS (
    SELECT t.id FROM inaturalist.taxa t
    WHERE t.id IN (41521, 1602533, 41566, 41708)
       OR t.id IN (SELECT CAST(replace(m.object_id, 'inaturalist.taxon:', '') AS integer) FROM register.mappings m
                   WHERE m.object_id LIKE 'inaturalist.taxon:%' AND m.subject_id IN (SELECT entity_id FROM keep_entity))
    UNION
    SELECT t.parent_id FROM inaturalist.taxa t JOIN up ON t.id = up.id WHERE t.parent_id IS NOT NULL
  )
  SELECT id FROM up;

DELETE FROM public.nicknames
 WHERE (individual_id IS NOT NULL AND individual_id NOT IN (SELECT id FROM keep_ind))
    OR (social_group_id IS NOT NULL AND social_group_id NOT IN (SELECT id FROM keep_group));
UPDATE public.designations SET superseded_by = NULL
 WHERE superseded_by IN (SELECT id FROM public.designations WHERE individual_id NOT IN (SELECT id FROM keep_ind));
DELETE FROM public.designations WHERE individual_id NOT IN (SELECT id FROM keep_ind);
DELETE FROM public.social_groups WHERE id NOT IN (SELECT id FROM keep_group);
DELETE FROM public.individuals WHERE id NOT IN (SELECT id FROM keep_ind);

DELETE FROM register.membership
 WHERE member_id NOT IN (SELECT entity_id FROM keep_entity) OR group_id NOT IN (SELECT entity_id FROM keep_entity);
DELETE FROM register.ancestor
 WHERE entity_id NOT IN (SELECT entity_id FROM keep_entity) OR ancestor_id NOT IN (SELECT entity_id FROM keep_entity);
DELETE FROM register.deprecations
 WHERE entity_id NOT IN (SELECT entity_id FROM keep_entity) OR replaced_by NOT IN (SELECT entity_id FROM keep_entity);
DELETE FROM register.names WHERE entity_id NOT IN (SELECT entity_id FROM keep_entity);
DELETE FROM register.mappings WHERE subject_id NOT IN (SELECT entity_id FROM keep_entity);
DELETE FROM register.classification WHERE entity_id NOT IN (SELECT entity_id FROM keep_entity);
DELETE FROM register.current_status WHERE entity_id NOT IN (SELECT entity_id FROM keep_entity);
DELETE FROM register.taxon_ancestor
 WHERE taxon_id NOT IN (SELECT taxon_id FROM register.entities WHERE entity_id IN (SELECT entity_id FROM keep_entity) AND taxon_id IS NOT NULL);
DELETE FROM register.taxonomic_parent
 WHERE taxon_id NOT IN (SELECT taxon_id FROM register.taxon_ancestor);
DELETE FROM register.entities WHERE entity_id NOT IN (SELECT entity_id FROM keep_entity);

UPDATE inaturalist.taxa SET current_taxon_id = NULL WHERE current_taxon_id NOT IN (SELECT id FROM keep_taxon);
DELETE FROM inaturalist.taxa WHERE id NOT IN (SELECT id FROM keep_taxon);

-- Three haul-out sites, the seal's among them.
DELETE FROM public.haulouts WHERE id NOT IN (170, 171, 172);

SELECT public.refresh_individual_vitals();
SELECT derived.refresh_all();

COMMIT;
