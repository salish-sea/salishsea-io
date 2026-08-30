-- Retire the six named_group shells; their names move to the matriline they name
-- (salish-ox2.3, evidence in docs/reference/register-reconciliation.md §collisions).
--
-- The reconciliation against register edition 2026.08.1 found every named_group row —
-- Secret Agents, Motley Crew, Ted's Gang, Sea Monster Family, Gretzky's, Runaway's —
-- resolving onto the SAME register entity as the matriline it names: two catalogue rows
-- claiming one identity. Measured in production 2026-08-30, all six are name-only
-- shells: zero memberships, no anchor individual, no parent group. The roster always
-- lived on the matriline; the name was written down twice. The register agrees, holding
-- the collective name as a `common` name on the lineage entity (animals Q22 part c).
--
-- Retiring them BEFORE the catalogue migration matters because a migration assigning
-- register identifiers row by row would hand both rows the same SSA: and never notice
-- (the exact hazard 20260830130000's UNIQUE constraint exists to catch).
--
-- The names are not discarded: each shell's nickname row (with its story and theme —
-- "for the #007 same as James Bond") is re-pointed at the matriline, where the matriline
-- profile page and its OG preview already know how to display it. This is the first time
-- those six pages show their community name.
--
-- The mapping below is the sheet's own: each "Known as ..." heading immediately precedes
-- its lineage's block in data/biggs-ids.tsv.

DO $$
DECLARE
  bad integer;
BEGIN
  -- A shell that has acquired members, identifications, or children since the
  -- 2026-08-30 measurement is no longer a shell; stop rather than orphan its data.
  SELECT count(*) INTO bad
  FROM public.social_groups g
  WHERE g.kind = 'named_group'
    AND (EXISTS (SELECT 1 FROM public.group_memberships m WHERE m.group_id = g.id)
      OR EXISTS (SELECT 1 FROM public.identifications i WHERE i.social_group_id = g.id)
      OR EXISTS (SELECT 1 FROM public.social_groups c WHERE c.parent_group_id = g.id)
      OR g.anchor_individual_id IS NOT NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION 'named_group row(s) with attached data: % — not shells any more, re-measure before retiring', bad;
  END IF;
END $$;

-- Re-point each shell's nicknames at the matriline its name belongs to.
UPDATE public.nicknames n
SET social_group_id = m.id
FROM public.social_groups shell
JOIN (VALUES
  ('Secret Agents',      'T007'),
  ('Motley Crew',        'T023'),
  ('Ted''s Gang',        'T041'),
  ('Sea Monster Family', 'T073'),
  ('Gretzky''s',         'T099'),
  ('Runaway''s',         'T109')
) AS map(shell_designation, matriline_designation)
  ON map.shell_designation = shell.designation
JOIN public.social_groups m
  ON m.designation = map.matriline_designation AND m.kind = 'matriline'
WHERE shell.kind = 'named_group'
  AND n.social_group_id = shell.id;

DO $$
DECLARE
  stranded integer;
BEGIN
  -- Every shell's nicknames must have moved; a shell not in the map would keep its
  -- nickname and fail the FK-less delete silently. (Zero shells — a fresh database —
  -- passes: nothing to strand.)
  SELECT count(*) INTO stranded
  FROM public.nicknames n
  JOIN public.social_groups g ON g.id = n.social_group_id
  WHERE g.kind = 'named_group';
  IF stranded > 0 THEN
    RAISE EXCEPTION '% nickname(s) still on a named_group row — the shell map above is incomplete', stranded;
  END IF;
END $$;

DELETE FROM public.social_groups WHERE kind = 'named_group';

-- The enum value stays: Postgres cannot drop one, and an empty value is harmless.
COMMENT ON COLUMN public.social_groups.kind IS
  'ecotype | clan | pod | matriline. named_group is retired (salish-ox2.3, 2026-08-30): '
  'the six rows it labelled were name-only shells duplicating the matriline they named; '
  'their names live on as nicknames of those matrilines. The register expresses a '
  'community name the same way — a common name on the ranked lineage entity.';
