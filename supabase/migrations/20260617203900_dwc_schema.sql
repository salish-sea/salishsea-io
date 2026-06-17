-- =====================================================================
-- Phase 5 — DwC projection schema (encodes 04-POLICY §3.1 and §3.2)
-- =====================================================================
--
-- This migration introduces a read-only `dwc` Postgres schema that
-- projects in-scope occurrence records into DarwinCore-aligned columns.
-- It is consumed offline by the Phase 7 nightly job (DuckDB ATTACH +
-- COPY to CSV / GeoParquet); it is NOT exposed via PostgREST.
--
-- Artifact inventory (full set assembled by the time plans 05-01..05-04
-- have all committed against this same file):
--
--   * schema  dwc
--   * view    dwc.taxa_classification    (recursive Linnaean walk)
--   * view    dwc._native_occurrences    (internal; public.observations)
--   * view    dwc._maplify_occurrences   (internal; maplify.sightings)
--   * view    dwc.occurrences            (UNION ALL of the two branches)
--   * view    dwc.multimedia             (Multimedia extension, native-only)
--   * view    dwc.datasets               (view over a VALUES list)
--
-- This plan (05-01) seeds the file with the schema header, USAGE grant,
-- and the helper view dwc.taxa_classification. Plans 05-02, 05-03, and
-- 05-04 APPEND to this same file (see placeholder at end).
--
-- Discrepancy 1 — table renames (RESEARCH §"CRITICAL Schema Discrepancies"):
--   Source tables are `public.observations` and `public.observation_photos`
--   (renamed from `public.sightings` / `public.sighting_photos` on
--   2025-09-15, migration `20250915171505_sighting_policies.sql`).
--   CONTEXT.md and 04-POLICY.md §3.1/§3.3 still use the old names; this
--   migration uses the current names.
--
-- Discrepancy 2 — D-19 NULL branch unreachable today
-- (RESEARCH §"CRITICAL Schema Discrepancies"):
--   POLICY §1.2/§1.4 specify a two-branch CASE for `license_code = 'none'`
--   vs `license_code IS NULL`. The `DROP NOT NULL` migration was applied
--   to `inaturalist.observation_photos.license`, NOT to
--   `public.observation_photos.license_code` (which remains
--   `varchar(20) NOT NULL`). The NULL arm in `dwc.multimedia` is encoded
--   for forward-compat with a future `DROP NOT NULL`; today it matches
--   zero rows.
--
-- API exposure: `dwc` is intentionally NOT added to
-- `supabase/config.toml:api.schemas` (RESEARCH Pitfall 5 / Note on
-- Supabase API exposure). Consumers must fully-qualify (`dwc.occurrences`).
-- The service-role inherits USAGE via Supabase defaults; we grant
-- USAGE explicitly only to `anon` and `authenticated`.
--
-- Local verification: `supabase db reset && psql … -f supabase/snippets/05_dwc_assertions.sql`.
-- =====================================================================

CREATE SCHEMA dwc;

GRANT USAGE ON SCHEMA dwc TO anon, authenticated;

-- ---------------------------------------------------------------------
-- dwc.taxa_classification — recursive Linnaean walk over inaturalist.taxa
-- ---------------------------------------------------------------------
--
-- M-05 helper view. One row per inaturalist.taxa.id. Both branch views
-- (dwc._native_occurrences, dwc._maplify_occurrences) JOIN this on
-- taxon_id so the higher-rank-only contract lives in exactly one place.
--
-- Higher-rank-only contract (ALIGN-03):
--   * For a taxon whose own rank is `family` or higher,
--     scientific_name = the taxon's own scientific_name (e.g. "Delphinidae")
--     and genus IS NULL. We never fabricate a binomial.
--   * For a taxon whose own rank is `genus` or below, genus is populated
--     by walking ancestors via parent_id.
--
-- Cycle safety (RESEARCH Assumption A2):
--   The recursive arm carries a `depth < 50` guard. iNaturalist's tree
--   is bounded well below 30; the guard is defense-in-depth against
--   accidental cycles introduced by future data, not a tuning knob.
--
-- Search-path safety (T-05-04):
--   Every reference to the source table is fully qualified as
--   `inaturalist.taxa`. A bare `taxa` reference would be hijackable by
--   a same-named table in a higher-priority schema.
--
-- Note on GRANT SELECT: the broad
-- `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated`
-- statement lives at the end of the migration (plan 05-04) so it covers
-- every view in one place. Do not add per-view grants here.

CREATE VIEW dwc.taxa_classification AS
WITH RECURSIVE ancestors AS (
  -- Seed: every taxon is its own first ancestor (depth = 0).
  SELECT
    t.id              AS leaf_id,
    t.id              AS ancestor_id,
    t.parent_id       AS parent_id,
    t.rank            AS rank,
    t.scientific_name AS scientific_name,
    0                 AS depth
  FROM inaturalist.taxa t

  UNION ALL

  -- Step: walk parent_id one level at a time. The `depth < 50` guard
  -- terminates any accidental cycle (RESEARCH A2); the real iNaturalist
  -- tree depth is well below 30.
  SELECT
    a.leaf_id,
    p.id,
    p.parent_id,
    p.rank,
    p.scientific_name,
    a.depth + 1
  FROM ancestors a
  JOIN inaturalist.taxa p ON p.id = a.parent_id
  WHERE a.depth < 50
),
pivoted AS (
  -- One row per leaf taxon, with each Linnaean rank's scientific_name
  -- pivoted into its own column. `order_` trails an underscore because
  -- `order` is a SQL reserved word; the branch views alias it back to
  -- the quoted DwC term "order".
  SELECT
    leaf_id AS taxon_id,
    MAX(CASE WHEN rank = 'kingdom'::inaturalist.rank THEN scientific_name END) AS kingdom,
    MAX(CASE WHEN rank = 'phylum'::inaturalist.rank  THEN scientific_name END) AS phylum,
    MAX(CASE WHEN rank = 'class'::inaturalist.rank   THEN scientific_name END) AS class,
    MAX(CASE WHEN rank = 'order'::inaturalist.rank   THEN scientific_name END) AS order_,
    MAX(CASE WHEN rank = 'family'::inaturalist.rank  THEN scientific_name END) AS family,
    MAX(CASE WHEN rank = 'genus'::inaturalist.rank   THEN scientific_name END) AS genus
  FROM ancestors
  GROUP BY leaf_id
)
SELECT
  t.id              AS taxon_id,
  -- Direct cast: every inaturalist.rank value matches its DwC taxonRank
  -- string by construction (RESEARCH §"inaturalist.rank → DwC taxonRank
  -- Vocabulary Mapping"). No remapping CASE needed.
  t.rank::text      AS taxon_rank,
  -- Always the leaf's own scientific_name — never a fabricated binomial
  -- (M-05 higher-rank-only contract).
  t.scientific_name AS scientific_name,
  p.kingdom,
  p.phylum,
  p.class,
  p.order_,
  p.family,
  -- Higher-rank-only gate: emit genus only for taxa at genus rank or
  -- below. For family-and-above taxa, genus stays NULL so downstream
  -- consumers don't see a half-fabricated binomial. The rank list is
  -- enumerated explicitly (rather than `t.rank <= 'genus'`) so the
  -- semantic is reviewable without consulting the enum's declaration
  -- order, and it survives any future enum reordering.
  CASE
    WHEN t.rank IN (
      'genus'::inaturalist.rank,
      'genushybrid'::inaturalist.rank,
      'subgenus'::inaturalist.rank,
      'species'::inaturalist.rank,
      'complex'::inaturalist.rank,
      'section'::inaturalist.rank,
      'subsection'::inaturalist.rank,
      'hybrid'::inaturalist.rank,
      'subspecies'::inaturalist.rank,
      'variety'::inaturalist.rank,
      'form'::inaturalist.rank,
      'infrahybrid'::inaturalist.rank
    ) THEN p.genus
    ELSE NULL
  END AS genus
FROM inaturalist.taxa t
JOIN pivoted p ON p.taxon_id = t.id;

COMMENT ON VIEW dwc.taxa_classification IS 'M-05 helper. Recursive walk over inaturalist.taxa.parent_id; one row per taxon. Higher-rank taxa have scientific_name = own name, genus = NULL (no fabricated binomial). See 05-RESEARCH §"Higher-Rank-Only Recursive Walk".';

-- (continued: dwc.datasets, dwc._native_occurrences, dwc._maplify_occurrences, dwc.occurrences, dwc.multimedia — appended by plans 05-02..05-04)

