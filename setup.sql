BEGIN;
CREATE TABLE ferry_locations (vessel_id INT NOT NULL, "timestamp" int not null, vessel_name text not null, longitude real not null, latitude real not null, heading int, in_service int not null, at_dock int not null);
CREATE INDEX ferry_location_timestamp ON ferry_locations (timestamp);
CREATE TABLE maplify_sightings (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id int not null, trip_id int not null, name text not null, scientific_name text not null, latitude real not null, longitude real not null, number_sighted integer not null, created number not null, photo_url text, comments text, in_ocean int not null, count_check int not null, moderated int not null, trusted int not null, is_test int not null, source text not null, usernm text, icon text, taxon_id int);
CREATE INDEX maplify_sightings_created ON maplify_sightings (created);
CREATE TABLE taxa(id integer primary key, parent_id integer, scientific_name text not null, taxon_rank text not null, updated_at int not null, vernacular_name text);
CREATE INDEX taxa_scientific_name on taxa(scientific_name );
CREATE TABLE taxon_vernacular_names (taxon_id int not null, name varchar not null);
CREATE INDEX taxon_vernacular_names_taxon_id on taxon_vernacular_names (taxon_id);
CREATE TABLE IF NOT EXISTS "vernacular_names_temp"(
"id" TEXT, "vernacularName" TEXT, "language" TEXT, "locality" TEXT,
 "countryCode" TEXT, "source" TEXT, "lexicon" TEXT, "contributor" TEXT,
 "created" TEXT);
CREATE TABLE inaturalist_observations (id int not null primary key, description text, longitude real not null, latitude real not null, taxon_id integer not null, observed_at int not null, license_code varchar, photos_json json, url string not null, username string not null);
CREATE INDEX inaturalist_observations_observed_at on inaturalist_observations (observed_at);
.import --csv taxa.csv taxa_temp
INSERT INTO taxa SELECT id, substring(parentNameUsageID, 34) AS int, scientificName, taxonRank, strftime('%s', modified), null from taxa_temp;
.import --csv VernacularNames-english.csv vernacular_names_temp
INSERT INTO taxon_vernacular_names SELECT id, vernacularName FROM vernacular_names_temp;
UPDATE taxa SET vernacular_name=n.vernacularName
  FROM (SELECT id, first_value(vernacularName) OVER (PARTITION BY id ORDER BY rowid) vernacularName FROM vernacular_names_temp GROUP BY id) n
  WHERE taxa.id = n.id;
COMMIT;
