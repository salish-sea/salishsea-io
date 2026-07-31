-- Retire the in-database HTTP ingest path for Maplify and iNaturalist.
--
-- Completes bd salish-89d.3, the last step of decision 011: ingest moves out of
-- Postgres into a TypeScript imperative shell, and Postgres keeps only storage
-- and the pure relational views over it.
--
-- The cutover itself shipped 2026-07-06 (#308). Since then the Edge Function has
-- been the only thing writing ingested rows — 7,053 iNaturalist runs and 7,091
-- Maplify runs in `ingest.runs`, most recent 2026-07-31. The functions below
-- have not run in that time. This deletes them.
--
-- Verified before dropping, against production:
--
--   * Nothing outside this set references any of them. Every function body and
--     view/matview definition in public, maplify, inaturalist, happywhale, dwc
--     and ingest was searched; the nine form a closed cluster.
--   * No cron job mentions them — the schedule invokes the Edge Function.
--   * No triggers in these schemas.
--   * The Edge Function talks to Postgres over the `postgres` client with raw
--     SQL and calls none of them.
--
-- Kept deliberately, though the drops orphan them: `maplify.resolve_collection`,
-- `inaturalist.upsert_taxon`, `inaturalist.mint_contributor`,
-- `inaturalist.species_id`. These are pure relational helpers, not HTTP, and
-- `species_id` in particular is load-bearing — `public.occurrences` calls it.
-- Garbage-collecting the genuinely unreferenced ones is separate work.
--
-- NOT dropped: happywhale.fetch_species_config, happywhale.ensure_species,
-- happywhale.ensure_inat_taxa. They are also dead HTTP-in-Postgres, but
-- HappyWhale ingest was never part of this cutover — `ingest.runs` has no
-- happywhale rows at all, and there is no TypeScript replacement to move it to.
-- Dropping them would remove the only mechanism, dormant as it is, with nothing
-- standing behind it. Tracked separately.
--
-- Rollback: revert this migration. The bodies are recoverable from the
-- migrations that created them, all of which remain in this directory.

-- Callers first, then the HTTP fetchers they wrapped.
DROP FUNCTION IF EXISTS maplify.update_sightings(start_date date, end_date date);
DROP FUNCTION IF EXISTS maplify.fetch_date_range(start_date date, end_date date, bbox gis.box2d);

DROP FUNCTION IF EXISTS inaturalist.update_observations(from_date date, to_date date);
DROP FUNCTION IF EXISTS inaturalist.upsert_observation_page(page jsonb);
DROP FUNCTION IF EXISTS inaturalist.fetch_observation_page(
  earliest date, latest date, extent gis.box2d, taxon_ids integer[], page_no integer, per_page integer);

DROP FUNCTION IF EXISTS inaturalist.ensure_taxa(taxon_ids integer[]);
DROP FUNCTION IF EXISTS inaturalist.ensure_taxon(scientific_name character varying);
DROP FUNCTION IF EXISTS inaturalist.fetch_taxa(ids integer[]);
DROP FUNCTION IF EXISTS inaturalist.query_taxa(query character varying);
