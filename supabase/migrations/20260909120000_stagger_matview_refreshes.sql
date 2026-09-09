-- Serialize the two occurrence-cache refreshes so they stop competing with each
-- other, and with the map (bd salish-xfo).
--
-- public.occurrence_index and public.occurrence_identifier_candidates are two
-- caches of the SAME expensive view, and both refreshed on the same tick
-- ('1-59/5'). Each one's source is a full scan of public.occurrences, measured
-- at ~2.3s on prod (53,867 rows through a 4-way UNION with photo aggregation
-- and per-row regex extraction). Run alone that is ~2.3s of work; run against
-- each other it is much worse than twice that, because the two scans evict each
-- other's buffers and contend for the same I/O.
--
-- The prod numbers over 24h on 2026-09-09: 288 runs each, averaging 8.0s
-- (occurrence-index) and 7.0s (identifier-candidates) against a ~2.3s scan —
-- so most of each refresh was the two fighting. The worst tick observed was
-- far worse still: on 2026-09-01 they ran 33.7s and 26.4s, roughly 4x their
-- averages, and SALISHSEA-IO-3G is a visitor's map query that started inside
-- that window and was killed at the 3s anon statement_timeout. That query
-- costs 50ms when the database is quiet.
--
-- So: keep both refreshes, keep the cadence, stop overlapping them.
-- occurrence-index keeps the :01 slot; identifier-candidates moves to :03.
--
-- Two minutes is deliberate headroom over the 22s worst-case single refresh,
-- and the failure mode if it were ever exceeded is benign — identifier
-- candidates would build from an occurrences view one tick staler, not break.
--
-- Index goes FIRST on purpose. The structural fix behind this one is to give
-- occurrence_index an `identifiers` column and build the candidates cache FROM
-- occurrence_index rather than from occurrences, so the expensive scan happens
-- once per tick instead of twice. That requires DROP CASCADE on
-- occurrence_index and rebuilding its three dependent reader views
-- (individual_occurrences, group_occurrences, ecotype_occurrences), so it is
-- its own migration; this ordering is what it will need.
--
-- Freshness: identifier candidates now lag ingest by up to ~8 minutes rather
-- than ~6 (ingest runs '*/5', this now lands at :03 rather than :01). The
-- contract in 20260708000104_identifier_candidate_cache.sql said "~6 minutes";
-- the two extra minutes carry the same argument, since a curator claims
-- against occurrences that are already ingested. occurrence_index's own
-- freshness is unchanged.

-- cron.schedule upserts by name, so this repoints the existing job rather than
-- creating a second one. The command is reproduced exactly as it stands in
-- prod; only the schedule changes.
SELECT cron.schedule(
  'refresh-identifier-candidates',
  '3-59/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.occurrence_identifier_candidates$$
);
