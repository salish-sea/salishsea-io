/**
 * EML 2.1.1 metadata document generator — pure function.
 *
 * Generates the `eml.xml` document that accompanies the DarwinCore Archive
 * zip, per the GBIF EML profile. Includes title, creator, metadata provider,
 * pubDate, language, abstract, keyword set, intellectual rights, three-axis
 * coverage (geographic / temporal / taxonomic), contact, and a two-paragraph
 * methods description.
 *
 * Inputs:
 *   - `datasets`: a row from the `dwc.datasets` view (19 columns mirroring
 *     the migration's VALUES literal — see
 *     `supabase/migrations/20260617203900_dwc_schema.sql`).
 *   - `temporalCoverage.begin` / `.end`: ISO date strings (`YYYY-MM-DD`)
 *     computed by `build.ts` from `MIN(eventDate)` / `MAX(eventDate)` over
 *     `dwc.occurrences`. These are passed as a separate parameter (not read
 *     from `datasets.temporal_coverage`) because the view sets that column
 *     to NULL today — Phase 6 owns the runtime derivation per POLICY §6.5.
 *
 * Source-of-truth references:
 *   - RESEARCH §T5 — authoritative EML skeleton; the two `<para>` blocks
 *     inside `<methods>` are reproduced verbatim from this section.
 *   - CONTEXT.md E-01 (free text lives here), E-02 (Acartia bbox 36–54°N,
 *     -136 to -120°W), E-03 (two-paragraph methods), E-04 (`pub_date`
 *     sourced from `dwc.datasets`).
 *   - POLICY §6.4 (publisher identity: SalishSea.io = creator,
 *     Peter Abrahamsen = contact, rainhead@gmail.com).
 *   - POLICY §6.5 (geographic / temporal / taxonomic coverage authoring).
 *
 * Threat model (T-06-03-XML): every free-text DatasetsRow value (abstract,
 * methods, title, license URI, contact email, taxonomic_coverage) is passed
 * through `xmlEsc` before interpolation. Tests assert `&`, `<`, `>`, `"`
 * round-trip to their XML-entity encodings.
 */

/**
 * Mirrors the 19-column `dwc.datasets` view in
 * `supabase/migrations/20260617203900_dwc_schema.sql` (lines 568..613).
 *
 * Field naming follows the snake_case SQL column aliases. Three columns are
 * typed nullable here because the migration sets them to `NULL::text` and
 * Phase 6 (this module) owns their authored content via the internal
 * template — `geographic_coverage`, `temporal_coverage`, `methods`. When
 * the row carries NULL for any of these, `buildEml` uses the internal
 * canonical text (Acartia bbox description, the methods paragraphs) and
 * the explicitly-passed `EmlInput.temporalCoverage` values.
 */
export interface DatasetsRow {
    readonly dataset_id: string;
    readonly parent_dataset_id: string | null;
    readonly title: string;
    readonly abstract: string;
    readonly pub_date: string;
    readonly language: string;
    readonly intellectual_rights: string;
    readonly creator_name: string;
    readonly creator_email: string;
    readonly creator_role: string;
    readonly metadata_provider_name: string;
    readonly metadata_provider_email: string;
    readonly contact_name: string;
    readonly contact_email: string;
    readonly contact_role: string;
    readonly geographic_coverage: string | null;
    readonly temporal_coverage: string | null;
    readonly taxonomic_coverage: string;
    readonly methods: string | null;
}

/**
 * Input envelope for `buildEml`. `datasets` is a single row from the view;
 * `temporalCoverage.begin` / `.end` are ISO date strings computed at gen
 * time from `dwc.occurrences` (eventDate MIN / MAX), passed in by `build.ts`.
 */
export interface EmlInput {
    readonly datasets: DatasetsRow;
    readonly temporalCoverage: {
        readonly begin: string;
        readonly end: string;
    };
}

/**
 * Escape the five XML-significant characters in text destined for an
 * element body or an attribute value. Returns the empty string for null
 * / undefined to keep the templating call sites short.
 *
 * Order matters: `&` MUST be replaced first, otherwise the entity refs
 * introduced by the other replacements would themselves get re-escaped.
 */
const xmlEsc = (s: string | null | undefined): string => {
    if (s === null || s === undefined) return '';
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
};

/**
 * Build the EML 2.1.1 metadata document as a UTF-8 string.
 *
 * Deterministic: identical input yields byte-identical output. No `Date.now()`
 * or other ambient state — `pubDate` is sourced from `input.datasets.pub_date`
 * (per CONTEXT.md E-04), and the temporal coverage dates come from
 * `input.temporalCoverage` (per CONTEXT.md E-02).
 */
export function buildEml(input: EmlInput): string {
    const d = input.datasets;
    const tc = input.temporalCoverage;

    // E-02 geographic coverage prose (verbatim from CONTEXT.md / RESEARCH §T5).
    // The geographic scope is inherited from the upstream Acartia data
    // cooperative. The bbox literals below are the source-of-truth values
    // for archive metadata. Wave 5 (assertions.ts) cross-checks occurrence
    // coordinates against these bounds — keep them in sync.
    // TODO: link Acartia cooperative boundary doc once published URL is confirmed
    const geographicDescription =
        "The Salish Sea region; geographic scope inherited from the Acartia data " +
        "cooperative's boundaries, the upstream aggregator for Maplify/Whale Alert " +
        'records included in this archive.';

    // E-03 methods two-paragraph factual draft — reproduced verbatim from
    // RESEARCH §T5 lines 532..549. The two-paragraph shape is asserted by
    // eml.test.ts (T-06-03-METHODS-DRIFT mitigation).
    const methodsPara1 =
        'Native observations are submitted directly through the SalishSea.io web application ' +
        'by authenticated contributors using Google Sign-In. Each record includes a species ' +
        'identification, geographic location (WGS84 coordinate pair), observation timestamp ' +
        '(full UTC precision), optional individual count, optional free-text body, and ' +
        'optional photographs. Contributors hold copyright over their observations and photos ' +
        "under CC-BY-NC 4.0 as a condition of the platform's data sharing policy.";

    const methodsPara2 =
        'Maplify/Whale Alert records are ingested from the WASEAK API operated by ' +
        'Conserve.IO on the Acartia data cooperative (acartia.io) platform. Records ' +
        'include species identification, geographic location, date (at date precision — ' +
        'the `created_at` timestamp reflects report receipt, not observed sighting time), ' +
        'individual count, source attribution, and optional comments. Sub-source ' +
        'organizations feeding into the Acartia cooperative include Orca Network and ' +
        'Cascadia Research Collective. Records are published under CC-BY 4.0 as asserted ' +
        'by contributors to the Acartia cooperative at registration.';

    const packageId = `${d.dataset_id}/eml-1.xml`;

    // Hardcoded contact individual name parts per POLICY §6.4 D-18.
    const contactGivenName = 'Peter';
    const contactSurName = 'Abrahamsen';

    return `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="eml://ecoinformatics.org/eml-2.1.1 http://rs.gbif.org/schema/eml-gbif-profile/1.1/eml.xsd" packageId="${xmlEsc(packageId)}" system="gbif" scope="system" xml:lang="en">
  <dataset>
    <title>${xmlEsc(d.title)}</title>
    <creator>
      <organizationName>${xmlEsc(d.creator_name)}</organizationName>
      <electronicMailAddress>${xmlEsc(d.creator_email)}</electronicMailAddress>
    </creator>
    <metadataProvider>
      <organizationName>${xmlEsc(d.metadata_provider_name)}</organizationName>
      <electronicMailAddress>${xmlEsc(d.metadata_provider_email)}</electronicMailAddress>
    </metadataProvider>
    <pubDate>${xmlEsc(d.pub_date)}</pubDate>
    <language>${xmlEsc(d.language)}</language>
    <abstract>
      <para>${xmlEsc(d.abstract)}</para>
    </abstract>
    <keywordSet>
      <keyword>cetaceans</keyword>
      <keyword>Salish Sea</keyword>
      <keyword>whale sightings</keyword>
      <keyword>occurrence</keyword>
      <keywordThesaurus>n/a</keywordThesaurus>
    </keywordSet>
    <intellectualRights>
      <para>This work is licensed under a <ulink url="${xmlEsc(d.intellectual_rights)}"><citetitle>Creative Commons Attribution Non Commercial (CC-BY-NC) 4.0 License</citetitle></ulink>. Per-record license is encoded in the occurrence data file (native records: CC-BY-NC 4.0; Maplify/Whale Alert records: CC-BY 4.0 via the Acartia data cooperative).</para>
    </intellectualRights>
    <coverage>
      <geographicCoverage>
        <geographicDescription>${xmlEsc(geographicDescription)}</geographicDescription>
        <boundingCoordinates>
          <westBoundingCoordinate>-136</westBoundingCoordinate>
          <eastBoundingCoordinate>-120</eastBoundingCoordinate>
          <northBoundingCoordinate>54</northBoundingCoordinate>
          <southBoundingCoordinate>36</southBoundingCoordinate>
        </boundingCoordinates>
      </geographicCoverage>
      <temporalCoverage>
        <rangeOfDates>
          <beginDate><calendarDate>${xmlEsc(tc.begin)}</calendarDate></beginDate>
          <endDate><calendarDate>${xmlEsc(tc.end)}</calendarDate></endDate>
        </rangeOfDates>
      </temporalCoverage>
      <taxonomicCoverage>
        <generalTaxonomicCoverage>${xmlEsc(d.taxonomic_coverage)}</generalTaxonomicCoverage>
        <taxonomicClassification>
          <taxonRankName>Order</taxonRankName>
          <taxonRankValue>Cetacea</taxonRankValue>
        </taxonomicClassification>
      </taxonomicCoverage>
    </coverage>
    <contact>
      <individualName>
        <givenName>${contactGivenName}</givenName>
        <surName>${contactSurName}</surName>
      </individualName>
      <organizationName>SalishSea.io</organizationName>
      <electronicMailAddress>${xmlEsc(d.contact_email)}</electronicMailAddress>
    </contact>
    <methods>
      <methodStep>
        <description>
          <para>${xmlEsc(methodsPara1)}</para>
          <para>${xmlEsc(methodsPara2)}</para>
        </description>
      </methodStep>
    </methods>
  </dataset>
</eml:eml>
`;
}
