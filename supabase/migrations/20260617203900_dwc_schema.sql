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

-- ---------------------------------------------------------------------
-- dwc._native_occurrences — projection of public.observations (native)
-- ---------------------------------------------------------------------
--
-- Plan 05-02 deliverable. One row per public.observations row, joined to
-- public.contributors (recordedBy / rightsHolder) and to
-- dwc.taxa_classification (scientificName + Linnaean ranks). Encodes
-- 04-POLICY §3.1 (native gap table).
--
-- The leading-underscore name signals "internal — do not consume
-- directly". Phase 6 reads dwc.occurrences (the UNION ALL of this view
-- and dwc._maplify_occurrences, assembled in plan 05-04), never this
-- branch directly.
--
-- Branch interface contract (25 columns; mirrored by
-- dwc._maplify_occurrences in plan 05-03):
--   Column order, names, and types are frozen here so the eventual
--   `CREATE VIEW dwc.occurrences AS … UNION ALL …` will compile. Every
--   scalar is cast to an explicit type (`text`, `double precision`,
--   `integer`) — implicit cross-branch type drift is the canonical
--   UNION-ALL view failure mode (RESEARCH Pitfall 4).
--
-- ALIGN requirement coverage from this view:
--   * ALIGN-01 — native projection lives in dwc schema, sourced directly
--     from public.observations (not the public.occurrences UI matview).
--   * ALIGN-02 — occurrenceID, basisOfRecord, scientificName, eventDate
--     are all NOT NULL by construction.
--   * ALIGN-04 — ST_Y for lat, ST_X for lon, geodeticDatum = 'WGS84',
--     coordinateUncertaintyInMeters uses NULLIF(accuracy, 0) (never 0).
--   * ALIGN-05 — eventDate is Z-suffixed full-precision UTC text via
--     to_char (not a default ::text cast — that produces sub-RFC-3339
--     output that strict parsers reject; RESEARCH Anti-Patterns).
--   * ALIGN-06 — occurrenceID = 'salishsea:' || o.id::text, deterministic
--     and source-prefixed; cannot collide with 'maplify:' prefixes.
--
-- D-09 / POLICY §2.1: recordedBy = rightsHolder = contributors.name
-- (intentional identity exposure — accepted threat T-05-02).
--
-- D-20 / POLICY §1.1: license is the CC-BY-NC 4.0 /legalcode URI,
-- emitted as a constant on every native row.
--
-- dynamicProperties: Task 1 emits NULL::text as a placeholder; Task 2 of
-- this plan replaces the placeholder with the
-- jsonb_strip_nulls(jsonb_build_object(...))::text expression carrying
-- exactly the two native-branch keys (travelDirection from
-- o.direction::text and unvalidatedIdentifiers from
-- public.extract_identifiers(o.body) — POLICY §2.3, §2.4).

CREATE VIEW dwc._native_occurrences AS
SELECT
  -- 1. occurrenceID (ALIGN-02, ALIGN-06)
  ('salishsea:' || o.id::text)::text                                            AS "occurrenceID",
  -- 2. basisOfRecord (ALIGN-02 / POLICY §3.1)
  'HumanObservation'::text                                                      AS "basisOfRecord",
  -- 3. eventDate (ALIGN-02, ALIGN-05) — full ISO-8601 UTC with Z suffix.
  -- Do NOT use the default timestamptz::text cast: it yields
  -- '2024-03-15 14:30:00+00' (space delimiter, sub-RFC-3339 offset).
  to_char(o.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')::text AS "eventDate",
  -- 4. scientificName (ALIGN-02, ALIGN-03) — leaf taxon name from the
  -- helper view. NEVER reconstruct a binomial; the helper already
  -- enforces M-05's higher-rank-only contract.
  tc.scientific_name::text                                                      AS "scientificName",
  -- 5. taxonRank (ALIGN-03)
  tc.taxon_rank::text                                                           AS "taxonRank",
  -- 6-11. kingdom..genus (ALIGN-03) — all from the helper. genus is
  -- NULL when the leaf taxon's own rank is family or higher.
  tc.kingdom::text                                                              AS "kingdom",
  tc.phylum::text                                                               AS "phylum",
  tc.class::text                                                                AS "class",
  tc.order_::text                                                               AS "order",
  tc.family::text                                                               AS "family",
  tc.genus::text                                                                AS "genus",
  -- 12. decimalLatitude (ALIGN-04) — ST_Y returns Y axis = latitude.
  -- Always cast geography→geometry before ST_X/ST_Y (matches the
  -- existing public.occurrences pattern).
  gis.ST_Y(o.subject_location::gis.geometry)::double precision                  AS "decimalLatitude",
  -- 13. decimalLongitude (ALIGN-04) — ST_X returns X axis = longitude.
  gis.ST_X(o.subject_location::gis.geometry)::double precision                  AS "decimalLongitude",
  -- 14. geodeticDatum (ALIGN-04) — constant per POLICY §3.1.
  'WGS84'::text                                                                 AS "geodeticDatum",
  -- 15. coordinateUncertaintyInMeters (ALIGN-04 / POLICY §3.1) —
  -- NULLIF collapses an accidental 0 to NULL. POLICY: omit when NULL;
  -- never emit 0 (a false claim of 1-meter precision).
  NULLIF(o.accuracy, 0)::integer                                                AS "coordinateUncertaintyInMeters",
  -- 16. individualCount (D-13 / POLICY §3.5) — source CHECK already
  -- enforces > 0; widen smallint → integer for UNION-ALL parity with
  -- the Maplify branch's number_sighted (Pitfall 4).
  o.count::integer                                                              AS "individualCount",
  -- 17. occurrenceStatus (D-12 / POLICY §3.4) — constant.
  'present'::text                                                               AS "occurrenceStatus",
  -- 18. occurrenceRemarks (POLICY §3.1) — strip HTML tags, then NULL out
  -- empty / whitespace-only results so the column is honestly NULL when
  -- there's no remark.
  NULLIF(TRIM(regexp_replace(o.body, '<[^>]+>', '', 'g')), '')::text             AS "occurrenceRemarks",
  -- 19. recordedBy (D-09 / POLICY §2.1)
  c.name::text                                                                  AS "recordedBy",
  -- 20. rightsHolder (D-09 / POLICY §2.1) — same value as recordedBy
  -- by policy (the observer holds the rights to their observation).
  c.name::text                                                                  AS "rightsHolder",
  -- 21. datasetName — the dataset title. Matches the single dwc.datasets
  -- row added in plan 05-04; if 05-04 picks a different title, update
  -- here.
  'SalishSea.io Cetacean Occurrences (v1.2)'::text                              AS "datasetName",
  -- 22. datasetID (D-17 / POLICY §6.3)
  'https://salishsea.io/datasets/occurrences-v1'::text                          AS "datasetID",
  -- 23. license (D-20 / POLICY §1.1) — CC-BY-NC 4.0 canonical /legalcode
  -- URI, constant for the native branch.
  'https://creativecommons.org/licenses/by-nc/4.0/legalcode'::text              AS "license",
  -- 24. dynamicProperties — Task 1 placeholder. Task 2 of plan 05-02
  -- replaces with the jsonb_strip_nulls(jsonb_build_object(...))::text
  -- expression (POLICY §2.3 + §2.4 native key set).
  NULL::text                                                                    AS "dynamicProperties",
  -- 25. informationWithheld (POLICY §2.4) — optional, NULL in v1.2.
  NULL::text                                                                    AS "informationWithheld"
FROM public.observations o
JOIN public.contributors c       ON c.id = o.contributor_id
JOIN dwc.taxa_classification tc  ON tc.taxon_id = o.taxon_id;

COMMENT ON VIEW dwc._native_occurrences IS 'Encodes 04-POLICY §3.1 (native gap table). Internal — Phase 6 reads dwc.occurrences (the UNION), never this branch directly.';

-- (continued: dwc.datasets, dwc._maplify_occurrences, dwc.occurrences, dwc.multimedia — appended by plans 05-03..05-04)

