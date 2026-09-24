-- An animal's sex, birth years and life status are the register's (decision 051, salish-ox2.8).
--
-- public.individuals keeps its sex, born_earliest, born_latest and life_status columns,
-- because a dozen reads (pages, the edge's link previews, the occurrence views) select
-- them. But nothing of ours writes them any more: the register loader rewrites them from
-- the register in the same transaction as every load, and the seed stops. The register's
-- own guidance for copying a derived fact is to record the edition it came from, which
-- register.edition already does.
--
-- RECONCILED FIRST, against edition 2026.09.6 and production on 2026-09-23, 510 animals:
--   birth years   0 disagreements
--   sex           1: T109A3A, female here, unknown in the register. The Bigg's sheet says
--                 'F?'; our seed read that as female, the register as not known.
--   life status   56 animals the register records nothing for, all 'alive' here. The
--                 sheet leaves their status blank, and our seed read blank as alive. Peter:
--                 "until we learn otherwise, blank could mean anything". They become
--                 'unknown', which is all the sheet supports.

-- ---------------------------------------------------------------------------
-- The register's current life status, as it publishes it.
-- ---------------------------------------------------------------------------

CREATE TABLE register.current_status (
  entity_id    text PRIMARY KEY REFERENCES register.entities (entity_id) ON DELETE CASCADE,
  status       text NOT NULL,
  effective    text,
  asserted_on  text,
  recorded     text,
  source_id    text
);

COMMENT ON TABLE register.current_status IS
  'DERIVED: each entity''s current life status, which the register computes from its '
  'status history by ADR-0006''s (recorded, effective) precedence rule and publishes in '
  'dist/. Do not recompute it here; ordering by effective alone is wrong. An entity with '
  'no row has no recorded status.';

GRANT SELECT ON register.current_status TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Copy the register's facts onto our rows.
-- ---------------------------------------------------------------------------
--
-- Called by scripts/register/load.ts inside the load's transaction, so the columns can
-- never show one edition's names beside another's facts.
--
-- The encodings differ and are mapped, not interpreted:
--   sex     F / M -> female / male; U or blank -> NULL (not known)
--   born    EDTF. '1998' and '1998-09' -> born that year; '../1961' -> born by 1961;
--           blank -> not known. Any other shape (e.g. '1979~', approximate) -> not known,
--           and scripts/register/verify.ts reports it rather than guessing.
--   status  alive / dead / presumed_dead / unknown -> alive / deceased /
--           presumed_deceased / unknown; no row -> unknown.
--
-- IT NEVER BLANKS. An animal the register does not hold keeps what it has, and life status
-- is left alone entirely while register.current_status is empty, so a database migrated
-- ahead of its first load does not see every animal turn 'unknown'.

CREATE FUNCTION public.refresh_individual_vitals()
RETURNS integer
LANGUAGE sql
SET search_path = ''
AS $$
  WITH status_loaded AS (SELECT EXISTS (SELECT 1 FROM register.current_status) AS yes),
  v AS (
    SELECT i.id,
      CASE e.sex WHEN 'F' THEN 'female'::public.sex WHEN 'M' THEN 'male'::public.sex END AS sex,
      CASE WHEN e.born ~ '^\d{4}(-\d{2})?$' THEN left(e.born, 4)::integer END AS born_earliest,
      CASE WHEN e.born ~ '^\d{4}(-\d{2})?$' THEN left(e.born, 4)::integer
           WHEN e.born ~ '^\.\./\d{4}(-\d{2})?$' THEN substr(e.born, 4, 4)::integer END AS born_latest,
      CASE WHEN NOT sl.yes THEN i.life_status
           ELSE CASE s.status
                  WHEN 'alive' THEN 'alive'
                  WHEN 'dead' THEN 'deceased'
                  WHEN 'presumed_dead' THEN 'presumed_deceased'
                  ELSE 'unknown'
                END::public.life_status
      END AS life_status
    FROM public.individuals i
    JOIN register.entities e ON e.entity_id = i.entity_id
    LEFT JOIN register.current_status s ON s.entity_id = i.entity_id
    CROSS JOIN status_loaded sl
  ),
  changed AS (
    UPDATE public.individuals i
    SET sex = v.sex, born_earliest = v.born_earliest, born_latest = v.born_latest,
        life_status = v.life_status
    FROM v
    WHERE v.id = i.id
      AND (i.sex, i.born_earliest, i.born_latest, i.life_status)
          IS DISTINCT FROM (v.sex, v.born_earliest, v.born_latest, v.life_status)
    RETURNING 1
  )
  SELECT count(*)::integer FROM changed;
$$;

COMMENT ON FUNCTION public.refresh_individual_vitals() IS
  'Rewrites individuals.sex, born_earliest, born_latest and life_status from the register '
  '(decision 051). Called by the register loader in its transaction; returns how many rows '
  'changed. Never blanks: rows the register does not hold, and life status while '
  'register.current_status is empty, are left as they are.';

REVOKE ALL ON FUNCTION public.refresh_individual_vitals() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A group mention reaches every member not known to be dead (amends decision 050).
-- ---------------------------------------------------------------------------
--
-- Decision 050 said "every living member". With life status now the register's, 56 animals
-- whose status nobody recorded, most of them senior matriarchs, would stop being reached
-- when their matriline is reported. A blank says nothing either way, so the only animals
-- a group mention should skip are the ones known or presumed dead.

CREATE OR REPLACE VIEW public.individual_occurrences AS
SELECT COALESCE(s.individual_id, mm.individual_id) AS individual_id,
  s.occurrence_id,
  o.observed_at,
  o.location,
  s.is_present,
  s.status,
  s.evidence,
  s.code,
  CASE WHEN s.individual_id IS NULL THEN g.designation ELSE NULL::text END AS via_group
FROM public.identifications s
LEFT JOIN (public.matriline_members mm
           JOIN public.individuals mi ON mi.id = mm.individual_id
                                     AND mi.life_status NOT IN ('deceased', 'presumed_deceased'))
  ON s.individual_id IS NULL AND mm.group_id = s.social_group_id
LEFT JOIN public.social_groups g ON g.id = s.social_group_id
JOIN public.occurrence_index o ON o.id = s.occurrence_id
WHERE COALESCE(s.individual_id, mm.individual_id) IS NOT NULL
UNION ALL
SELECT COALESCE(c.individual_id, mm.individual_id) AS individual_id,
  c.occurrence_id,
  c.observed_at,
  c.location,
  true AS is_present,
  'candidate'::public.identification_status AS status,
  'text_mention'::public.identification_evidence AS evidence,
  c.code,
  CASE WHEN c.individual_id IS NULL THEN g.designation ELSE NULL::text END AS via_group
FROM public.occurrence_identifier_candidates c
LEFT JOIN (public.matriline_members mm
           JOIN public.individuals mi ON mi.id = mm.individual_id
                                     AND mi.life_status NOT IN ('deceased', 'presumed_deceased'))
  ON c.individual_id IS NULL AND mm.group_id = c.social_group_id
LEFT JOIN public.social_groups g ON g.id = c.social_group_id
WHERE (c.individual_id IS NOT NULL OR c.social_group_id IS NOT NULL)
  AND COALESCE(c.individual_id, mm.individual_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.identifications s
    WHERE s.occurrence_id = c.occurrence_id
      AND NOT s.individual_id IS DISTINCT FROM c.individual_id
      AND NOT s.social_group_id IS DISTINCT FROM c.social_group_id);
