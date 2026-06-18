import { describe, test, expect } from 'vitest';
import { buildEml } from './eml.ts';
import type { DatasetsRow, EmlInput } from './eml.ts';

/**
 * Unit tests for `buildEml` — pure string-shape assertions over the EML
 * document output. Mirrors RESEARCH §T5 (skeleton) and CONTEXT.md E-01..E-04
 * (free-text decisions, Acartia bbox, two-paragraph methods, pubDate
 * sourcing). The mock `DatasetsRow` reflects the literal VALUES row in the
 * migration so the assertions are anchored to production data.
 *
 * Not covered here: GBIF schema validity (XSD). That is the manual
 * `gbif.org/tools/data-validator` checkpoint scheduled at the end of Plan 06.
 */

/**
 * Mock `DatasetsRow` reflecting the literal VALUES tuple in
 * `supabase/migrations/20260617203900_dwc_schema.sql` lines 568..613.
 * The view's NULL columns (geographic_coverage, temporal_coverage, methods)
 * are passed through as null — `buildEml` is expected to use its own
 * authored text for these per E-01 / E-03.
 */
const mockDatasets: DatasetsRow = {
    dataset_id: 'https://salishsea.io/datasets/occurrences-v1',
    parent_dataset_id: null,
    title: 'SalishSea.io Cetacean Occurrences (v1.2)',
    abstract:
        'Native and Maplify/Whale Alert cetacean sighting records from the Salish Sea region. ' +
        'Authored from observation tables in the SalishSea.io database, expressed as ' +
        'DarwinCore-aligned columns.',
    pub_date: '2026-06-17',
    language: 'en',
    intellectual_rights: 'https://creativecommons.org/licenses/by-nc/4.0/legalcode',
    creator_name: 'SalishSea.io',
    creator_email: 'rainhead@gmail.com',
    creator_role: 'originator',
    metadata_provider_name: 'SalishSea.io',
    metadata_provider_email: 'rainhead@gmail.com',
    contact_name: 'Peter Abrahamsen',
    contact_email: 'rainhead@gmail.com',
    contact_role: 'pointOfContact',
    geographic_coverage: null,
    temporal_coverage: null,
    taxonomic_coverage: 'Cetacea (Order)',
    methods: null,
};

const mockInput: EmlInput = {
    datasets: mockDatasets,
    temporalCoverage: { begin: '2020-01-01', end: '2026-06-17' },
};

describe('buildEml — required elements present', () => {
    test('XML prolog on line 1 and eml:eml root', () => {
        const xml = buildEml(mockInput);
        const firstLine = xml.split('\n')[0];
        expect(firstLine).toBe('<?xml version="1.0" encoding="UTF-8"?>');
        expect(xml).toContain('<eml:eml');
    });

    test('packageId, system, scope, xml:lang attributes', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('packageId="https://salishsea.io/datasets/occurrences-v1/eml-1.xml"');
        expect(xml).toContain('system="gbif"');
        expect(xml).toContain('scope="system"');
        expect(xml).toContain('xml:lang="en"');
    });

    test('schemaLocation references the GBIF EML profile XSD', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain(
            'xsi:schemaLocation="eml://ecoinformatics.org/eml-2.1.1 http://rs.gbif.org/schema/eml-gbif-profile/1.1/eml.xsd"',
        );
    });

    test('title, language, pubDate are present with mock values', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<title>SalishSea.io Cetacean Occurrences (v1.2)</title>');
        expect(xml).toContain('<language>en</language>');
        expect(xml).toContain('<pubDate>2026-06-17</pubDate>');
    });

    test('creator, metadataProvider, contact email blocks present', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<organizationName>SalishSea.io</organizationName>');
        expect(xml).toContain('<electronicMailAddress>rainhead@gmail.com</electronicMailAddress>');
        // Personal-name parts (POLICY §6.4 D-18) are hardcoded literals.
        expect(xml).toContain('<givenName>Peter</givenName>');
        expect(xml).toContain('<surName>Abrahamsen</surName>');
    });

    test('abstract uses the migration-authored text wrapped in <para>', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<abstract>');
        expect(xml).toContain('Native and Maplify/Whale Alert cetacean sighting records');
        expect(xml).toContain('</abstract>');
        // <para> must wrap the abstract body per GBIF EML profile.
        const abstractBlock = xml.slice(xml.indexOf('<abstract>'), xml.indexOf('</abstract>'));
        expect(abstractBlock).toContain('<para>');
    });

    test('keywordSet contains the four hardcoded keywords + thesaurus', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<keyword>cetaceans</keyword>');
        expect(xml).toContain('<keyword>Salish Sea</keyword>');
        expect(xml).toContain('<keyword>whale sightings</keyword>');
        expect(xml).toContain('<keyword>occurrence</keyword>');
        expect(xml).toContain('<keywordThesaurus>n/a</keywordThesaurus>');
    });

    test('intellectualRights references the license URI via <ulink>', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<intellectualRights>');
        expect(xml).toContain(
            '<ulink url="https://creativecommons.org/licenses/by-nc/4.0/legalcode">',
        );
        expect(xml).toContain('<citetitle>Creative Commons Attribution Non Commercial (CC-BY-NC) 4.0 License</citetitle>');
        expect(xml).toContain('Per-record license is encoded in the occurrence data file');
    });
});

describe('buildEml — coverage', () => {
    test('geographic bounding box matches the Acartia E-02 bbox (36..54°N, -136..-120°W)', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<westBoundingCoordinate>-136</westBoundingCoordinate>');
        expect(xml).toContain('<eastBoundingCoordinate>-120</eastBoundingCoordinate>');
        expect(xml).toContain('<northBoundingCoordinate>54</northBoundingCoordinate>');
        expect(xml).toContain('<southBoundingCoordinate>36</southBoundingCoordinate>');
    });

    test('geographicDescription mentions Salish Sea and Acartia cooperative', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<geographicDescription>');
        expect(xml).toContain('Salish Sea');
        expect(xml).toContain('Acartia data');
    });

    test('temporal coverage is interpolated from EmlInput.temporalCoverage (not from datasets)', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<calendarDate>2020-01-01</calendarDate>');
        expect(xml).toContain('<calendarDate>2026-06-17</calendarDate>');
        expect(xml).toContain('<rangeOfDates>');
    });

    test('taxonomic coverage mentions Cetacea at Order rank', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<generalTaxonomicCoverage>Cetacea (Order)</generalTaxonomicCoverage>');
        expect(xml).toContain('<taxonRankName>Order</taxonRankName>');
        expect(xml).toContain('<taxonRankValue>Cetacea</taxonRankValue>');
    });
});

describe('buildEml — methods', () => {
    test('<methods> block contains exactly 2 <para> tags (T-06-03-METHODS-DRIFT mitigation)', () => {
        const xml = buildEml(mockInput);
        const methodsBlock = xml.slice(xml.indexOf('<methods>'), xml.indexOf('</methods>'));
        const paraCount = (methodsBlock.match(/<para>/g) ?? []).length;
        expect(paraCount).toBe(2);
    });

    test('methods paragraph 1 mentions Google Sign-In (native ingestion path)', () => {
        const xml = buildEml(mockInput);
        const methodsBlock = xml.slice(xml.indexOf('<methods>'), xml.indexOf('</methods>'));
        expect(methodsBlock).toContain('Google Sign-In');
    });

    test('methods paragraph 2 mentions WASEAK / Acartia (Maplify ingestion path)', () => {
        const xml = buildEml(mockInput);
        const methodsBlock = xml.slice(xml.indexOf('<methods>'), xml.indexOf('</methods>'));
        expect(methodsBlock).toContain('WASEAK');
        expect(methodsBlock).toContain('Acartia');
    });
});

describe('buildEml — XML escaping (T-06-03-XML threat mitigation)', () => {
    test('& < > " in title round-trip to entity references', () => {
        const evil: DatasetsRow = {
            ...mockDatasets,
            title: 'SalishSea.io & cetaceans <whales> "quoted"',
        };
        const xml = buildEml({ datasets: evil, temporalCoverage: mockInput.temporalCoverage });

        // Title block carries entity-encoded characters.
        expect(xml).toContain(
            '<title>SalishSea.io &amp; cetaceans &lt;whales&gt; &quot;quoted&quot;</title>',
        );
        // And the raw unsafe substring does NOT appear inside <title>.
        const titleBlock = xml.slice(xml.indexOf('<title>'), xml.indexOf('</title>'));
        expect(titleBlock).not.toContain('& cetaceans');
        expect(titleBlock).not.toContain('<whales>');
    });

    test('NULL geographic_coverage / methods / temporal_coverage on the row do not break the output', () => {
        // Mock already has these three set to null; smoke-check that buildEml
        // emits the canonical authored text anyway and does not stringify "null".
        const xml = buildEml(mockInput);
        expect(xml).not.toContain('>null<');
        expect(xml).toContain('Salish Sea');
        expect(xml).toContain('Google Sign-In');
    });
});

describe('buildEml — determinism and parameter routing', () => {
    test('two calls with identical input return byte-identical output', () => {
        const a = buildEml(mockInput);
        const b = buildEml(mockInput);
        expect(a).toBe(b);
    });

    test('pubDate is sourced from datasets.pub_date — changing it changes the output', () => {
        const a = buildEml(mockInput);
        const otherPubDate: DatasetsRow = { ...mockDatasets, pub_date: '2027-01-15' };
        const b = buildEml({ datasets: otherPubDate, temporalCoverage: mockInput.temporalCoverage });
        expect(b).toContain('<pubDate>2027-01-15</pubDate>');
        expect(b).not.toBe(a);
    });

    test('temporalCoverage is sourced from EmlInput.temporalCoverage, not datasets.temporal_coverage', () => {
        // mockDatasets.temporal_coverage is null; the EmlInput passes
        // begin=2020-01-01 / end=2026-06-17. Output must reflect those.
        const xml = buildEml(mockInput);
        expect(xml).toContain('<calendarDate>2020-01-01</calendarDate>');
        expect(xml).toContain('<calendarDate>2026-06-17</calendarDate>');

        // Changing the temporalCoverage parameter must change the output.
        const altered = buildEml({
            datasets: mockDatasets,
            temporalCoverage: { begin: '2021-03-01', end: '2025-12-31' },
        });
        expect(altered).toContain('<calendarDate>2021-03-01</calendarDate>');
        expect(altered).toContain('<calendarDate>2025-12-31</calendarDate>');
        expect(altered).not.toContain('<calendarDate>2020-01-01</calendarDate>');
    });
});
