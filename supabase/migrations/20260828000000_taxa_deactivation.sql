-- The taxa mirror could not represent a deactivated taxon (salish-ayb.4).
--
-- iNaturalist retires a taxon by marking it inactive and naming its replacement.
-- `inaturalist.taxa` was (id, parent_id, scientific_name, vernacular_name, rank), so
-- there was nowhere to record either fact — and the ingest upserted taxa with
-- ON CONFLICT DO NOTHING, so a row written once was never revisited. The mirror
-- therefore drifts from upstream permanently and silently.
--
-- Measured 2026-08-28 against the live API: 9 of 512 mirrored taxa are inactive
-- upstream, each naming a replacement. One carries records — Sagmatias obliquidens
-- (1368491 -> 1664971), under which we hold 38 occurrences, 2 of them our own native
-- submissions. Those are the same animal as the 210 we hold under the active id.
--
-- WHY THIS MIGRATION ONLY ADDS COLUMNS
--
-- Which taxa are inactive is an upstream fact, not a schema fact, and decision 008
-- makes the ingest — not a migration — responsible for the mirror's contents. A
-- migration hardcoding today's nine ids would be a snapshot pretending to be a rule,
-- and would be wrong the next time iNaturalist retires something. The values are
-- populated by scripts/backfill/inat-taxa-status.ts, which asks the API.

ALTER TABLE inaturalist.taxa
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  -- iNaturalist's `current_synonymous_taxon_ids`. Nullable twice over: an active
  -- taxon has no replacement, and a retired one is not always given one.
  ADD COLUMN current_taxon_id integer REFERENCES inaturalist.taxa (id)
    DEFERRABLE INITIALLY DEFERRED;

-- A replacement only means something for a taxon that has been retired. Stating it as
-- a constraint keeps "active" and "superseded by" from disagreeing, which is the shape
-- of bug that would otherwise send a reader to the wrong animal.
ALTER TABLE inaturalist.taxa
  ADD CONSTRAINT taxa_replacement_implies_inactive
    CHECK (current_taxon_id IS NULL OR NOT is_active),
  ADD CONSTRAINT taxa_replacement_is_another_taxon
    CHECK (current_taxon_id IS DISTINCT FROM id);

-- Resolution reads this on every ingest; the table is small but the lookup is hot.
CREATE INDEX IF NOT EXISTS taxa_current_taxon_id_idx
  ON inaturalist.taxa (current_taxon_id)
  WHERE current_taxon_id IS NOT NULL;

COMMENT ON COLUMN inaturalist.taxa.is_active IS
  'Mirror of iNaturalist is_active. NOTE: on /taxa the id= QUERY PARAM filters retired '
  'taxa out — it reports total_results 0 for one — while the /taxa/{ids} PATH form '
  'returns it flagged, with current_synonymous_taxon_ids. The difference is the route, '
  'not the API version. The ingest builds ?id=, so it cannot see a retirement.';

COMMENT ON COLUMN inaturalist.taxa.current_taxon_id IS
  'The taxon that supersedes this one, from iNaturalist current_synonymous_taxon_ids. '
  'Records referencing an inactive taxon are repointed here at write time rather than '
  'followed at read time, so public.occurrences carries no resolution logic.';

-- SELECT grants ship with the columns that need them (CLAUDE.md): the table is already
-- granted to anon/authenticated, and column-level grants are not in use here, so the
-- existing table grants cover the new columns. Restated as a no-op guard in case the
-- grant is ever narrowed to a column list.
GRANT SELECT ON inaturalist.taxa TO anon, authenticated;
