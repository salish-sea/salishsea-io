-- Certainty is the asserter's and status is ours (decision 054; salish-8vr.27).
--
-- Two axes, two columns, neither derived from the other. `certainty` is how sure the person
-- who made the claim was: the three values orcasound/orcasite#1014 proposes, and NULL when
-- nobody asked. `status` stays what the dataset says about the claim, set by a curator
-- (decision 014). A claim from any source arrives 'candidate' whatever its certainty; a
-- curator validating a 'possible' claim leaves it 'possible'.
--
-- This file is types and columns only. The views that read them are the next migration,
-- because a value added to an enum cannot be used in the transaction that added it.

-- Declared in ASCENDING order so that `ORDER BY certainty` ranks a hedge below a sure
-- claim; the occurrences view picks an occurrence's own certainty that way.
CREATE TYPE public.identification_certainty AS ENUM ('possible', 'probable', 'certain');
COMMENT ON TYPE public.identification_certainty IS
  'How sure the ASSERTER was (decision 054): the moderator''s or observer''s own hedge, never '
  'the dataset''s verification (that is identification_status) and never a machine''s score '
  '(that is identifications.confidence). Ascending, so ORDER BY ranks it.';

-- What an acoustic claim rests on. The enum is LOCKED against DROP VALUE (20260707220211);
-- ADD is fine, and this is the first addition.
ALTER TYPE public.identification_evidence ADD VALUE IF NOT EXISTS 'acoustic';

ALTER TABLE public.identifications
  ADD COLUMN certainty public.identification_certainty;
COMMENT ON COLUMN public.identifications.certainty IS
  'The asserter''s own hedge; NULL = nobody asked (never default to certain). Set only by '
  'whoever made the claim. A curator who disagrees asserts their own row (decision 054).';

-- A number is a machine's; a hedge is a person's. 'possible' never becomes 0.5.
-- The table is empty on 2026-09-26 (prod and local), so nothing can violate this.
ALTER TABLE public.identifications
  ADD CONSTRAINT identification_confidence_is_a_machines_ck
  CHECK (confidence IS NULL OR method = 'cv');

-- A bout's cited entity is its identification, and the row of record is here (the ingest
-- reconciles it); the views derive everything else from it. Certainty arrives per tag
-- application once orcasite exposes item_tags with a certainty on the bouts include
-- (orcasite#1014, #1051); until then every row is NULL.
ALTER TABLE public.acoustic_bout_entities
  ADD COLUMN certainty public.identification_certainty;
COMMENT ON COLUMN public.acoustic_bout_entities.certainty IS
  'The moderator''s certainty on the tag application (orcasite item_tags.certainty, #1014); '
  'NULL until orcasite carries it. Decision 054.';
