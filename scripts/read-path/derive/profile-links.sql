-- The profile pages' links to sightings, derived in the build (decision 061,
-- salish-xv35.13): DuckDB twins of the four Postgres views a page reads to place its
-- subject's sightings, as supabase/migrations/20260928120000_occurrences_stored.sql
-- (group_, individual_ and ecotype_occurrences) and 20260919010000_haulouts.sql
-- (haulout_occurrences) last define them, and of public.acoustic_identifications, which
-- three of them read.
--
-- Twins, not improvements: each keeps its view's quirks, because the result is checked
-- against Postgres's own answer, read in the same snapshot (compare-profile-links.ts).
-- Each relation is written as the snapshot holds Postgres's: one `doc` per row, the
-- document to_jsonb makes of it, keys in jsonb's order (shorter first, then bytewise).
--
-- Reads build.occurrences and build.occurrence_identifier_candidates, which the build
-- derived; the identifications our users assert, and Orcasound's bout entities, as the
-- snapshot copied them; and the catalogue as the snapshot holds it (documents). Run by
-- derive-profile-links.ts after derive/shared.sql and derive/haulout-nearby.sql, and
-- after memory.haulout_distance has been written (derive/haulout-distance.ts).

-- --- What the views read ----------------------------------------------------------------

CREATE OR REPLACE TEMP VIEW occurrence AS
  SELECT id, observed_at, location FROM build.occurrences;

-- derived.occurrence_identifier_candidates. Its location is a lon_lat there, never NULL.
CREATE OR REPLACE TEMP VIEW candidate AS
  SELECT occurrence_id, code, individual_id, social_group_id, observed_at,
         {'lat': location_lat, 'lon': location_lon} AS location
  FROM build.occurrence_identifier_candidates;

CREATE OR REPLACE TEMP VIEW identification AS
  SELECT occurrence_id, individual_id, social_group_id, is_present, status, evidence, code, certainty
  FROM public.identifications;

CREATE OR REPLACE TEMP VIEW individual AS
  SELECT CAST(doc->>'id' AS INTEGER) AS id, doc->>'entity_id' AS entity_id, doc->>'life_status' AS life_status
  FROM snapshot.individuals;

CREATE OR REPLACE TEMP VIEW social_group AS
  SELECT CAST(doc->>'id' AS INTEGER) AS id, doc->>'entity_id' AS entity_id, doc->>'kind' AS kind,
         doc->>'designation' AS designation
  FROM snapshot.social_groups;

-- A matriline's living members: `matriline_members mm JOIN individuals mi ON ... AND
-- mi.life_status NOT IN ('deceased', 'presumed_deceased')`, the parenthesised join the
-- individual view hangs a group's sighting on. A NULL life_status is not NOT IN anything,
-- so it is left out here as there.
CREATE OR REPLACE TEMP VIEW living_member AS
  SELECT CAST(mm.doc->>'group_id' AS INTEGER) AS group_id, mi.id AS individual_id
  FROM snapshot.matriline_members mm
  JOIN individual mi ON mi.id = CAST(mm.doc->>'individual_id' AS INTEGER)
                    AND mi.life_status NOT IN ('deceased', 'presumed_deceased');

-- public.acoustic_identifications: one claim per (bout, cited entity) that has a subject
-- here, with the moderator's certainty, on the occurrence the Orcasound view derives for
-- that entity's taxon.
CREATE OR REPLACE TEMP VIEW acoustic_identification AS
  SELECT 'orcasound:' || e.bout_id || ':' || te.taxon_entity_id AS occurrence_id,
         i.id AS individual_id,
         CASE WHEN i.id IS NULL THEN g.id END AS social_group_id,
         ent.label AS code,
         e.certainty
  FROM source_acoustic_bout_entities e
  JOIN register.entities ent ON ent.entity_id = e.entity_id
  LEFT JOIN individual i ON i.entity_id = e.entity_id
  LEFT JOIN social_group g ON g.entity_id = e.entity_id
  JOIN taxon_entity te ON te.entity_id = e.entity_id
  WHERE (i.id IS NOT NULL OR g.id IS NOT NULL)
    AND te.taxon_entity_id IS NOT NULL;

CREATE SCHEMA IF NOT EXISTS build;

-- --- public.group_occurrences ------------------------------------------------------------

CREATE OR REPLACE TABLE build.group_occurrences AS
  WITH link AS (
    SELECT s.social_group_id, s.occurrence_id, o.observed_at, o.location,
           s.is_present, s.status, s.evidence, s.code, s.certainty
    FROM identification s
    JOIN occurrence o ON o.id = s.occurrence_id
    WHERE s.social_group_id IS NOT NULL
    UNION ALL
    SELECT c.social_group_id, c.occurrence_id, c.observed_at, c.location,
           true, 'candidate', 'text_mention', c.code, CAST(NULL AS VARCHAR)
    FROM candidate c
    WHERE c.social_group_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM identification s
                      WHERE s.occurrence_id = c.occurrence_id AND s.social_group_id = c.social_group_id)
    UNION ALL
    SELECT a.social_group_id, a.occurrence_id, o.observed_at, o.location,
           true, 'candidate', 'acoustic', a.code, a.certainty
    FROM acoustic_identification a
    JOIN occurrence o ON o.id = a.occurrence_id
    WHERE a.social_group_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM identification s
                      WHERE s.occurrence_id = a.occurrence_id AND s.social_group_id = a.social_group_id)
  )
  SELECT CAST(to_json({
           'code': code,
           'status': status,
           'evidence': evidence,
           'location': pg_lon_lat(location),
           'certainty': certainty,
           'is_present': is_present,
           'observed_at': pg_ts(observed_at),
           'occurrence_id': occurrence_id,
           'social_group_id': social_group_id
         }) AS VARCHAR) AS doc
  FROM link;

-- --- public.individual_occurrences -------------------------------------------------------
-- A sighting of a matriline is a sighting of each of its living members, named via_group.

CREATE OR REPLACE TABLE build.individual_occurrences AS
  WITH link AS (
    SELECT coalesce(s.individual_id, mm.individual_id) AS individual_id,
           s.occurrence_id, o.observed_at, o.location, s.is_present, s.status, s.evidence, s.code,
           CASE WHEN s.individual_id IS NULL THEN g.designation END AS via_group,
           s.certainty
    FROM identification s
    LEFT JOIN living_member mm ON s.individual_id IS NULL AND mm.group_id = s.social_group_id
    LEFT JOIN social_group g ON g.id = s.social_group_id
    JOIN occurrence o ON o.id = s.occurrence_id
    WHERE coalesce(s.individual_id, mm.individual_id) IS NOT NULL
    UNION ALL
    SELECT coalesce(c.individual_id, mm.individual_id),
           c.occurrence_id, c.observed_at, c.location, true, 'candidate', 'text_mention', c.code,
           CASE WHEN c.individual_id IS NULL THEN g.designation END,
           CAST(NULL AS VARCHAR)
    FROM candidate c
    LEFT JOIN living_member mm ON c.individual_id IS NULL AND mm.group_id = c.social_group_id
    LEFT JOIN social_group g ON g.id = c.social_group_id
    WHERE (c.individual_id IS NOT NULL OR c.social_group_id IS NOT NULL)
      AND coalesce(c.individual_id, mm.individual_id) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM identification s
        WHERE s.occurrence_id = c.occurrence_id
          AND s.individual_id IS NOT DISTINCT FROM c.individual_id
          AND s.social_group_id IS NOT DISTINCT FROM c.social_group_id)
    UNION ALL
    SELECT coalesce(a.individual_id, mm.individual_id),
           a.occurrence_id, o.observed_at, o.location, true, 'candidate', 'acoustic', a.code,
           CASE WHEN a.individual_id IS NULL THEN g.designation END,
           a.certainty
    FROM acoustic_identification a
    LEFT JOIN living_member mm ON a.individual_id IS NULL AND mm.group_id = a.social_group_id
    LEFT JOIN social_group g ON g.id = a.social_group_id
    JOIN occurrence o ON o.id = a.occurrence_id
    WHERE coalesce(a.individual_id, mm.individual_id) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM identification s
        WHERE s.occurrence_id = a.occurrence_id
          AND s.individual_id IS NOT DISTINCT FROM a.individual_id
          AND s.social_group_id IS NOT DISTINCT FROM a.social_group_id)
  )
  SELECT CAST(to_json({
           'code': code,
           'status': status,
           'evidence': evidence,
           'location': pg_lon_lat(location),
           'certainty': certainty,
           'via_group': via_group,
           'is_present': is_present,
           'observed_at': pg_ts(observed_at),
           'individual_id': individual_id,
           'occurrence_id': occurrence_id
         }) AS VARCHAR) AS doc
  FROM link;

-- --- public.ecotype_occurrences ----------------------------------------------------------
-- A sighting of any group or individual under an ecotype, by the register's ancestry.
-- UNION, not UNION ALL, as the view: the same sighting reached twice is one row.

CREATE OR REPLACE TABLE build.ecotype_occurrences AS
  WITH group_to_ecotype AS (
    SELECT g.id AS group_id, e.id AS ecotype_id
    FROM social_group g
    JOIN register.ancestor a ON a.entity_id = g.entity_id
    JOIN social_group e ON e.entity_id = a.ancestor_id AND e.kind = 'ecotype'
    UNION ALL
    SELECT e.id, e.id FROM social_group e WHERE e.kind = 'ecotype'
  ),
  individual_to_ecotype AS (
    SELECT i.id AS individual_id, e.id AS ecotype_id
    FROM individual i
    JOIN register.ancestor a ON a.entity_id = i.entity_id
    JOIN social_group e ON e.entity_id = a.ancestor_id AND e.kind = 'ecotype'
  ),
  link AS (
    SELECT gte.ecotype_id, c.occurrence_id, c.observed_at, c.location,
           true AS is_present, 'candidate' AS status, CAST(NULL AS VARCHAR) AS certainty
    FROM candidate c
    JOIN group_to_ecotype gte ON gte.group_id = c.social_group_id
    WHERE c.social_group_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM identification s
                      WHERE s.occurrence_id = c.occurrence_id AND s.social_group_id = c.social_group_id)
    UNION
    SELECT ite.ecotype_id, c.occurrence_id, c.observed_at, c.location,
           true, 'candidate', CAST(NULL AS VARCHAR)
    FROM candidate c
    JOIN individual_to_ecotype ite ON ite.individual_id = c.individual_id
    WHERE c.individual_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM identification s
                      WHERE s.occurrence_id = c.occurrence_id AND s.individual_id = c.individual_id)
    UNION
    SELECT gte.ecotype_id, a.occurrence_id, o.observed_at, o.location,
           true, 'candidate', a.certainty
    FROM acoustic_identification a
    JOIN occurrence o ON o.id = a.occurrence_id
    JOIN group_to_ecotype gte ON gte.group_id = a.social_group_id
    WHERE a.social_group_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM identification s
                      WHERE s.occurrence_id = a.occurrence_id AND s.social_group_id = a.social_group_id)
    UNION
    SELECT ite.ecotype_id, a.occurrence_id, o.observed_at, o.location,
           true, 'candidate', a.certainty
    FROM acoustic_identification a
    JOIN occurrence o ON o.id = a.occurrence_id
    JOIN individual_to_ecotype ite ON ite.individual_id = a.individual_id
    WHERE a.individual_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM identification s
                      WHERE s.occurrence_id = a.occurrence_id AND s.individual_id = a.individual_id)
    UNION
    SELECT gte.ecotype_id, s.occurrence_id, o.observed_at, o.location, s.is_present, s.status, s.certainty
    FROM identification s
    JOIN occurrence o ON o.id = s.occurrence_id
    JOIN group_to_ecotype gte ON gte.group_id = s.social_group_id
    WHERE s.social_group_id IS NOT NULL
    UNION
    SELECT ite.ecotype_id, s.occurrence_id, o.observed_at, o.location, s.is_present, s.status, s.certainty
    FROM identification s
    JOIN occurrence o ON o.id = s.occurrence_id
    JOIN individual_to_ecotype ite ON ite.individual_id = s.individual_id
    WHERE s.individual_id IS NOT NULL
  )
  SELECT CAST(to_json({
           'status': status,
           'location': pg_lon_lat(location),
           'certainty': certainty,
           'ecotype_id': ecotype_id,
           'is_present': is_present,
           'observed_at': pg_ts(observed_at),
           'occurrence_id': occurrence_id
         }) AS VARCHAR) AS doc
  FROM link;

-- --- public.haulout_occurrences ----------------------------------------------------------
-- The pairs derive/haulout-nearby.sql found, kept within the site's radius by the distance
-- derive/haulout-distance.ts measured. Everything else a row shows is the occurrence's own,
-- so it is taken from the occurrence's document, already rendered as to_jsonb renders it.
-- The species a report resolves to groups a subspecies with its species; a report filed
-- at genus or family rank keeps its own name.

CREATE OR REPLACE TABLE build.haulout_occurrences AS
  -- Each kept report's fields taken out of its document in one parse, as a list in the
  -- order the paths are named. Taken one `->` at a time instead, DuckDB runs a 128 MB
  -- budget out on these two thousand rows.
  WITH kept AS (
    SELECT d.haulout_id, d.distance_m, o.id AS occurrence_id,
           json_extract(o.doc, ['$.url', '$.body', '$.taxon', '$.photos', '$.accuracy', '$.location',
                                '$.observer', '$.attribution', '$.observed_at']) AS f
    FROM memory.haulout_distance d
    JOIN build.occurrences o ON o.id = d.occurrence_id
    WHERE d.distance_m <= d.radius_m
  )
  SELECT CAST(to_json({
           'url': f[1],
           'body': f[2],
           'taxon': f[3],
           'photos': f[4],
           'accuracy': f[5],
           'location': f[6],
           'observer': f[7],
           'distance_m': distance_m,
           'haulout_id': haulout_id,
           'attribution': f[8],
           'observed_at': f[9],
           'species_name': coalesce(sp.vernacular_name, sp.scientific_name,
                                    f[3]->>'vernacular_name', f[3]->>'scientific_name'),
           'occurrence_id': occurrence_id
         }) AS VARCHAR) AS doc
  FROM kept
  LEFT JOIN source_inaturalist_taxa sp ON sp.id = CAST(f[3]->>'species_id' AS INTEGER);
