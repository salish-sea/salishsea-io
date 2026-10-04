-- The upstream sources the occurrences are derived from, as the build's own mirrors hold
-- them (decision 061, salish-xv35.9), in the shape of the snapshot's copies of Postgres's
-- tables, so the twins of Postgres's views read them unchanged.
--
-- Run first, by derive-occurrences.ts and derive-profile-links.ts, after attaching each
-- mirror under the name Stelis reads it by: maplify_mirror, inaturalist_mirror, orcasound.
--
-- A mirror holds only what upstream said (decision 008, as 061 applies it). What Postgres
-- adds when it stores a row is added here the way Postgres adds it: the provider and
-- collection are column defaults, chosen by slug; iNaturalist's source_url is generated
-- from its uri; Maplify's is NULL. Maplify's entity and collection are resolved later in
-- the derivation (salish-xv35.11), so they are not here at all.

-- Every column is cast to the snapshot's type for it: SQLite has only INTEGER and REAL.

-- maplify.sightings. created_at is Maplify's own 'YYYY-MM-DD HH:MM:SS', the timestamp
-- without zone Postgres stores.
CREATE OR REPLACE TEMP VIEW source_maplify_sightings AS
  SELECT CAST(id AS INTEGER) AS id, name, scientific_name,
         CAST(lon AS DOUBLE) AS location_lon, CAST(lat AS DOUBLE) AS location_lat,
         CAST(number_sighted AS INTEGER) AS number_sighted,
         CAST(created_at AS TIMESTAMP) AS created_at, photo_url, comments,
         is_test <> 0 AS is_test, trusted <> 0 AS trusted, source, usernm,
         (SELECT id FROM public.providers WHERE slug = 'maplify') AS provider_id,
         CAST(NULL AS VARCHAR) AS source_url
  FROM maplify_mirror.sightings;

-- inaturalist.observations. observed_at is iNaturalist's ISO 8601 with its offset.
CREATE OR REPLACE TEMP VIEW source_inaturalist_observations AS
  SELECT CAST(id AS BIGINT) AS id, description,
         CAST(lon AS DOUBLE) AS location_lon, CAST(lat AS DOUBLE) AS location_lat,
         CAST(observed_at AS TIMESTAMPTZ) AS observed_at, uri, login AS username,
         CAST(taxon_id AS INTEGER) AS taxon_id,
         CAST(public_positional_accuracy AS INTEGER) AS public_positional_accuracy,
         (SELECT id FROM public.providers WHERE slug = 'inaturalist') AS provider_id,
         (SELECT id FROM public.collections WHERE slug = 'inaturalist') AS collection_id,
         uri AS source_url
  FROM inaturalist_mirror.observations;

CREATE OR REPLACE TEMP VIEW source_inaturalist_observation_photos AS
  SELECT CAST(id AS BIGINT) AS id, CAST(observation_id AS BIGINT) AS observation_id,
         CAST(seq AS SMALLINT) AS seq, attribution, hidden <> 0 AS hidden, license, url
  FROM inaturalist_mirror.observation_photos;

-- inaturalist.taxa. The mirror holds the taxa its observations reach. Postgres's table
-- holds more: every taxon an ingest ever reached, which the register's mappings may name
-- for another source's sighting. Those come from the snapshot until the register's
-- taxa are fetched in the build too; where both hold a taxon, the mirror's is newer.
CREATE OR REPLACE TEMP VIEW source_inaturalist_taxa AS
  SELECT CAST(id AS INTEGER) AS id, CAST(parent_id AS INTEGER) AS parent_id, scientific_name,
         vernacular_name, rank, CAST(current_taxon_id AS INTEGER) AS current_taxon_id
  FROM inaturalist_mirror.taxa
  UNION ALL
  SELECT id, parent_id, scientific_name, vernacular_name, rank, current_taxon_id
  FROM inaturalist.taxa
  WHERE id NOT IN (SELECT id FROM inaturalist_mirror.taxa);

-- public.acoustic_bouts and its entities, as Orcasound's moderators published them.
CREATE OR REPLACE TEMP VIEW source_acoustic_bouts AS
  SELECT id, feed_name, title, CAST(lon AS DOUBLE) AS location_lon, CAST(lat AS DOUBLE) AS location_lat,
         CAST(started_at AS TIMESTAMPTZ) AS started_at, CAST(ended_at AS TIMESTAMPTZ) AS ended_at,
         (SELECT id FROM public.providers WHERE slug = 'orcasound') AS provider_id,
         (SELECT id FROM public.collections WHERE slug = 'orcasound') AS collection_id
  FROM orcasound.bouts;

CREATE OR REPLACE TEMP VIEW source_acoustic_bout_entities AS
  SELECT bout_id, entity_id, certainty FROM orcasound.bout_entities;
