BEGIN;
CREATE TABLE ferry_locations (vessel_id INT NOT NULL, "timestamp" int not null, vessel_name text not null, longitude real not null, latitude real not null, heading int, in_service int not null, at_dock int not null);
CREATE INDEX ferry_location_timestamp ON ferry_locations (timestamp);
CREATE TABLE maplify_sightings (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id int not null, trip_id int not null, name text not null, scientific_name text not null, latitude real not null, longitude real not null, number_sighted integer not null, created number not null, photo_url text, comments text, in_ocean int not null, count_check int not null, moderated int not null, trusted int not null, is_test int not null, source text not null, usernm text, icon text, taxon_id int);
CREATE INDEX maplify_sightings_created ON maplify_sightings (created);
CREATE TABLE taxa(id integer primary key, parent_id integer, scientific_name text not null, taxon_rank text not null, updated_at int not null, vernacular_name text, species_id int);
CREATE INDEX taxa_scientific_name on taxa(scientific_name );
CREATE TABLE taxon_vernacular_names (taxon_id int not null, name varchar not null);
CREATE INDEX taxon_vernacular_names_taxon_id on taxon_vernacular_names (taxon_id);
CREATE TABLE IF NOT EXISTS "vernacular_names_temp"(
"id" TEXT, "vernacularName" TEXT, "language" TEXT, "locality" TEXT,
 "countryCode" TEXT, "source" TEXT, "lexicon" TEXT, "contributor" TEXT,
 "created" TEXT);
CREATE TABLE inaturalist_observations (id int not null primary key, description text, longitude real not null, latitude real not null, taxon_id integer not null, observed_at int not null, license_code varchar, photos_json json, url string not null, username string not null);
CREATE INDEX inaturalist_observations_observed_at on inaturalist_observations (observed_at);
CREATE TABLE sightings (id text primary key not null, created_at integer not null, updated_at integer not null, user text not null, observed_at int not null, longitude real not null, latitude real not null, observer_longitude real, observer_latitude real, taxon_id int not null, body text, count int, individuals text, url text, direction text);
CREATE TABLE sighting_photos (id integer primary key not null, sighting_id text not null REFERENCES sightings (id) ON DELETE CASCADE, idx integer not null, href text not null, license_code text not null, unique(id, idx));
CREATE INDEX sighting_photos_by_sighting_id ON sighting_photos (sighting_id);
CREATE TABLE users (id integer primary key autoincrement, sub text not null unique, name text, nickname text, email text, updated_at int not null);
DROP VIEW IF EXISTS combined_observations;
CREATE VIEW combined_observations AS
SELECT
  s.*,
  coalesce(t.vernacular_name, t.scientific_name) AS name,
  t.scientific_name,
  t.vernacular_name
FROM (
  SELECT
    'maplify:' || id AS id,
    comments AS body,
    iif(number_sighted > 0, number_sighted) AS count,
    null AS direction,
    latitude,
    longitude,
    created AS timestamp,
    iif(photo_url IS NOT NULL, json_array(json_object('url', photo_url))) AS photos_json,
    source,
    null AS url,
    null AS path,
    null AS userName,
    null AS userSub,
    taxon_id
  FROM maplify_sightings

  UNION ALL

  SELECT
    'inaturalist:' || id AS id,
    description AS body,
    null AS count,
    null AS direction,
    latitude,
    longitude,
    observed_at AS "timestamp",
    photos_json,
    'iNaturalist' AS source,
    url,
    null AS path,
    username AS userName,
    null AS userSub,
    taxon_id
  FROM inaturalist_observations

  UNION ALL

  SELECT
    'salishsea:' || s.id AS id,
    body,
    count,
    direction,
    latitude,
    longitude,
    observed_at AS "timestamp",
    (SELECT json_group_array(json_object('url', href)) FROM sighting_photos WHERE sighting_id = s.id) AS photos_json,
    'salishsea',
    url,
    '/api/sightings/' || s.id AS path,
    coalesce(u.name, u.nickname, 'someone') AS userName,
    s.user AS userSub,
    taxon_id
  FROM sightings AS s
  LEFT JOIN users AS u ON s.user = u.sub
) AS s
JOIN taxa t ON s.taxon_id = t.id;
COMMIT;
