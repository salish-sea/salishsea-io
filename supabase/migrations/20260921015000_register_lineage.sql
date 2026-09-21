-- NCBI's lineage, as the register excerpts it (salish-53t.2).
--
-- Register edition 2026.09.2 answers what a taxon is descended from, which it previously
-- could not. Animals ADR-0022 makes that hierarchy a script-generated excerpt of NCBI's
-- lineage, in NCBI's own namespace, minting no `SSA:` identifiers and curating nothing —
-- the register delegates taxonomy rather than asserting it, which is the same posture
-- ADR-0008 takes for species identity.
--
-- Loaded here so `dwc.taxa_classification` can stop walking `inaturalist.taxa.parent_id`
-- for the ranks it publishes to GBIF. Two of these three tables have no consumer yet and
-- are loaded anyway: they are one artefact of one edition, and a loader that takes part of
-- a publication is harder to reason about than one that takes all of it.
--
-- REPORTED VERBATIM, INCLUDING WHERE IT SURPRISES. NCBI's kingdom for animals is `Metazoa`,
-- not `Animalia`, and a whale's order is `Artiodactyla` rather than the `Cetacea` a reader
-- may expect. Neither is corrected on the way in. Where we decline to publish one of these
-- values — and `kingdom` is the only such case — that happens at the point of publication
-- and is recorded there, so this schema stays a faithful copy of what was released.

-- NCBI's parent-of relation. Keyed on NCBI identifiers, not `SSA:` ones, because no
-- identifier is minted for anything in it.
CREATE TABLE register.taxonomic_parent (
  taxon_id         text PRIMARY KEY,
  parent_id        text,
  rank             text,
  scientific_name  text,
  source_id        text
);

COMMENT ON TABLE register.taxonomic_parent IS
  'NCBI''s lineage for every taxon the register points at, in NCBI''s identifiers, ranks '
  'and names (animals ADR-0022). Fetched by the register''s bin/import_taxonomy.py and '
  'never edited. No consumer here yet; loaded because it is part of the edition.';

-- The closure of the above, published in dist/. Unlike register.ancestor this one DOES
-- carry a depth-0 self row, which is a difference between two upstream artefacts rather
-- than an inconsistency here — worth stating because the two tables look alike.
CREATE TABLE register.taxon_ancestor (
  taxon_id       text NOT NULL,
  ancestor_id    text NOT NULL,
  depth          integer NOT NULL,
  ancestor_rank  text,
  ancestor_name  text,
  PRIMARY KEY (taxon_id, ancestor_id)
);

COMMENT ON TABLE register.taxon_ancestor IS
  'DERIVED: the closure of register.taxonomic_parent, computed by the register''s builder. '
  'Each taxon is its own ancestor at depth 0 — unlike register.ancestor, which has no self '
  'row. No consumer here yet; loaded because it is part of the edition.';

-- The pivot a DarwinCore record actually wants: one row per taxon entity, six ranks.
CREATE TABLE register.classification (
  entity_id        text PRIMARY KEY REFERENCES register.entities (entity_id) ON DELETE CASCADE,
  label            text,
  taxon_id         text,
  scientific_name  text,
  taxon_rank       text,
  kingdom          text,
  phylum           text,
  class            text,
  "order"          text,
  family           text,
  genus            text
);

COMMENT ON TABLE register.classification IS
  'kingdom…genus per taxon entity, pivoted from NCBI''s lineage by the register. Read by '
  'dwc.taxa_classification for every rank BELOW kingdom; `kingdom` here says `Metazoa`, '
  'which the export deliberately does not publish (decision 047). Covers the register''s '
  'taxon entities only — a taxon it has no entity for is absent, and the export falls back '
  'to iNaturalist rather than dropping the record.';

GRANT SELECT ON register.taxonomic_parent, register.taxon_ancestor, register.classification
  TO anon, authenticated;
