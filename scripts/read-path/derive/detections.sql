-- build.detections (salish-fizm.1, decision 122): each Orcasound detection marked as a
-- whale, with what it claims, whether anyone has confirmed or rejected it, and the taxon
-- that gives. Derived by derive-occurrences.ts with the orcasound arm, from derive/
-- detection-sources.sql's views, the bouts' own views (derive/sources.sql, the orcasound arm
-- of derive/occurrences.sql) and the register.
--
-- Not build.occurrences: in this first version nothing is published from it. No day file,
-- calendar, id index, segment, encounter or archive reads it, and none may until salish-fizm.4
-- decides how a detection is drawn beside its bout and what every consumer must filter.
--
-- A row for each detection that is a whale (category 'whale') and visible; vessels, others
-- and hidden ones are in the mirror and nowhere here.
--
-- The detector's claim (122, as amended): what the detector can claim, no more. A listener's
-- detection claims a whale, so Cetacea. OrcaHello's Southern Resident detector (the FastAI
-- model and the orcahello-srkw-detector models) hears Southern Resident calls only. PODS-AI
-- labels each clip resident, transient or humpback; its detection claims the label's taxon,
-- the killer whale for resident until we know whether its "resident" means Southern Residents
-- only. A machine detection with no OrcaHello row, or by a model not named here (AudioSet),
-- claims Cetacea, as orcasite's own category does.
--
-- Whether it is confirmed, by the first of these that applies (122):
--   1. a curator's answer: none exists yet (decision 120's review view is not built);
--   2. an OrcaHello moderator's answer. They are asked "Was there an SRKW call in this clip?",
--      so yes confirms a Southern Resident. No rejects only that: if their tags name another
--      whale the detection is confirmed as that whale, the most specific if they name several
--      (detection_tag_taxon below); otherwise it is rejected, and kept as data. "Don't know"
--      and no answer go on;
--   3. a confirmed bout: it falls within [started_at, ended_at] of a bout at its hydrophone,
--      no slack either side, whose occurrence for a cetacean is confirmed (080, 053), a bout
--      of a species only possibly heard being unconfirmed. The taxon is that species. A bout
--      with several confirmed cetacean species gives the one the detector's claim is under, else
--      the lowest register identifier. A bout still open (no end) has no span yet;
--   4. otherwise unconfirmed, and the taxon is the detector's claim.
-- `basis` says which step decided: 'orcahello', 'bout', or null for the last.

-- What a moderator's tag says the whale was, for a no: lower-cased, with the register entity it
-- names and how specific that is, lowest first. Our own list (decision 122 names these four).
CREATE OR REPLACE TEMP VIEW detection_tag_taxon AS
  SELECT * FROM (VALUES
    ('transient', 'SSA:0000002', 1), ('biggs', 'SSA:0000002', 1), ('bigg''s', 'SSA:0000002', 1),
    ('humpback', 'SSA:0000901', 2),
    ('orca', 'SSA:0000900', 3),
    ('whale', 'SSA:0000934', 4)
  ) AS t(tag, entity_id, specificity);

CREATE OR REPLACE TEMP VIEW detection_base AS
  SELECT d.id, d.observed_at, d.feed_id, d.source,
         {'lat': f.lat, 'lon': f.lon} AS location,
         h.hearing_range_m AS accuracy,
         CASE
           WHEN oh.ai_model = 'PODS-AI' THEN
             CASE oh.global_prediction_label
               WHEN 'transient' THEN 'SSA:0000002' WHEN 'humpback' THEN 'SSA:0000901'
               WHEN 'resident' THEN 'SSA:0000900' ELSE 'SSA:0000934' END
           WHEN oh.model_id = 'FastAI' OR oh.model_id LIKE 'orcasound/orcahello-srkw-detector%' THEN 'SSA:0000010'
           ELSE 'SSA:0000934'
         END AS detector_claim,
         CASE WHEN oh.reviewed THEN lower(oh.found) END AS orcahello_answer,
         CASE WHEN oh.reviewed THEN oh.tags END AS orcahello_tags
  FROM source_orcasound_detections d
  LEFT JOIN source_orcasound_feeds f ON f.id = d.feed_id
  LEFT JOIN public.hydrophones h ON h.feed_id = d.feed_id
  LEFT JOIN source_orcahello_detections oh ON oh.id = d.orcahello_id
  WHERE d.category = 'whale' AND d.visible;

-- Each species a bout confirms, for a cetacean: Cetacea itself or a taxon under it.
CREATE OR REPLACE TEMP VIEW confirmed_bout_species AS
  SELECT split_part(o.id, ':', 2) AS bout_id, o.taxon.entity_id AS entity_id
  FROM orcasound_occurrences o
  WHERE o.confirmation = 'confirmed' AND o.taxon IS NOT NULL
    AND (o.taxon.entity_id = 'SSA:0000934'
         OR EXISTS (SELECT 1 FROM register_implies i WHERE i.entity_id = o.taxon.entity_id AND i.implied_id = 'SSA:0000934'));

CREATE OR REPLACE TEMP VIEW detections_derived AS
  WITH tagged AS (
    -- the most specific whale a no's tags name
    SELECT b.id, arg_min(t.entity_id, t.specificity) AS entity_id
    FROM detection_base b
    JOIN detection_tag_taxon t ON list_contains(list_transform(b.orcahello_tags, lambda tag: lower(trim(tag))), t.tag)
    GROUP BY b.id
  ),
  in_bout AS (
    SELECT b.id, bo.id AS bout_id
    FROM detection_base b
    JOIN source_acoustic_bouts bo
      ON bo.feed_id = b.feed_id AND b.observed_at >= bo.started_at AND b.observed_at <= bo.ended_at
    QUALIFY row_number() OVER (PARTITION BY b.id ORDER BY bo.started_at, bo.id) = 1
  ),
  bout_taxon AS (
    SELECT b.id, s.entity_id
    FROM detection_base b
    JOIN in_bout ib ON ib.id = b.id
    JOIN confirmed_bout_species s ON s.bout_id = ib.bout_id
    LEFT JOIN taxon_entity claim ON claim.entity_id = b.detector_claim
    QUALIFY row_number() OVER (PARTITION BY b.id ORDER BY (s.entity_id = claim.taxon_entity_id) DESC, s.entity_id) = 1
  ),
  decided AS (
    SELECT b.*, ib.bout_id, tg.entity_id AS tagged_entity, bt.entity_id AS bout_entity,
           CASE
             WHEN b.orcahello_answer = 'yes' THEN 'orcahello'
             WHEN b.orcahello_answer = 'no' THEN 'orcahello'
             WHEN bt.entity_id IS NOT NULL THEN 'bout'
           END AS basis
    FROM detection_base b
    LEFT JOIN in_bout ib ON ib.id = b.id
    LEFT JOIN tagged tg ON tg.id = b.id
    LEFT JOIN bout_taxon bt ON bt.id = b.id
  )
  SELECT 'orcasound:' || id AS id, observed_at, feed_id, location, accuracy, source,
         detector_claim, orcahello_answer, orcahello_tags, bout_id,
         CASE
           WHEN orcahello_answer = 'yes' THEN 'SSA:0000010'
           WHEN orcahello_answer = 'no' AND tagged_entity IS NOT NULL THEN tagged_entity
           WHEN orcahello_answer = 'no' THEN detector_claim
           WHEN bout_entity IS NOT NULL THEN bout_entity
           ELSE detector_claim
         END AS taxon_entity,
         CASE
           WHEN orcahello_answer = 'yes' THEN 'confirmed'
           WHEN orcahello_answer = 'no' AND tagged_entity IS NOT NULL THEN 'confirmed'
           WHEN orcahello_answer = 'no' THEN 'rejected'
           WHEN bout_entity IS NOT NULL THEN 'confirmed'
           ELSE 'unconfirmed'
         END AS confirmation,
         basis
  FROM decided;
