/**
 * Unit tests for `assertIndexeable` in validate-gbif.ts.
 *
 * These tests exercise the pure gate logic against inline fixture JSON.
 * No network calls are made. submit/poll functions are NOT imported here
 * (they require GBIF credentials and a live API).
 *
 * Covers:
 *   (a) indexeable:true with only METADATA_CONTENT warnings → passes + returns warnings
 *   (b) indexeable:false → throws
 *   (c) indexeable:true with a RESOURCE_STRUCTURE issue present → throws
 *
 * See 13-02-PLAN.md §<behavior> and 13-RESEARCH.md §"Pattern 1: GBIF Validator REST API".
 */

import { describe, test, expect } from 'vitest';
import { assertIndexeable } from './validate-gbif.ts';
import type { GbifValidationResult } from './validate-gbif.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Fixture A: indexeable:true, only METADATA_CONTENT warnings.
 * Expected: passes, returns the METADATA_CONTENT issue as a warning.
 */
const FIXTURE_INDEXEABLE_WITH_WARNINGS: GbifValidationResult = {
    indexeable: true,
    fileName: 'salishsea-occurrences-v1.zip',
    fileFormat: 'dwca',
    validationProfile: 'GBIF_INDEXING_PROFILE',
    results: [
        {
            fileType: 'CORE',
            rowType: 'http://rs.tdwg.org/dwc/terms/Occurrence',
            numberOfLines: 4413,
            issues: [
                {
                    issue: 'COORDINATE_UNCERTAINTY_METERS_INVALID',
                    issueCategory: 'OCC_INTERPRETATION_BASED',
                    count: 4442,
                },
            ],
        },
        {
            fileType: 'METADATA',
            issues: [
                {
                    issue: 'RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE',
                    issueCategory: 'METADATA_CONTENT',
                },
            ],
        },
    ],
};

/**
 * Fixture B: indexeable:false (blocking structural problem).
 * Expected: assertIndexeable throws "GBIF validator: not indexeable".
 */
const FIXTURE_NOT_INDEXEABLE: GbifValidationResult = {
    indexeable: false,
    fileName: 'salishsea-occurrences-v1.zip',
    fileFormat: 'dwca',
    validationProfile: 'GBIF_INDEXING_PROFILE',
    results: [
        {
            fileType: 'CORE',
            issues: [
                {
                    issue: 'REQUIRED_TERM_MISSING',
                    issueCategory: 'RESOURCE_STRUCTURE',
                    count: 1,
                },
            ],
        },
    ],
};

/**
 * Fixture C: indexeable:true but a RESOURCE_STRUCTURE issue is present.
 * Expected: assertIndexeable throws listing the blocking issue.
 */
const FIXTURE_BLOCKING_ISSUE: GbifValidationResult = {
    indexeable: true,
    fileName: 'salishsea-occurrences-v1.zip',
    fileFormat: 'dwca',
    validationProfile: 'GBIF_INDEXING_PROFILE',
    results: [
        {
            fileType: 'METADATA',
            issues: [
                {
                    issue: 'RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE',
                    issueCategory: 'METADATA_CONTENT',
                },
            ],
        },
        {
            fileType: 'CORE',
            issues: [
                {
                    issue: 'REQUIRED_TERM_MISSING',
                    issueCategory: 'RESOURCE_STRUCTURE',
                    count: 1,
                },
            ],
        },
    ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assertIndexeable', () => {
    test('(a) indexeable:true with only METADATA_CONTENT/OCC_INTERPRETATION_BASED warnings: passes and returns warnings', () => {
        const result = assertIndexeable(FIXTURE_INDEXEABLE_WITH_WARNINGS);
        // Should not throw
        expect(result).toBeDefined();
        expect(result.warnings).toHaveLength(2);
        // All returned warnings are non-blocking categories
        const blockingCategories = new Set(['RESOURCE_INTEGRITY', 'RESOURCE_STRUCTURE']);
        for (const w of result.warnings) {
            expect(blockingCategories.has(w.issueCategory)).toBe(false);
        }
        // The METADATA_CONTENT issue should be in warnings
        const metadataWarning = result.warnings.find(
            w => w.issue === 'RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE',
        );
        expect(metadataWarning).toBeDefined();
        expect(metadataWarning?.issueCategory).toBe('METADATA_CONTENT');
        // The OCC_INTERPRETATION_BASED issue should also be in warnings
        const occWarning = result.warnings.find(
            w => w.issue === 'COORDINATE_UNCERTAINTY_METERS_INVALID',
        );
        expect(occWarning).toBeDefined();
        expect(occWarning?.issueCategory).toBe('OCC_INTERPRETATION_BASED');
    });

    test('(b) indexeable:false: throws with message "GBIF validator: not indexeable"', () => {
        expect(() => assertIndexeable(FIXTURE_NOT_INDEXEABLE)).toThrow(
            'GBIF validator: not indexeable',
        );
    });

    test('(c) indexeable:true with a RESOURCE_STRUCTURE issue: throws listing blocking issue', () => {
        expect(() => assertIndexeable(FIXTURE_BLOCKING_ISSUE)).toThrow(
            /RESOURCE_STRUCTURE/,
        );
    });
});
