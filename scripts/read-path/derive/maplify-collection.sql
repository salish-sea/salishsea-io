-- Which collection a Maplify sighting came through (decision 061). Its own file, apart
-- from derive/lookups.sql, because it reads the Maplify mirror and the collection rules,
-- which only the occurrences and the Darwin Core archive need: a task that runs the
-- lookups for the register and the taxa alone (derive-catalogue.ts) needn't have them.
-- Run after derive/sources.sql and derive/lookups.sql.

-- maplify.resolve_collection(comments, source): which collection a Maplify sighting came
-- through, by the curator-editable rules in maplify.collection_rule. A leading [bracket
-- tag] first, then an attribution phrase anywhere in the comments, then Maplify's source
-- code. Postgres leaves that precedence to the order of a UNION ALL under LIMIT 1, and
-- the order among rules of one kind to chance; here both are explicit, the second by rule
-- id. An attribution rule's value is a regular expression, run here by RE2 rather than
-- Postgres; today's are all plain phrases, and the gate would name the first that isn't.
-- Resolved in the build rather than read from the column the ingest wrote, so the mirror
-- holds only what Maplify said (decision 061, salish-xv35.11).
CREATE OR REPLACE TEMP VIEW maplify_collection AS
  SELECT s.id,
         coalesce(
           (SELECT r.collection_id FROM maplify.collection_rule r
             WHERE r.match_kind = 'bracket' AND regexp_matches(s.comments, '^\[([^\]]+)\]')
               AND r.match_value = regexp_extract(s.comments, '^\[([^\]]+)\]', 1)
             ORDER BY r.id LIMIT 1),
           (SELECT r.collection_id FROM maplify.collection_rule r
             WHERE r.match_kind = 'attribution' AND regexp_matches(s.comments, r.match_value)
             ORDER BY r.id LIMIT 1),
           (SELECT r.collection_id FROM maplify.collection_rule r
             WHERE r.match_kind = 'source' AND r.match_value = s.source
             ORDER BY r.id LIMIT 1)
         ) AS collection_id
  FROM source_maplify_sightings s;
