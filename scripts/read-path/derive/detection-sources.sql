-- Orcasound's detections and OrcaHello's moderators' answers, as the build's own mirrors
-- hold them (salish-fizm.1, decision 122), for derive/detections.sql. Run by attachSources
-- after derive/sources.sql, only when both mirrors are attached as `orcasound_detections`
-- and `orcahello`; no other derivation reads them.
--
-- Only the columns the derivation reads. The mirrors keep more (OrcaHello's confidence and
-- its window labels, for the reliability score of salish-fizm.2), and none of what decision
-- 122 leaves out: a listener's description, a source address, a moderator's name or comment.

-- orcasite's detection. Its timestamp is ISO 8601 with a Z. SQLite has no boolean.
CREATE OR REPLACE TEMP VIEW source_orcasound_detections AS
  SELECT id, feed_id, CAST(timestamp AS TIMESTAMPTZ) AS observed_at, source, category,
         visible <> 0 AS visible, orcahello_id
  FROM orcasound_detections.detections;

-- A hydrophone as orcasite names it: where it is.
CREATE OR REPLACE TEMP VIEW source_orcasound_feeds AS
  SELECT id, name, CAST(lon AS DOUBLE) AS lon, CAST(lat AS DOUBLE) AS lat
  FROM orcasound_detections.feeds;

-- OrcaHello's detection with its moderators' answer. `found` is their answer ('yes', 'no',
-- "don't know") only when `reviewed`; until then it is the API's default, 'No', which is no
-- answer. The tags are theirs too: an unreviewed detection can carry some the API filled in.
CREATE OR REPLACE TEMP VIEW source_orcahello_detections AS
  SELECT id, model_id, ai_model, global_prediction_label, reviewed <> 0 AS reviewed, found,
         from_json(tags, '["VARCHAR"]') AS tags
  FROM orcahello.detections;
