-- The DwC-A classification comes from the register, except its kingdom (salish-53t.2).
--
-- `dwc.taxa_classification` walked `inaturalist.taxa.parent_id` recursively and pivoted the
-- ranks into kingdom…genus. That is a mirror's vocabulary reaching an external contract,
-- which decision 008 forbids for exactly the reason it forbids it in the UI: we do not
-- control iNaturalist's hierarchy and cannot stabilize it. Register edition 2026.09.2
-- publishes `dist/classification.tsv` — the same six ranks, excerpted from NCBI by script
-- and never curated (animals ADR-0022) — so the export can read the register instead.
--
-- WHAT A CONSUMER ACTUALLY RECEIVES DOES NOT CHANGE, AND THAT IS THE POINT.
--
-- Measured against production before writing this: for all 12 exported taxa the register
-- covers, `phylum`, `class`, `order`, `family` and `genus` are ALREADY IDENTICAL to what
-- the recursive walk produced. The only column that differed was `kingdom` — iNaturalist
-- says `Animalia`, NCBI says `Metazoa` — and this migration keeps `Animalia`. So this is a
-- change of PROVENANCE, not of data: the same values, sourced from the authority we have
-- adopted rather than from a mirror. Nobody should merge this expecting the archive to
-- improve, and nobody should revert it expecting the archive to change back.
--
-- KINGDOM IS DELIBERATELY NOT THE REGISTER'S, and this is the one place we knowingly
-- decline what it asserts. NCBI's kingdom for animals is `Metazoa`; GBIF's own backbone
-- taxonomy uses `Animalia`, and this column exists to be read by GBIF. Emitting `Metazoa`
-- would be a faithful reading of the register that made 20,952 records harder to match
-- against the backbone they are published into. Decision 047 records the trade and the
-- fact that it is an inconsistency on purpose — see it before "fixing" this line.
--
-- THE FALLBACK IS NOT OPTIONAL, because this view is INNER JOINed by both branches of
-- `dwc.occurrences`. A taxon missing from here does not lose its classification columns;
-- the occurrence DISAPPEARS FROM THE ARCHIVE. The register covers 12 of the 18 exported
-- taxa, so a naive cutover would have silently dropped 4,955 of 20,952 records — 23.6% —
-- and the export coverage check would have reported a smaller archive as a healthy one.
--
-- Two mechanisms close that gap, in order:
--
--   1. A SUBSPECIES RESOLVES TO ITS SPECIES FIRST. The register holds species and
--      ecotypes, not subspecies, so `Orcinus orca ater` (4,707 records), `O. o.
--      rectipinnus` (222), `Phoca vitulina richardii` (20) and `Eumetopias jubatus
--      monteriensis` (2) have no entity of their own. Their species does, and a
--      subspecies' classification above genus is its species' by construction. This is
--      what the recursive walk did implicitly by finding higher ancestors; here it is
--      explicit.
--   2. ANYTHING STILL UNMATCHED KEEPS THE ITERATIVE WALK. `Delphinapterus leucas` (1
--      record) and `Eubalaena` (3) have no register entity at all — the register scopes
--      itself to the Salish Sea's animals and these are strays. 4 records, and without
--      this branch they would vanish.
--
-- So the view is register-first, iNaturalist-second, and the second is load-bearing rather
-- than defensive. `dwc.export_coverage` (migration 20260910200000) is what would notice if
-- both failed at once.

-- THE SHAPE IS UNCHANGED, DOWN TO THE COLUMN NAMES. Nine columns, `order_` with its
-- trailing underscore, and `genus` still gated on the record's own rank so a family-level
-- record does not claim a genus it was never identified to. Only the SOURCE of phylum…
-- genus moves. A first draft of this migration dropped `taxon_rank`, `scientific_name` and
-- that gate; `CREATE OR REPLACE VIEW` refused it outright ("cannot drop columns from
-- view"), which is the one part of this change Postgres was willing to catch on its own.
CREATE OR REPLACE VIEW dwc.taxa_classification AS
WITH RECURSIVE
-- Unchanged from the original: iNaturalist's own ancestry, resolving retired taxa on the
-- way up (decision 032). Retained as the fallback, and as the source of the species-level
-- id the register is looked up by.
ancestors AS (
  SELECT t_recorded.id AS leaf_id, t.id AS ancestor_id, t.parent_id, t.rank,
         t.scientific_name, 0 AS depth
    FROM inaturalist.taxa t_recorded
    JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
  UNION ALL
  SELECT a.leaf_id, p.id, p.parent_id, p.rank, p.scientific_name, a.depth + 1
    FROM ancestors a
    JOIN inaturalist.taxa p_recorded ON p_recorded.id = a.parent_id
    JOIN inaturalist.taxa p ON p.id = COALESCE(p_recorded.current_taxon_id, p_recorded.id)
   WHERE a.depth < 50
),
inat AS (
  SELECT a.leaf_id AS taxon_id,
         max(CASE WHEN a.rank = 'kingdom'::inaturalist.rank THEN a.scientific_name END::text) AS kingdom,
         max(CASE WHEN a.rank = 'phylum'::inaturalist.rank  THEN a.scientific_name END::text) AS phylum,
         max(CASE WHEN a.rank = 'class'::inaturalist.rank   THEN a.scientific_name END::text) AS class,
         max(CASE WHEN a.rank = 'order'::inaturalist.rank   THEN a.scientific_name END::text) AS order_,
         max(CASE WHEN a.rank = 'family'::inaturalist.rank  THEN a.scientific_name END::text) AS family,
         max(CASE WHEN a.rank = 'genus'::inaturalist.rank   THEN a.scientific_name END::text) AS genus
    FROM ancestors a GROUP BY a.leaf_id
),
-- The register entity for each taxon, reached through the SPECIES rather than the leaf, so
-- a subspecies inherits its species' lineage. inaturalist.species_id() is asked rather than
-- reimplemented -- it is the same function public.occurrences uses, and a second copy of
-- "which id counts as the species" would drift from it.
reg AS (
  SELECT t.id AS taxon_id, c.phylum, c.class, c."order" AS order_, c.family, c.genus
    FROM inaturalist.taxa t
    JOIN register.inaturalist_taxon_name x
      ON x.inat_taxon_id = COALESCE(inaturalist.species_id(t.*), COALESCE(t.current_taxon_id, t.id))
    JOIN register.classification c ON c.entity_id = x.entity_id
)
SELECT
  t_recorded.id AS taxon_id,
  t.rank::text  AS taxon_rank,
  t.scientific_name,
  -- NOT the register's kingdom. See the header: GBIF's backbone says Animalia and this
  -- column is read by GBIF. iNaturalist agrees, so taking it from `p` keeps one source
  -- rather than hard-coding a literal no authority stands behind.
  p.kingdom,
  COALESCE(r.phylum, p.phylum) AS phylum,
  COALESCE(r.class,  p.class)  AS class,
  COALESCE(r.order_, p.order_) AS order_,
  COALESCE(r.family, p.family) AS family,
  -- The gate is unchanged and applies to the register's genus too: a record identified
  -- only to a family has no genus, whichever authority supplied the lineage.
  CASE WHEN t.rank = ANY (ARRAY['genus'::inaturalist.rank, 'genushybrid'::inaturalist.rank,
                                'subgenus'::inaturalist.rank, 'species'::inaturalist.rank,
                                'complex'::inaturalist.rank, 'section'::inaturalist.rank,
                                'subsection'::inaturalist.rank, 'hybrid'::inaturalist.rank,
                                'subspecies'::inaturalist.rank, 'variety'::inaturalist.rank,
                                'form'::inaturalist.rank, 'infrahybrid'::inaturalist.rank])
       THEN COALESCE(r.genus, p.genus)
       ELSE NULL::text
  END AS genus
FROM inaturalist.taxa t_recorded
JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
JOIN inat p ON p.taxon_id = t_recorded.id
LEFT JOIN reg r ON r.taxon_id = t_recorded.id;
