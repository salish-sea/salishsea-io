BEGIN;
.import --csv taxa.csv taxa_temp
INSERT INTO taxa SELECT id, substring(parentNameUsageID, 34) AS int, scientificName, taxonRank, strftime('%s', modified), null, null from taxa_temp;
.import --csv VernacularNames-english.csv vernacular_names_temp
INSERT INTO taxon_vernacular_names SELECT id, vernacularName FROM vernacular_names_temp;
UPDATE taxa SET vernacular_name=n.vernacularName
  FROM (SELECT id, first_value(vernacularName) OVER (PARTITION BY id ORDER BY rowid) vernacularName FROM vernacular_names_temp GROUP BY id) n
  WHERE taxa.id = n.id;
UPDATE taxa SET species_id=parent_id WHERE taxon_rank='subspecies';
COMMIT;

VACUUM;
