import { describe, test, expect } from 'vitest';
import { OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS } from './fields.ts';

/**
 * DWCA-02 unit surface (RESEARCH §T8). These tests are the first guardrail
 * for descriptor / data-file column-order parity: any drift in the canonical
 * ordered field arrays — accidental reorder, typo in a term URI, duplicate
 * name, or wrong dcterms / GBIF-extension namespace — fails CI here before
 * any downstream module (`meta-xml.ts`, `assertions.ts`, `build.ts`)
 * consumes the arrays.
 *
 * The Plan 03 runtime assertions (DESCRIBE against the live Postgres view)
 * are the second guardrail; defense in depth.
 */

const EXPECTED_OCCURRENCE_NAMES = [
    'occurrenceID',
    'basisOfRecord',
    'eventDate',
    'scientificName',
    'taxonRank',
    'kingdom',
    'phylum',
    'class',
    'order',
    'family',
    'genus',
    'decimalLatitude',
    'decimalLongitude',
    'geodeticDatum',
    'coordinateUncertaintyInMeters',
    'individualCount',
    'occurrenceStatus',
    'occurrenceRemarks',
    'recordedBy',
    'institutionCode',
    'rightsHolder',
    'datasetName',
    'datasetID',
    'license',
    'dynamicProperties',
    'informationWithheld',
] as const;

const EXPECTED_MULTIMEDIA_NAMES = [
    'coreId',
    'type',
    'identifier',
    'license',
    'rightsHolder',
    'creator',
] as const;

describe('fields module wiring (smoke)', () => {
    test('arrays import and are arrays', () => {
        expect(Array.isArray(OCCURRENCE_FIELDS)).toBe(true);
        expect(Array.isArray(MULTIMEDIA_FIELDS)).toBe(true);
    });
});

describe('OCCURRENCE_FIELDS', () => {
    test('contains exactly 26 entries matching RESEARCH §T4 occurrence table', () => {
        expect(OCCURRENCE_FIELDS.length).toBe(26);
    });

    test('every entry has a non-empty name and termUri', () => {
        for (const field of OCCURRENCE_FIELDS) {
            expect(field.name.length).toBeGreaterThan(0);
            expect(field.termUri.length).toBeGreaterThan(0);
        }
    });

    test('index 0 is occurrenceID with dwc/terms URI', () => {
        expect(OCCURRENCE_FIELDS[0]?.name).toBe('occurrenceID');
        expect(OCCURRENCE_FIELDS[0]?.termUri).toBe('http://rs.tdwg.org/dwc/terms/occurrenceID');
    });

    test('index 19 is institutionCode with dwc/terms URI', () => {
        expect(OCCURRENCE_FIELDS[19]?.name).toBe('institutionCode');
        expect(OCCURRENCE_FIELDS[19]?.termUri).toBe('http://rs.tdwg.org/dwc/terms/institutionCode');
    });

    test('positions 20 and 23 are the dcterms pair (rightsHolder, license)', () => {
        expect(OCCURRENCE_FIELDS[20]?.name).toBe('rightsHolder');
        expect(OCCURRENCE_FIELDS[20]?.termUri).toBe('http://purl.org/dc/terms/rightsHolder');
        expect(OCCURRENCE_FIELDS[23]?.name).toBe('license');
        expect(OCCURRENCE_FIELDS[23]?.termUri).toBe('http://purl.org/dc/terms/license');
    });

    test('every non-dcterms index (i.e. i ∉ {20, 23}) carries a dwc/terms URI', () => {
        OCCURRENCE_FIELDS.forEach((field, i) => {
            if (i === 20 || i === 23) return;
            expect(
                field.termUri.startsWith('http://rs.tdwg.org/dwc/terms/'),
                `index ${i} (${field.name}) should use dwc/terms but is "${field.termUri}"`,
            ).toBe(true);
        });
    });

    test('column names are unique (no duplicates)', () => {
        const names = OCCURRENCE_FIELDS.map((f) => f.name);
        expect(new Set(names).size).toBe(names.length);
    });

    test('column-name order matches the canonical 26-name list (DWCA-02 primary guardrail)', () => {
        expect(OCCURRENCE_FIELDS.map((f) => f.name)).toEqual([...EXPECTED_OCCURRENCE_NAMES]);
    });
});

describe('MULTIMEDIA_FIELDS', () => {
    test('contains exactly 6 entries matching RESEARCH §T4 multimedia table', () => {
        expect(MULTIMEDIA_FIELDS.length).toBe(6);
    });

    test('index 0 is coreId with the GBIF Simple Multimedia coreid URI', () => {
        expect(MULTIMEDIA_FIELDS[0]?.name).toBe('coreId');
        expect(MULTIMEDIA_FIELDS[0]?.termUri).toBe('http://rs.gbif.org/terms/1.0/coreid');
    });

    test('positions 1..5 use dcterms URIs', () => {
        for (let i = 1; i <= 5; i++) {
            expect(MULTIMEDIA_FIELDS[i]?.termUri.startsWith('http://purl.org/dc/terms/')).toBe(true);
        }
    });

    test('column names are unique (no duplicates)', () => {
        const names = MULTIMEDIA_FIELDS.map((f) => f.name);
        expect(new Set(names).size).toBe(names.length);
    });

    test('column-name order matches the canonical 6-name list', () => {
        expect(MULTIMEDIA_FIELDS.map((f) => f.name)).toEqual([...EXPECTED_MULTIMEDIA_NAMES]);
    });
});

describe('dcterms URI invariant', () => {
    test('all dcterms-prefixed names resolve to http://purl.org/dc/terms/<name>', () => {
        const allFields: readonly { readonly name: string; readonly termUri: string }[] = [
            ...OCCURRENCE_FIELDS,
            ...MULTIMEDIA_FIELDS,
        ];
        for (const field of allFields) {
            if (field.termUri.startsWith('http://purl.org/dc/terms/')) {
                const trailing = field.termUri.slice('http://purl.org/dc/terms/'.length);
                expect(trailing).toBe(field.name);
            }
        }
    });
});
