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
  -- 24. dynamicProperties (POLICY §2.3 + §2.4) — native key set is
  -- exactly two keys: travelDirection (from o.direction enum cast to
  -- text) and unvalidatedIdentifiers (from public.extract_identifiers
  -- on the HTML body). Maplify-only keys (aggregatorSource,
  -- aggregatorChain, count-is-minimum) MUST NOT appear here.
  --
  -- Construction:
  --   * jsonb_build_object builds the object with both keys.
  --   * extract_identifiers already returns NULL (not '{}') on no
  --     match — exactly what we want. The outer NULLIF(..., '{}'::varchar[])
  --     is belt-and-suspenders against a future regex change that
  --     returns an empty array instead of NULL (Pitfall 6: do NOT wrap
  --     in COALESCE — we WANT NULL to propagate so jsonb_strip_nulls
  --     drops the key).
  --   * jsonb_strip_nulls drops keys whose value is JSON null.
  --   * Cast jsonb → text because Phase 6 treats this term as opaque
  --     text (POLICY §5.4) and to satisfy UNION-ALL type discipline
  --     with the Maplify branch (Pitfall 4).
  --   * Outer NULLIF(..., '{}') collapses an entirely-empty object to
  --     NULL so the column reads as NULL (not literal '{}') when a row
  --     has no dynamic properties at all.
  NULLIF(jsonb_strip_nulls(jsonb_build_object('travelDirection', o.direction::text, 'unvalidatedIdentifiers', NULLIF(public.extract_identifiers(o.body), ARRAY[]::varchar[])))::text, '{}'::text) AS "dynamicProperties",
  -- 25. informationWithheld (POLICY §2.4) — optional, NULL in v1.2.
  NULL::text                                                                    AS "informationWithheld"
FROM public.observations o
JOIN public.contributors c       ON c.id = o.contributor_id
JOIN dwc.taxa_classification tc  ON tc.taxon_id = o.taxon_id;

COMMENT ON VIEW dwc._native_occurrences IS 'Encodes 04-POLICY §3.1 (native gap table). Internal — Phase 6 reads dwc.occurrences (the UNION), never this branch directly.';

-- ---------------------------------------------------------------------
-- dwc._maplify_occurrences — projection of maplify.sightings
-- ---------------------------------------------------------------------
--
-- Plan 05-03 deliverable. One row per in-scope maplify.sightings row,
-- joined to dwc.taxa_classification (scientificName + Linnaean ranks)
-- and to a CROSS JOIN LATERAL that materializes the source→display-name
-- CASE exactly once per row (the canonical `dn.display_name` pattern
-- from RESEARCH §"Source mapping via CROSS JOIN LATERAL"). The LATERAL
-- value is reused in `rightsHolder`, `datasetName`, and (after Task 3)
-- `dynamicProperties` so the per-row source identity is a single source
-- of truth. Encodes 04-POLICY §3.2 (Maplify gap table) + §2.2 (D-10,
-- D-11 source mapping) + §5.3 (rwsas defensive filter) + §1.1 D-20
-- (Maplify CC-BY 4.0 via Acartia upstream).
--
-- Column contract mirror: this view emits the EXACT same 25 columns in
-- the EXACT same order with the EXACT same names and types as
-- dwc._native_occurrences above. UNION-ALL type drift is the canonical
-- view failure mode (RESEARCH Pitfall 4); every scalar carries an
-- explicit cast.
--
-- ALIGN requirement coverage from this view:
--   * ALIGN-01 — Maplify projection lives in dwc schema, sourced
--     directly from maplify.sightings (not the public.occurrences UI
--     matview).
--   * ALIGN-02 — occurrenceID, basisOfRecord, scientificName, eventDate
--     are all NOT NULL by construction.
--   * ALIGN-04 — ST_Y for lat, ST_X for lon, geodeticDatum = 'WGS84',
--     coordinateUncertaintyInMeters = NULL (no source column on
--     maplify.sightings — never fabricate; POLICY §3.2 gap).
--   * ALIGN-05 — eventDate is date-precision only (`YYYY-MM-DD`, no `T`
--     separator) per POLICY §3.2: `created_at` is report-receipt time
--     and emitting second precision would falsely imply sighting-time
--     precision.
--   * ALIGN-06 — occurrenceID = 'maplify:' || s.id::text; cannot
--     collide with the native branch's 'salishsea:' prefix.
--
-- Source→display CASE arms (Task 1 audit checkpoint):
--   The audit pause for `SELECT DISTINCT source FROM maplify.sightings`
--   was checkpoint-approved with POLICY-default arms (orca_network →
--   "Orca Network", cascadia → "Cascadia Research Collective", fallback
--   "Whale Alert / Maplify"). Plan 05-04's assertion suite + the user's
--   local-DB run will catch any drift if unknown source values appear
--   in production data — the `ELSE` fallback prevents data loss in the
--   meantime (POLICY §2.2 D-11 default).
--
-- D-03 source-drop lever (POLICY §4.1): the per-`maplify.source` drop is
-- "ready, not active" in v1.2 — the lever lives as a commented-out
-- predicate inside the WHERE block (see below).
--
-- `rwsas` defensive filter (POLICY §5.3 / RESEARCH Open Question 2
-- default): always include `AND s.source != 'rwsas'`, regardless of
-- whether ingest already filters — it is a free correctness guard.

CREATE VIEW dwc._maplify_occurrences AS
SELECT
  -- 1. occurrenceID (ALIGN-02, ALIGN-06)
  ('maplify:' || s.id::text)::text                                              AS "occurrenceID",
  -- 2. basisOfRecord (ALIGN-02 / POLICY §3.2)
  'HumanObservation'::text                                                      AS "basisOfRecord",
  -- 3. eventDate (ALIGN-02, ALIGN-05) — date-precision ONLY (no `T`
  -- separator) per POLICY §3.2: `created_at` is report-receipt time, not
  -- sighting time. `AT TIME ZONE 'GMT'` interprets the naive timestamp
  -- as UTC before extracting the date (RESEARCH Pitfall 7).
  ((s.created_at AT TIME ZONE 'GMT')::date)::text                               AS "eventDate",
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
  -- Cast geography→geometry before ST_X/ST_Y (mirrors native branch).
  gis.ST_Y(s.location::gis.geometry)::double precision                          AS "decimalLatitude",
  -- 13. decimalLongitude (ALIGN-04) — ST_X returns X axis = longitude.
  gis.ST_X(s.location::gis.geometry)::double precision                          AS "decimalLongitude",
  -- 14. geodeticDatum (ALIGN-04) — constant per POLICY §3.2.
  'WGS84'::text                                                                 AS "geodeticDatum",
  -- 15. coordinateUncertaintyInMeters (POLICY §3.2 gap) — no source
  -- column on maplify.sightings. Emit NULL; never fabricate.
  NULL::integer                                                                 AS "coordinateUncertaintyInMeters",
  -- 16. individualCount (D-13 / POLICY §3.5) — the WHERE clause's
  -- `BETWEEN 1 AND 1000` filter already bounds this; `number_sighted`
  -- is `integer NOT NULL` on the source table (UNION-ALL parity with
  -- the native branch's widened smallint→integer cast — Pitfall 4).
  s.number_sighted::integer                                                     AS "individualCount",
  -- 17. occurrenceStatus (D-12 / POLICY §3.4) — constant.
  'present'::text                                                               AS "occurrenceStatus",
  -- 18. occurrenceRemarks (POLICY §3.2) — strip HTML tags from comments,
  -- then NULL out empty / whitespace-only results so the column is
  -- honestly NULL when there's no remark.
  NULLIF(TRIM(regexp_replace(s.comments, '<[^>]+>', '', 'g')), '')::text         AS "occurrenceRemarks",
  -- 19. recordedBy (D-10 / POLICY §2.2) — Maplify usernm passes through
  -- NULL per D-10 (anonymous Whale Alert submissions exist).
  s.usernm::text                                                                AS "recordedBy",
  -- 20. rightsHolder (D-11 / POLICY §2.2) — per-source display name from
  -- the LATERAL CASE below. SINGLE SOURCE OF TRUTH per row: same value
  -- as `datasetName` (col 21) and `dynamicProperties.aggregatorSource`
  -- (col 24, set in Task 3).
  dn.display_name::text                                                         AS "rightsHolder",
  -- 21. datasetName (D-10 / POLICY §2.2) — for Maplify, this is the
  -- SUB-SOURCE name (e.g. "Orca Network"), NOT the parent dataset
  -- title (which is `datasetID`'s parent URI). This is the deliberate
  -- difference from the native branch, where `datasetName` carries the
  -- parent title.
  dn.display_name::text                                                         AS "datasetName",
  -- 22. datasetID (D-17 / POLICY §6.3) — same parent dataset URI as
  -- native branch; per-record `datasetID` matches the
  -- `dwc.datasets.dataset_id` constant on every row even though
  -- `datasetName` is sub-source-named (RESEARCH: "the join collapses
  -- to a single constant URI on every row").
  'https://salishsea.io/datasets/occurrences-v1'::text                          AS "datasetID",
  -- 23. license (D-20 / POLICY §1.1) — CC-BY 4.0 canonical /legalcode
  -- URI, constant for the Maplify branch (Acartia cooperative
  -- assertion).
  'https://creativecommons.org/licenses/by/4.0/legalcode'::text                 AS "license",
  -- 24. dynamicProperties (POLICY §2.3) — Maplify key set is exactly
  -- FOUR keys:
  --   * travelDirection: public.extract_travel_direction(s.comments) cast
  --     to text; NULL when no direction parsed → jsonb_strip_nulls drops
  --     the key.
  --   * aggregatorSource: dn.display_name from the LATERAL CASE; always
  --     non-null by construction (the CASE has an ELSE arm) so this key
  --     is always emitted (POLICY §2.3 "All Maplify records").
  --   * aggregatorChain: structured provenance string per POLICY §2.3
  --     example: 'Whale Alert / Maplify (WASEAK) > ' || dn.display_name.
  --     Always emitted (same reasoning).
  --   * unvalidatedIdentifiers: public.extract_identifiers(s.comments)
  --     wrapped in NULLIF(..., ARRAY[]::varchar[]) so an empty array
  --     collapses to NULL and jsonb_strip_nulls drops the key.
  --
  -- The Maplify-only "count-is-minimum" key is intentionally absent:
  -- D-14 is a no-op for v1.2 — `min_count` does not exist on
  -- maplify.sightings (POLICY §5.2 correction).
  --
  -- Construction mirrors the native branch's pattern: jsonb_build_object
  -- → jsonb_strip_nulls → ::text cast for UNION-ALL type discipline →
  -- outer NULLIF(..., '{}') for the (mostly belt-and-suspenders, since
  -- aggregatorSource/aggregatorChain always present) collapse of an
  -- all-null object to NULL.
  NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'travelDirection',        public.extract_travel_direction(s.comments)::text,
    'aggregatorSource',       dn.display_name,
    'aggregatorChain',        'Whale Alert / Maplify (WASEAK) > ' || dn.display_name,
    'unvalidatedIdentifiers', NULLIF(public.extract_identifiers(s.comments), ARRAY[]::varchar[])
  ))::text, '{}'::text)                                                         AS "dynamicProperties",
  -- 25. informationWithheld (POLICY §2.4) — optional, NULL in v1.2.
  NULL::text                                                                    AS "informationWithheld"
FROM maplify.sightings s
JOIN dwc.taxa_classification tc ON tc.taxon_id = s.taxon_id
-- The source→display-name CASE is materialized exactly ONCE per row by
-- the LATERAL. Reused in columns 20 (rightsHolder), 21 (datasetName),
-- and (in Task 3) 24 (dynamicProperties.aggregatorSource /
-- aggregatorChain). D-10/D-11 single source of truth per row.
--
-- Task 1 audit was checkpoint-approved with policy-default arms (POLICY
-- §2.2 D-10/D-11 baseline + D-11 fallback). The plan 05-04 assertion
-- suite + the user's local-DB run will catch any source-value drift if
-- unknown codes appear; the `ELSE` arm prevents data loss meantime.
CROSS JOIN LATERAL (
  SELECT
    CASE s.source
      WHEN 'orca_network' THEN 'Orca Network'::text
      WHEN 'cascadia' THEN 'Cascadia Research Collective'::text
      ELSE 'Whale Alert / Maplify'::text
    END AS display_name
) AS dn
-- Filter discipline (RESEARCH §"System Architecture Diagram"):
--   * NOT s.is_test — existing maplify hygiene.
--   * s.number_sighted BETWEEN 1 AND 1000 — D-13; mirrors the existing
--     public.occurrences UI view filter.
--   * s.source != 'rwsas' — POLICY §5.3 defensive; included
--     unconditionally per RESEARCH Open Question 2 default.
WHERE NOT s.is_test
  AND s.number_sighted BETWEEN 1 AND 1000
  AND s.source != 'rwsas'
  /* D-03 source-drop lever (POLICY §4.1): activate by uncommenting and listing sources to exclude */
  /* AND s.source NOT IN ('') */
;

COMMENT ON VIEW dwc._maplify_occurrences IS 'Encodes 04-POLICY §3.2 (Maplify gap table) + §2.2 (D-10/D-11 source mapping) + §5.3 (rwsas defensive filter). Internal — Phase 6 reads dwc.occurrences (the UNION), never this branch directly.';

-- ---------------------------------------------------------------------
-- dwc.occurrences — UNION ALL of the two branch views (M-02)
-- ---------------------------------------------------------------------
--
-- Plan 05-04 deliverable. Phase 6's DuckDB ATTACH + COPY pipeline reads
-- this view directly; the two leading-underscore branches are internal
-- and must not be consumed by downstream code.
--
-- UNION-ALL discipline (RESEARCH Pitfall 4): Postgres enforces column
-- count, name, and type parity at view-creation time. The two branch
-- views each emit the same 25 columns in the same order with explicit
-- per-column casts; if either branch drifts in a future migration, this
-- CREATE VIEW raises and the migration fails loudly. This is exactly the
-- desired semantic — no silent type coercion across the source boundary.
--
-- ALIGN-01 closure: rows in dwc.occurrences come from EXACTLY two
-- sources (native + Maplify); iNaturalist and HappyWhale are excluded
-- by construction (POLICY §5.1) — they are simply not in the UNION.
CREATE VIEW dwc.occurrences AS
SELECT * FROM dwc._native_occurrences
UNION ALL
SELECT * FROM dwc._maplify_occurrences;

COMMENT ON VIEW dwc.occurrences IS 'Encodes 04-POLICY §3.1 (native) and §3.2 (Maplify) via M-02 UNION ALL of dwc._native_occurrences and dwc._maplify_occurrences. Read by Phase 6 (DuckDB ATTACH + COPY to CSV/GeoParquet).';

-- ---------------------------------------------------------------------
-- dwc.datasets — single-row dataset reification (M-03 / D-15..D-18)
-- ---------------------------------------------------------------------
--
-- Plan 05-04 deliverable. Encodes 04-POLICY §6.2 (dataset schema) +
-- D-15 (view-over-VALUES form) + D-16 (single row in v1.2) + D-17
-- (datasetID URI scheme) + D-18 (publisher org + individual contact).
--
-- Form (M-03): a view over a literal VALUES list. Every metadata edit
-- becomes a migration — version-controlled, reviewable, and surviving
-- `supabase db reset` without a separate seed step. The 19-column shape
-- is sized for future per-constituent rows (POLICY §6.2) but ships with
-- exactly one row in v1.2.
--
-- Field-by-field provenance:
--   * dataset_id            — D-17 / POLICY §6.3 ("not load-bearing"); the
--                             `occurrences-v1` slug anticipates a v2 archive.
--   * parent_dataset_id     — NULL: no parent in v1.2 (D-16).
--   * title                 — must match the constant emitted by
--                             dwc._native_occurrences."datasetName" verbatim.
--   * abstract              — placeholder per POLICY §6.7 "Phase 6 authors";
--                             Phase 6 may overwrite in a follow-up migration.
--   * pub_date              — CURRENT_DATE at the time `supabase db reset`
--                             runs; Phase 6 may pin a constant date later.
--   * language              — 'en'.
--   * intellectual_rights   — CC-BY-NC 4.0 /legalcode URI (POLICY §1.1
--                             native default for the single v1.2 row).
--                             Maplify per-row CC-BY URI joins by §6.6
--                             reconciliation when a Maplify constituent
--                             row is added in the future.
--   * creator_*             — D-18: organizational publisher
--                             ("SalishSea.io", role "originator").
--   * metadata_provider_*   — same org, role "metadataProvider".
--   * contact_*             — D-18: individual point of contact (Peter
--                             Abrahamsen, rainhead@gmail.com), role
--                             "pointOfContact"; M-04 commits the email
--                             verbatim because supabase/migrations/ is
--                             application code (not .planning/).
--   * geographic_coverage   — POLICY §6.7: Phase 6 authors. Placeholder
--                             NULL here.
--   * temporal_coverage     — POLICY §6.5: Phase 6 computes at generation
--                             time. NULL here.
--   * taxonomic_coverage    — POLICY §6.5: "Cetacea (Order)" stated.
--   * methods               — POLICY §6.7: Phase 6 authors. NULL here.
CREATE VIEW dwc.datasets AS
SELECT * FROM (
  VALUES (
    'https://salishsea.io/datasets/occurrences-v1'::text,           -- dataset_id (D-17)
    NULL::text,                                                     -- parent_dataset_id (D-16)
    'SalishSea.io Cetacean Occurrences (v1.2)'::text,               -- title (must equal native datasetName constant)
    'Native and Maplify/Whale Alert cetacean sighting records from the Salish Sea region. Authored from observation tables in the SalishSea.io database, expressed as DarwinCore-aligned columns.'::text,  -- abstract (placeholder; Phase 6 authors — POLICY §6.7)
    CURRENT_DATE::text,                                             -- pub_date (Phase 6 may pin a constant)
    'en'::text,                                                     -- language
    'https://creativecommons.org/licenses/by-nc/4.0/legalcode'::text, -- intellectual_rights (POLICY §1.1 native default; §6.6 reconciles Maplify per-row)
    'SalishSea.io'::text,                                           -- creator_name (D-18 organizational publisher)
    'rainhead@gmail.com'::text,                                     -- creator_email (M-04)
    'originator'::text,                                             -- creator_role
    'SalishSea.io'::text,                                           -- metadata_provider_name
    'rainhead@gmail.com'::text,                                     -- metadata_provider_email (M-04)
    'Peter Abrahamsen'::text,                                       -- contact_name (D-18 individual)
    'rainhead@gmail.com'::text,                                     -- contact_email (M-04, D-18)
    'pointOfContact'::text,                                         -- contact_role
    NULL::text,                                                     -- geographic_coverage (Phase 6 authors — POLICY §6.7)
    NULL::text,                                                     -- temporal_coverage (Phase 6 computes at gen time — POLICY §6.5)
    'Cetacea (Order)'::text,                                        -- taxonomic_coverage (POLICY §6.5 stated)
    NULL::text                                                      -- methods (Phase 6 authors — POLICY §6.7)
  )
) AS d (
  dataset_id,
  parent_dataset_id,
  title,
  abstract,
  pub_date,
  language,
  intellectual_rights,
  creator_name,
  creator_email,
  creator_role,
  metadata_provider_name,
  metadata_provider_email,
  contact_name,
  contact_email,
  contact_role,
  geographic_coverage,
  temporal_coverage,
  taxonomic_coverage,
  methods
);

COMMENT ON VIEW dwc.datasets IS 'M-03 single-row dataset reification (D-15..D-18). Phase 6 reads this for EML. Future per-constituent rows added by extension migration (POLICY §6.2 sized for this).';

-- ---------------------------------------------------------------------
-- dwc.multimedia — GBIF Simple Multimedia extension (native-only)
-- ---------------------------------------------------------------------
--
-- Plan 05-04 deliverable. Encodes 04-POLICY §3.3 (multimedia gap table)
-- + §1.2 (per-photo license CASE) + §1.4 (none/NULL license exclusion).
--
-- Shape: 1-to-N per occurrence (each observation can have multiple
-- photos). The DwC-A two-file structure encodes this as a separate
-- `multimedia.csv` joined to `occurrence.csv` on coreId (DWCA-03).
-- Phase 6 will `COPY dwc.multimedia TO 'multimedia.csv'` as a one-liner.
--
-- coreId join: `'salishsea:' || op.observation_id::text` matches the
-- `occurrenceID` emitted by dwc._native_occurrences (col 1), so every
-- multimedia row has a corresponding occurrence row. The assertion suite
-- enforces this (DWCA-03 readiness).
--
-- Native-only (POLICY §1.4 / §3.2): Maplify photos lack a license column
-- on `maplify.sightings.photo_url`; A3 says no implied license, so all
-- Maplify photos are excluded entirely. This view does not reference
-- maplify.sightings at all.
--
-- License CASE (POLICY §1.2 + D-19):
--   * The seven CC enum members map to their canonical `/legalcode`
--     URIs.
--   * D-19 distinguishes two semantically distinct "no URI" branches:
--     - `WHEN 'none' THEN NULL` — terminal: "no redistributable
--       license" (contributor or ingest classified the photo unlicensed).
--     - `ELSE NULL` — catches IS NULL ("license unknown / unclassified",
--       non-terminal — a future classification workflow may resolve).
--   * Both branches are excluded by the WHERE clause in v1.2, but the
--     distinction is preserved in the CASE for forward-compatibility
--     (Discrepancy 2 in migration header: the IS NULL arm is currently
--     unreachable on public.observation_photos.license_code because the
--     NOT NULL constraint was preserved from the initial schema; the
--     branch is encoded for a future `DROP NOT NULL`).
--
-- Filter placement (POLICY §1.4): exclude both `'none'` and IS NULL in
-- the view body (`WHERE op.license_code IS NOT NULL AND op.license_code <> 'none'`).
-- The CASE stays pure (every license code in → URI or NULL out), and the
-- filter is inspectable separately (delta between public.observation_photos
-- count and dwc.multimedia count is directly readable).
--
-- Column set: per GBIF Simple Multimedia extension. v1.2 emits the six
-- columns we have honest data for: coreId, type, identifier, license,
-- rightsHolder, creator. Optional columns (format, references, title,
-- description, created, contributor, publisher, audience) are omitted
-- entirely rather than emitted as NULL.
CREATE VIEW dwc.multimedia AS
SELECT
  -- coreId — join key to dwc.occurrences."occurrenceID" (DWCA-03).
  ('salishsea:' || op.observation_id::text)::text                            AS "coreId",
  -- type — POLICY §3.3: all native photos are still images.
  'StillImage'::text                                                          AS "type",
  -- identifier — the photo URL.
  op.href::text                                                               AS "identifier",
  -- license — POLICY §1.2 CASE + D-19 two distinct NULL branches.
  CASE op.license_code
    WHEN 'cc0'         THEN 'https://creativecommons.org/publicdomain/zero/1.0/legalcode'
    WHEN 'cc-by'       THEN 'https://creativecommons.org/licenses/by/4.0/legalcode'
    WHEN 'cc-by-nc'    THEN 'https://creativecommons.org/licenses/by-nc/4.0/legalcode'
    WHEN 'cc-by-sa'    THEN 'https://creativecommons.org/licenses/by-sa/4.0/legalcode'
    WHEN 'cc-by-nd'    THEN 'https://creativecommons.org/licenses/by-nd/4.0/legalcode'
    WHEN 'cc-by-nc-sa' THEN 'https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode'
    WHEN 'cc-by-nc-nd' THEN 'https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode'
    /* D-19 / POLICY §1.2: NULL ('unknown') and 'none' ('no license') are semantically distinct; both excluded in v1.2 by the WHERE clause. NULL arm currently unreachable on public.observation_photos.license_code (NOT NULL constraint preserved); encoded for forward-compat with a future DROP NOT NULL — see Discrepancy 2 in 05-RESEARCH. */
    WHEN 'none'        THEN NULL  -- terminal: "no redistributable license"
    ELSE NULL                      -- catches IS NULL: "unknown / unclassified", non-terminal
  END::text                                                                   AS "license",
  -- rightsHolder — inherit from observation's contributor (D-09 mirror).
  c.name::text                                                                AS "rightsHolder",
  -- creator — same as rightsHolder for native photos.
  c.name::text                                                                AS "creator"
FROM public.observation_photos op
JOIN public.observations  o ON o.id = op.observation_id
JOIN public.contributors  c ON c.id = o.contributor_id
-- POLICY §1.4: exclude both 'none' (terminal) and NULL (unknown). The
-- NULL exclusion is forward-compat (Discrepancy 2: license_code is
-- currently NOT NULL on public.observation_photos so the predicate is
-- a no-op today; preserved for a future DROP NOT NULL).
WHERE op.license_code IS NOT NULL
  AND op.license_code <> 'none'
ORDER BY op.observation_id, op.seq;

COMMENT ON VIEW dwc.multimedia IS 'GBIF Simple Multimedia extension; encodes 04-POLICY §3.3 + §1.2 (license CASE) + §1.4 (none/NULL exclusion). Native photos only; Maplify photo_url is license-less per POLICY §1.4 and excluded. Phase 6 reads this for the Multimedia extension CSV.';

-- ---------------------------------------------------------------------
-- Broad SELECT grant — every view in schema dwc (Pitfall 5)
-- ---------------------------------------------------------------------
--
-- Deferred from plan 05-01 so it covers every view in one statement.
-- "ALL TABLES" includes views in Postgres. Service-role inherits via
-- Supabase defaults; we grant SELECT explicitly only to anon and
-- authenticated. The schema-level USAGE grant from plan 05-01 makes the
-- views queryable; the SELECT grants here make their rows readable.
--
-- API exposure remains intentionally restricted: dwc is NOT in
-- supabase/config.toml:api.schemas, so PostgREST will not expose these
-- views even with SELECT granted. The grant is for the Phase 7 DuckDB
-- connection (postgres role inherits) and any future direct-psql
-- consumer.
GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated;

