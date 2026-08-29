-- The is_active comment described an ingest that no longer exists (salish-5ds).
--
-- Migration 20260828000000 added the column while the ingest still asked
-- `/taxa?id=<list>`, where the id QUERY PARAM filters retired taxa out — so the comment
-- recorded that the ingest could not see a retirement, and that the values came only
-- from scripts/backfill/inat-taxa-status.ts. The ingest now asks by the `/taxa/{ids}`
-- PATH form and records both columns for a taxon entering the mirror.
--
-- What has NOT changed: a taxon already stored is never re-asked (the closure only
-- fetches ids we do not hold, and the upsert is ON CONFLICT DO NOTHING), so refreshing
-- existing rows is still the backfill's job — see salish-4hq.

COMMENT ON COLUMN inaturalist.taxa.is_active IS
  'Mirror of iNaturalist is_active. NOTE: on /taxa the id= QUERY PARAM filters retired '
  'taxa out — it reports total_results 0 for one — while the /taxa/{ids} PATH form '
  'returns it flagged, with current_synonymous_taxon_ids. The difference is the route, '
  'not the API version. The ingest asks by the path form, so a taxon ENTERING the '
  'mirror is recorded with its true status; a taxon already stored is never re-asked, '
  'and is refreshed only by scripts/backfill/inat-taxa-status.ts.';
