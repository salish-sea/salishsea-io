/**
 * DarwinCore Archive field definitions — source of truth for Phase 6 archive
 * generation.
 *
 * Each entry pairs a column `name` (used as the header in the data file and
 * as the field name in `meta.xml`) with the canonical DarwinCore (or dcterms,
 * or GBIF extension) `termUri`. The array index is load-bearing: it is both
 * the column ordinal in the generated TSV/CSV AND the field index emitted
 * into `meta.xml`. The migration that projects rows for export pins its
 * `SELECT` column order to this same ordinal, so reordering an entry without
 * a matching migration edit silently corrupts the archive.
 *
 * F-03 invariant: every `termUri` is carried literally per entry — there is
 * no name → URI derivation function. Most occurrence entries use the
 * `http://rs.tdwg.org/dwc/terms/` namespace, but two carry Dublin Core URIs
 * (indices 19 `rightsHolder` and 22 `license`). The multimedia array is
 * almost entirely Dublin Core, but its first entry (`coreId`) is the
 * GBIF Simple Multimedia extension's coreid URI.
 *
 * Cross-reference: see `.planning/phases/06-archive-generation/06-CONTEXT.md`
 * F-01 for the field-shape contract and F-03 for the ordinal-stability rule.
 * Column-order parity with `dwc._native_occurrences` and `dwc.multimedia` in
 * `supabase/migrations/20260617203900_dwc_schema.sql` is enforced statically
 * by `fields.test.ts` (DWCA-02 unit surface) and at runtime by Plan 03's
 * `assertions.ts`.
 */

export type OccurrenceField = {
    readonly name: string;
    readonly termUri: string;
};

export type MultimediaField = {
    readonly name: string;
    readonly termUri: string;
};

/**
 * Canonical 25-entry occurrence field list. Order MUST match the column
 * order of `dwc._native_occurrences` (and, by UNION ALL inheritance,
 * `dwc.occurrences`) in `supabase/migrations/20260617203900_dwc_schema.sql`.
 *
 * Namespace divergence (F-03 — URIs are data, not derived):
 *   - index 19 (`rightsHolder`) → `http://purl.org/dc/terms/` (Dublin Core)
 *   - index 22 (`license`)      → `http://purl.org/dc/terms/` (Dublin Core)
 *   - all other 23 entries      → `http://rs.tdwg.org/dwc/terms/` (Darwin Core)
 */
export const OCCURRENCE_FIELDS = [
    { name: 'occurrenceID', termUri: 'http://rs.tdwg.org/dwc/terms/occurrenceID' },
    { name: 'basisOfRecord', termUri: 'http://rs.tdwg.org/dwc/terms/basisOfRecord' },
    { name: 'eventDate', termUri: 'http://rs.tdwg.org/dwc/terms/eventDate' },
    { name: 'scientificName', termUri: 'http://rs.tdwg.org/dwc/terms/scientificName' },
    { name: 'taxonRank', termUri: 'http://rs.tdwg.org/dwc/terms/taxonRank' },
    { name: 'kingdom', termUri: 'http://rs.tdwg.org/dwc/terms/kingdom' },
    { name: 'phylum', termUri: 'http://rs.tdwg.org/dwc/terms/phylum' },
    { name: 'class', termUri: 'http://rs.tdwg.org/dwc/terms/class' },
    { name: 'order', termUri: 'http://rs.tdwg.org/dwc/terms/order' },
    { name: 'family', termUri: 'http://rs.tdwg.org/dwc/terms/family' },
    { name: 'genus', termUri: 'http://rs.tdwg.org/dwc/terms/genus' },
    { name: 'decimalLatitude', termUri: 'http://rs.tdwg.org/dwc/terms/decimalLatitude' },
    { name: 'decimalLongitude', termUri: 'http://rs.tdwg.org/dwc/terms/decimalLongitude' },
    { name: 'geodeticDatum', termUri: 'http://rs.tdwg.org/dwc/terms/geodeticDatum' },
    { name: 'coordinateUncertaintyInMeters', termUri: 'http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters' },
    { name: 'individualCount', termUri: 'http://rs.tdwg.org/dwc/terms/individualCount' },
    { name: 'occurrenceStatus', termUri: 'http://rs.tdwg.org/dwc/terms/occurrenceStatus' },
    { name: 'occurrenceRemarks', termUri: 'http://rs.tdwg.org/dwc/terms/occurrenceRemarks' },
    { name: 'recordedBy', termUri: 'http://rs.tdwg.org/dwc/terms/recordedBy' },
    // dcterms — NOT dwc/terms; per F-03 the URI is carried literally per entry.
    { name: 'rightsHolder', termUri: 'http://purl.org/dc/terms/rightsHolder' },
    { name: 'datasetName', termUri: 'http://rs.tdwg.org/dwc/terms/datasetName' },
    { name: 'datasetID', termUri: 'http://rs.tdwg.org/dwc/terms/datasetID' },
    // dcterms — NOT dwc/terms; per F-03 the URI is carried literally per entry.
    { name: 'license', termUri: 'http://purl.org/dc/terms/license' },
    { name: 'dynamicProperties', termUri: 'http://rs.tdwg.org/dwc/terms/dynamicProperties' },
    { name: 'informationWithheld', termUri: 'http://rs.tdwg.org/dwc/terms/informationWithheld' },
] as const satisfies readonly OccurrenceField[];

/**
 * Canonical 6-entry multimedia (GBIF Simple Multimedia extension) field
 * list. Order MUST match the column order of `dwc.multimedia` in
 * `supabase/migrations/20260617203900_dwc_schema.sql`.
 *
 * Namespace divergence (F-03 — URIs are data, not derived):
 *   - index 0 (`coreId`) → `http://rs.gbif.org/terms/1.0/coreid` (GBIF extension)
 *   - indices 1..5       → `http://purl.org/dc/terms/` (Dublin Core)
 */
export const MULTIMEDIA_FIELDS = [
    // GBIF Simple Multimedia extension — NOT dwc/terms and NOT dcterms; the
    // coreid term is defined by the extension descriptor itself.
    { name: 'coreId', termUri: 'http://rs.gbif.org/terms/1.0/coreid' },
    { name: 'type', termUri: 'http://purl.org/dc/terms/type' },
    { name: 'identifier', termUri: 'http://purl.org/dc/terms/identifier' },
    { name: 'license', termUri: 'http://purl.org/dc/terms/license' },
    { name: 'rightsHolder', termUri: 'http://purl.org/dc/terms/rightsHolder' },
    { name: 'creator', termUri: 'http://purl.org/dc/terms/creator' },
] as const satisfies readonly MultimediaField[];
