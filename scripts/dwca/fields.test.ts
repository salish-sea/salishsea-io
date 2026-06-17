import { describe, test, expect } from 'vitest';
import {
    OCCURRENCE_FIELDS as RAW_OCCURRENCE_FIELDS,
    MULTIMEDIA_FIELDS as RAW_MULTIMEDIA_FIELDS,
    type OccurrenceField,
    type MultimediaField,
} from './fields.ts';

/**
 * Wave-0 scaffold for the DWCA-02 unit surface (RESEARCH §T8).
 *
 * This file's job in Wave 0 is solely to prove that:
 *   - the test file is discovered by Vitest (no `include` overrides needed)
 *   - the `./fields.ts` import resolves under `allowImportingTsExtensions`
 *   - the placeholder arrays are typed and accessible at runtime
 *
 * The substantive DWCA-02 assertions remain `test.skip(...)` with TODO links
 * back to Plan 02 (Wave 1). Plan 02 unskips them once `OCCURRENCE_FIELDS` and
 * `MULTIMEDIA_FIELDS` are populated with the canonical entries.
 *
 * Widen the imported tuples to `readonly Field[]` so the skipped Plan 02
 * assertions type-check today against the empty placeholders. Once Plan 02
 * lands the canonical entries the widened view still matches, and unskipping
 * the tests requires no additional type churn.
 */
const OCCURRENCE_FIELDS: readonly OccurrenceField[] = RAW_OCCURRENCE_FIELDS;
const MULTIMEDIA_FIELDS: readonly MultimediaField[] = RAW_MULTIMEDIA_FIELDS;

describe('fields module wiring (Wave 0 smoke)', () => {
    test('placeholder arrays compile and import', () => {
        expect(Array.isArray(OCCURRENCE_FIELDS)).toBe(true);
        expect(Array.isArray(MULTIMEDIA_FIELDS)).toBe(true);
    });
});

describe('OCCURRENCE_FIELDS', () => {
    // TODO(Plan 02): unskip once OCCURRENCE_FIELDS contains the 25 entries.
    test.skip('contains exactly 25 entries matching RESEARCH §T4 occurrence table', () => {
        expect(OCCURRENCE_FIELDS.length).toBe(25);
    });

    // TODO(Plan 02): unskip once OCCURRENCE_FIELDS is populated.
    test.skip('every entry has a non-empty name and termUri', () => {
        for (const field of OCCURRENCE_FIELDS) {
            expect(field.name.length).toBeGreaterThan(0);
            expect(field.termUri.length).toBeGreaterThan(0);
        }
    });

    // TODO(Plan 02): unskip once the dcterms pair is in place at indices 19, 22.
    test.skip('positions 19 and 22 are the dcterms pair (rightsHolder, license)', () => {
        expect(OCCURRENCE_FIELDS[19]?.name).toBe('rightsHolder');
        expect(OCCURRENCE_FIELDS[19]?.termUri).toBe('http://purl.org/dc/terms/rightsHolder');
        expect(OCCURRENCE_FIELDS[22]?.name).toBe('license');
        expect(OCCURRENCE_FIELDS[22]?.termUri).toBe('http://purl.org/dc/terms/license');
    });

    // TODO(Plan 02): unskip once OCCURRENCE_FIELDS is populated.
    test.skip('column names are unique (no duplicates)', () => {
        const names = OCCURRENCE_FIELDS.map((f) => f.name);
        expect(new Set(names).size).toBe(names.length);
    });
});

describe('MULTIMEDIA_FIELDS', () => {
    // TODO(Plan 02): unskip once MULTIMEDIA_FIELDS contains the 6 entries.
    test.skip('contains exactly 6 entries matching RESEARCH §T4 multimedia table', () => {
        expect(MULTIMEDIA_FIELDS.length).toBe(6);
    });

    // TODO(Plan 02): unskip once MULTIMEDIA_FIELDS is populated.
    test.skip('positions 1..5 use dcterms URIs', () => {
        for (let i = 1; i <= 5; i++) {
            expect(MULTIMEDIA_FIELDS[i]?.termUri.startsWith('http://purl.org/dc/terms/')).toBe(true);
        }
    });
});

describe('dcterms URI invariant', () => {
    // TODO(Plan 02): unskip once both arrays carry their canonical entries.
    test.skip('all dcterms-prefixed names resolve to http://purl.org/dc/terms/<name>', () => {
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
