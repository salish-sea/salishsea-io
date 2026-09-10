-- dwc.export_coverage: what each branch of the DwC-A export drops, and why
-- (bd salish-lv0).
--
-- dwc._native_occurrences inner-joins contributors, taxa_classification and
-- collections; dwc._maplify_occurrences inner-joins taxa_classification. A
-- source row any of those joins cannot resolve leaves the archive with no
-- error: observations.contributor_id has been nullable since 20260619203013
-- (D-11), and maplify.sightings.taxon_id is NULL whenever taxon mapping fails.
-- Excluding an unclassifiable sighting is defensible. Doing it silently is not,
-- because a regression that zeroes a branch looks exactly like a quiet one.
--
-- One row per branch: how many source rows the branch's policy admits, how
-- many the export view returns, and how many fail each join. A row can fail
-- more than one join, so the causes need not sum to the difference.
-- scripts/dwca/build.ts reads this, logs it, and fails the build when a branch
-- exports nothing it had rows for.
--
-- The Maplify WHERE mirrors dwc._maplify_occurrences' on purpose. Those are
-- policy exclusions — D-05 trusted-only, D-13 count bounds, POLICY §5.3 rwsas,
-- test rows — not losses, so they sit outside source_rows. Change one, change
-- the other.
--
-- Operational: read by the nightly build as postgres. No anon or authenticated
-- grant, deliberately — nothing a client needs, and the read-grants fixture
-- (supabase/read-grants.test.ts) stays as it is.
CREATE VIEW dwc.export_coverage AS
WITH native AS (
    SELECT
        count(*) AS source_rows,
        count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM public.contributors c WHERE c.id = o.contributor_id)) AS no_contributor,
        count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM dwc.taxa_classification tc WHERE tc.taxon_id = o.taxon_id)) AS no_taxon,
        count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM public.collections cc WHERE cc.id = o.collection_id)) AS no_collection
    FROM public.observations o
),
maplify AS (
    SELECT
        count(*) AS source_rows,
        count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM dwc.taxa_classification tc WHERE tc.taxon_id = s.taxon_id)) AS no_taxon
    FROM maplify.sightings s
    WHERE NOT s.is_test
      AND s.number_sighted BETWEEN 1 AND 1000
      AND s.source != 'rwsas'
      AND s.trusted
)
SELECT
    'native'::text AS branch,
    source_rows,
    (SELECT count(*) FROM dwc._native_occurrences) AS exported_rows,
    no_contributor,
    no_taxon,
    no_collection
FROM native
UNION ALL
SELECT
    'maplify'::text,
    source_rows,
    (SELECT count(*) FROM dwc._maplify_occurrences),
    NULL::bigint,
    no_taxon,
    NULL::bigint
FROM maplify;

COMMENT ON VIEW dwc.export_coverage IS
  'One row per DwC-A export branch: source rows the branch policy admits, rows the export view returns, rows failing each inner join (NULL where the branch has no such join). Read and logged by scripts/dwca/build.ts, which fails when a branch exports nothing it had rows for (salish-lv0).';
