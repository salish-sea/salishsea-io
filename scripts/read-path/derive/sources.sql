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

-- public.acoustic_bouts and its entities, as Orcasound's moderators published them.
-- Postgres's ingest kept biophony bouts only (decision 013: the other two categories
-- name no organism); the mirror holds every category, and the scope rule is applied
-- here, as Maplify's and iNaturalist's are (salish-xv35.18).
CREATE OR REPLACE TEMP VIEW source_acoustic_bouts AS
  SELECT id, feed_name, title, CAST(lon AS DOUBLE) AS location_lon, CAST(lat AS DOUBLE) AS location_lat,
         CAST(started_at AS TIMESTAMPTZ) AS started_at, CAST(ended_at AS TIMESTAMPTZ) AS ended_at,
         (SELECT id FROM public.providers WHERE slug = 'orcasound') AS provider_id,
         (SELECT id FROM public.collections WHERE slug = 'orcasound') AS collection_id
  FROM orcasound.bouts
  WHERE category = 'biophony';

-- A bout's tags arrive as whole chains: a moderator tapping J pod applies Southern
-- Resident, Killer whale and Cetacean too, as OrcaHello stores `J pod;srkw;orca;whale`
-- and as bouts have been tagged by hand (orcasound/orcasite#1077, salish-8vr.32). Each
-- cited entity that a more specific one on the same bout implies is dropped, so a J pod
-- bout names J pod and not also Southern Resident, nor a Cetacea occurrence beside its
-- orca one; a population's or pod's page still finds it, rolling up by the register's
-- ancestry (profile-links.sql). Unless the implied one is the surer claim: "certainly
-- Southern Resident, possibly L pod" keeps both, or the certainty would be lost to the
-- hedge. An unhedged claim (NULL) is the surest, as the occurrence's certainty counts it
-- (occurrences.sql); the rest in public.identification_certainty's order. Not a twin:
-- Postgres's view kept every one.
--
-- What an entity implies: the groups and species above it (register.ancestor, which stops
-- at the species), and the taxa above its taxon (register.taxon_ancestor, over the
-- taxonomy's ids, back to the register's entities for them).
CREATE OR REPLACE TEMP VIEW register_implies AS
  WITH taxon_of AS (
    -- an entity's taxon in the taxonomy: its own, if it is a taxon, else its species'
    SELECT e.entity_id,
           coalesce(
             (SELECT c.taxon_id FROM register.classification c WHERE c.entity_id = e.entity_id),
             (SELECT c.taxon_id FROM register.ancestor a
              JOIN register.classification c ON c.entity_id = a.ancestor_id
              WHERE a.entity_id = e.entity_id AND a.ancestor_kind = 'taxon'
              ORDER BY a.depth LIMIT 1)) AS taxon_id
    FROM register.entities e
  )
  SELECT entity_id, ancestor_id AS implied_id FROM register.ancestor
  UNION
  SELECT o.entity_id, up.entity_id
  FROM taxon_of o
  JOIN register.taxon_ancestor ta ON ta.taxon_id = o.taxon_id AND ta.depth > 0
  JOIN register.classification up ON up.taxon_id = ta.ancestor_id AND up.entity_id <> o.entity_id;

CREATE OR REPLACE TEMP VIEW source_acoustic_bout_entities AS
  WITH cited AS (
    SELECT e.bout_id, e.entity_id, e.certainty,
           coalesce(list_position(['possible', 'probable', 'certain'], e.certainty), 4) AS sureness
    FROM orcasound.bout_entities e
    JOIN orcasound.bouts b ON b.id = e.bout_id AND b.category = 'biophony'
  )
  SELECT c.bout_id, c.entity_id, c.certainty
  FROM cited c
  WHERE NOT EXISTS (
    SELECT 1
    FROM cited below
    JOIN register_implies i ON i.entity_id = below.entity_id AND i.implied_id = c.entity_id
    WHERE below.bout_id = c.bout_id AND below.sureness >= c.sureness
  );
