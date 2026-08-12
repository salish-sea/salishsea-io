-- Index the occurrences view's computed id so permalink lookups stop seq
-- scanning all four branches (salish-sf2 / Sentry SALISHSEA-IO-37).
--
-- hydrateFromOccurrenceId filters `public.occurrences` on `id`, a computed
-- string ('inaturalist:' || observations.id, and likewise per branch). The
-- planner DOES push the predicate into each UNION ALL branch — EXPLAIN on
-- production (2026-08-12) shows per-branch quals like
--
--   Seq Scan on observations
--     Filter: (('inaturalist:'::text || (id)::text) = 'inaturalist:340900993'::text)
--
-- but nothing indexes those expressions, so every branch seq scans its base
-- table (plus join partners) to return at most one row. Warm caches keep that
-- under the anon role's statement_timeout=3s; a cold permalink hit blew it on
-- 2026-08-06 (SALISHSEA-IO-37).
--
-- These expression indexes match the pushed-down quals exactly, turning each
-- branch into a single index probe. The `::text` casts are the same ones the
-- planner already inserts (int/bigint/uuid to text, all immutable), written
-- explicitly so the index expression is `text || text` and matches the plan
-- tree. Cheaper alternatives considered: exposing source/source_id columns
-- for the client to filter on would also prune branches but forces a client
-- change and still leaves `id::text` unindexed within the branch; routing
-- through occurrence_index lags ingest by up to ~6 minutes (decision 021).

CREATE INDEX sightings_occurrence_id    ON maplify.sightings         (('maplify:' || id::text));
CREATE INDEX observations_occurrence_id ON inaturalist.observations  (('inaturalist:' || id::text));
CREATE INDEX encounters_occurrence_id   ON happywhale.encounters     (('happywhale:' || id::text));
CREATE INDEX native_occurrence_id       ON public.observations       ((id::text));
