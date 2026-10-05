-- iNaturalist's taxa as the build's mirror holds them, in the shape of the snapshot's
-- copy of Postgres's inaturalist.taxa (decision 061). Its own file, apart from
-- derive/sources.sql, because the catalogue's views (derive/catalogue.sql) read the taxa
-- and no other source: run alone after attaching inaturalist_mirror, that task needs
-- only the mirror it reads to exist (sources.ts's attachTaxa).
--
-- inaturalist.taxa. The mirror holds the taxa its observations reach and, since
-- salish-xv35.9.3, every taxon the register's mappings name — which it may for another
-- source's sighting — kept current by the ingest's rolling refresh. Postgres's copy is
-- no longer read: it was the last of its upstream tables the build still needed.
CREATE OR REPLACE TEMP VIEW source_inaturalist_taxa AS
  SELECT CAST(id AS INTEGER) AS id, CAST(parent_id AS INTEGER) AS parent_id, scientific_name,
         vernacular_name, rank, CAST(current_taxon_id AS INTEGER) AS current_taxon_id
  FROM inaturalist_mirror.taxa;
