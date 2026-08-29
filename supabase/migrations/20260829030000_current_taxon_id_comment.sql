-- current_taxon_id's comment described a column nothing read and a script that repointed
-- records. Both halves are now wrong (salish-4hq, decision 032).
--
-- Migration 20260828000000 added the column when scripts/backfill/inat-taxa-status.ts was
-- the only thing that touched it, and that script repaired a retirement by UPDATEing the
-- id out of every column referencing it. Decision 032 moved resolution to read time:
-- public.occurrences and dwc.taxa_classification hop through this column, the stored ids
-- stay as claimed, and the script became a weekly refresh that writes to inaturalist.taxa
-- and nothing else.

COMMENT ON COLUMN inaturalist.taxa.current_taxon_id IS
  'The taxon that supersedes this one, from iNaturalist current_synonymous_taxon_ids. '
  'Read by public.occurrences and dwc.taxa_classification, which hop through it so a '
  'record shows the taxon it currently is while keeping the id it was filed under '
  '(decision 032). NULL for an active taxon, and also for a retirement iNaturalist gave '
  'no single replacement for: a split names several, and choosing one would guess which '
  'animal was seen. Written by scripts/backfill/inat-taxa-status.ts, weekly.';
