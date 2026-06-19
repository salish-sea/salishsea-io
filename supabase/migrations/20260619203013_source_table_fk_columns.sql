-- Phase 10: Source Table FK Columns
-- Implements LINK-01, LINK-02, LINK-03 from .planning/REQUIREMENTS.md.
--
-- Adds four provenance FK columns to all four source tables:
--   provider_id    INTEGER REFERENCES public.providers(id)    NOT NULL (D-05 deviation)
--   collection_id  INTEGER REFERENCES public.collections(id)  nullable (D-12)
--   contributor_id INTEGER REFERENCES public.contributors(id) nullable (D-10/D-11)
--   source_url     TEXT [GENERATED or plain]                  per-table (D-06/D-07/D-08/D-09)
--
-- Intentional deviation from ROADMAP SC#1 ("all columns nullable"):
--   provider_id is NOT NULL on all four tables (D-05) — provider is fully known now
--   and must not be null on any sighting row. Flagged as intentional.
--
-- D-14: This migration does NOT edit the ingest upsert RPCs (maplify.update_sightings,
--   public.upsert_observation). Forward-population of new rows is handled by:
--   - GENERATED ALWAYS AS source_url columns (native/iNat) — auto-fills without RPC edits
--   - Migration-resolved provider_id DEFAULT — auto-fills without RPC edits
--
-- Pitfall 4 note: source_url on public.observations depends on the `url` column;
--   source_url on inaturalist.observations depends on `uri`. Any future migration
--   renaming or dropping those columns must drop these generated columns first.
--
-- provider_id DEFAULT: each table gets a plain integer literal resolved at migration
--   time via DO $$ ... EXECUTE format() $$ resolving slug→id at migration time.
--   Never a hardcoded id literal; never a subquery DEFAULT (Postgres rejects it —
--   RESEARCH Pitfall 3). Resolves slug→id so the literal is stable across re-seeds
--   (slug is the Phase 9 D-05 natural-key contract).

-- =====================================================================
-- 1. public.observations (native)
-- Already has: contributor_id INTEGER NOT NULL REFERENCES contributors(id) ON DELETE CASCADE
--              (added by 20260204013006_sightings_uses_contributors.sql)
--              url varchar(2000) nullable
-- Adds: provider_id, collection_id, source_url (GENERATED from url)
-- Relaxes: contributor_id NOT NULL → nullable (D-11; data stays 100% populated)
-- Indexes: observations_collection_id (partial btree, WHERE collection_id IS NOT NULL, D-13)
-- =====================================================================
ALTER TABLE public.observations
  ADD COLUMN provider_id   INTEGER REFERENCES public.providers(id),
  ADD COLUMN collection_id INTEGER REFERENCES public.collections(id),
  ADD COLUMN source_url    TEXT GENERATED ALWAYS AS (url) STORED;  -- D-06: mirrors url; can't drift; auto-fills new rows

-- contributor_id already exists as NOT NULL; relax to nullable (D-11)
ALTER TABLE public.observations ALTER COLUMN contributor_id DROP NOT NULL;

-- Backfill provider_id by slug join (D-02; never a hardcoded id)
UPDATE public.observations
  SET provider_id = p.id
  FROM public.providers p
 WHERE p.slug = 'direct';

-- Enforce NOT NULL after backfill (D-05)
ALTER TABLE public.observations ALTER COLUMN provider_id SET NOT NULL;

-- Migration-resolved DEFAULT: store a plain integer literal; no subquery in DEFAULT (D-03/Pitfall 3)
DO $$ BEGIN
  EXECUTE format(
    'ALTER TABLE public.observations ALTER COLUMN provider_id SET DEFAULT %s',
    (SELECT id FROM public.providers WHERE slug = 'direct')
  );
END $$;

-- Partial btree index on collection_id for Phase 12 DwC join access pattern (D-13)
-- Most rows are NULL until Phase 11; partial index is smaller and matches the access pattern.
CREATE INDEX observations_collection_id
  ON public.observations (collection_id)
  WHERE collection_id IS NOT NULL;

-- =====================================================================
-- 2. maplify.sightings (exported)
-- Already has: taxon_id int REFERENCES inaturalist.taxa(id) (cross-schema FK precedent)
--              no url/uri sibling
-- Adds: provider_id, collection_id, contributor_id, source_url (plain nullable — D-07/D-08)
-- Indexes: sightings_collection_id (partial btree, WHERE collection_id IS NOT NULL, D-13)
-- Note: maplify source_url stays NULL this phase; Phase 11 resolver derives it from comments.
-- =====================================================================
ALTER TABLE maplify.sightings
  ADD COLUMN provider_id    INTEGER REFERENCES public.providers(id),
  ADD COLUMN collection_id  INTEGER REFERENCES public.collections(id),
  ADD COLUMN contributor_id INTEGER REFERENCES public.contributors(id),
  ADD COLUMN source_url     TEXT;  -- D-07/D-08: plain nullable; Phase 11 fills from comments

-- Backfill provider_id by slug join (D-02)
UPDATE maplify.sightings
  SET provider_id = p.id
  FROM public.providers p
 WHERE p.slug = 'maplify';

-- Enforce NOT NULL after backfill (D-05)
ALTER TABLE maplify.sightings ALTER COLUMN provider_id SET NOT NULL;

-- Migration-resolved DEFAULT (D-03)
DO $$ BEGIN
  EXECUTE format(
    'ALTER TABLE maplify.sightings ALTER COLUMN provider_id SET DEFAULT %s',
    (SELECT id FROM public.providers WHERE slug = 'maplify')
  );
END $$;

-- Partial btree index on collection_id (D-13, exported table)
CREATE INDEX sightings_collection_id
  ON maplify.sightings (collection_id)
  WHERE collection_id IS NOT NULL;

-- =====================================================================
-- 3. inaturalist.observations
-- Already has: uri varchar(200) NOT NULL (every row has a non-null URI)
-- Adds: provider_id, collection_id, contributor_id, source_url (GENERATED from uri)
-- No collection_id index (not an exported table, D-13)
-- Note: uri is NOT NULL, so source_url is non-null by construction on every row.
-- =====================================================================
ALTER TABLE inaturalist.observations
  ADD COLUMN provider_id    INTEGER REFERENCES public.providers(id),
  ADD COLUMN collection_id  INTEGER REFERENCES public.collections(id),
  ADD COLUMN contributor_id INTEGER REFERENCES public.contributors(id),
  ADD COLUMN source_url     TEXT GENERATED ALWAYS AS (uri) STORED;  -- D-06: uri NOT NULL → every row populated

-- Backfill provider_id by slug join (D-02)
UPDATE inaturalist.observations
  SET provider_id = p.id
  FROM public.providers p
 WHERE p.slug = 'inaturalist';

-- Enforce NOT NULL after backfill (D-05)
ALTER TABLE inaturalist.observations ALTER COLUMN provider_id SET NOT NULL;

-- Migration-resolved DEFAULT (D-03)
DO $$ BEGIN
  EXECUTE format(
    'ALTER TABLE inaturalist.observations ALTER COLUMN provider_id SET DEFAULT %s',
    (SELECT id FROM public.providers WHERE slug = 'inaturalist')
  );
END $$;

-- No collection_id index on inaturalist (not an exported table, D-13).

-- =====================================================================
-- 4. happywhale.encounters
-- Already has: individual_id integer NOT NULL REFERENCES happywhale.individuals(id)
--              id integer PRIMARY KEY
--              no url sibling
-- Adds: provider_id, collection_id, contributor_id
--       source_url GENERATED ALWAYS AS (repo-canonical form: individual/%;enc=%)
-- D-09 / RESEARCH Pitfall 1 / A1: 15+ repo migrations build HW URLs as:
--   'https://happywhale.com/individual/' || individual_id || ';enc=' || id
--   individual_id is a same-table NOT NULL integer, so a generated expression is legal
--   and makes every row non-null by construction. The generated form is cleaner than
--   a plain-column + UPDATE and guarantees no drift. Zero occurrences of the bare
--   encounter-id URL form exist in this codebase.
-- No collection_id index (not an exported table, D-13).
-- =====================================================================
ALTER TABLE happywhale.encounters
  ADD COLUMN provider_id    INTEGER REFERENCES public.providers(id),
  ADD COLUMN collection_id  INTEGER REFERENCES public.collections(id),
  ADD COLUMN contributor_id INTEGER REFERENCES public.contributors(id),
  -- D-09/A1: repo-canonical URL form — 15+ migrations use individual_id + ';enc=' + id.
  -- individual_id is a same-table NOT NULL integer column, so this generated expression
  -- is legal and makes source_url non-null by construction on every HW row.
  ADD COLUMN source_url     TEXT GENERATED ALWAYS AS (
    'https://happywhale.com/individual/' || individual_id || ';enc=' || id
  ) STORED;

-- Backfill provider_id by slug join (D-02)
UPDATE happywhale.encounters
  SET provider_id = p.id
  FROM public.providers p
 WHERE p.slug = 'happywhale';

-- Enforce NOT NULL after backfill (D-05)
ALTER TABLE happywhale.encounters ALTER COLUMN provider_id SET NOT NULL;

-- Migration-resolved DEFAULT (D-03)
DO $$ BEGIN
  EXECUTE format(
    'ALTER TABLE happywhale.encounters ALTER COLUMN provider_id SET DEFAULT %s',
    (SELECT id FROM public.providers WHERE slug = 'happywhale')
  );
END $$;

-- No collection_id index on happywhale (not an exported table, D-13).
