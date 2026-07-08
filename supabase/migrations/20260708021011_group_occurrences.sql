-- A social group's own sighting record for its profile page (bd
-- salishsea-io-w2d, decision 016): identifications naming the group as a
-- unit ("T65As"). Deliberately NO member fan-out — the union of members'
-- sightings would double-count and blur whose sighting it was; that view of
-- the data belongs to the members' own pages (individual_occurrences).
--
-- Same two-branch shape as individual_occurrences (20260708000104): stored
-- claims stay live so curation takes effect immediately; candidates come from
-- the cache with their own observed_at/location, shadowed by any stored claim
-- for the same (occurrence, group). identifications' XOR CHECK guarantees
-- social_group_id rows carry no individual_id, so matching on social_group_id
-- alone is exact — a stored claim about an individual member must not
-- suppress a group candidate on the same occurrence.
CREATE VIEW public.group_occurrences AS
SELECT
  s.social_group_id,
  s.occurrence_id,
  o.observed_at,
  o.location,
  s.is_present,
  s.status,
  s.evidence,
  s.code
FROM public.identifications s
JOIN public.occurrences o
  ON o.id = s.occurrence_id
WHERE s.social_group_id IS NOT NULL
UNION ALL
SELECT
  c.social_group_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'text_mention'::public.identification_evidence AS evidence,
  c.code
FROM public.occurrence_identifier_candidates c
WHERE c.social_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND s.social_group_id = c.social_group_id
  );

-- Views don't inherit table policies; grant reads explicitly (the view runs
-- with definer rights, which is what lets clients read through it to the
-- REVOKEd candidates matview).
GRANT SELECT ON public.group_occurrences TO anon, authenticated;
