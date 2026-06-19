/**
 * Vitest suite for resolveProvider — Phase 11 Plan 01.
 *
 * Implements RESOLVE-01 test coverage: pure URL-pattern resolver from
 * source_url to { provider, collection } slugs or null.
 *
 * Cross-reference:
 *   - 11-01-PLAN.md Task 1 for the full behavior spec.
 *   - 11-CONTEXT.md D-06 for the locked decision: pure function, no I/O,
 *     NOT on the Maplify path, NOT the ongoing mechanism for single-collection
 *     tables (that is the column DEFAULT per D-05).
 *
 * Slug literals must match the Phase 9 seed in
 * supabase/migrations/20260619184037_reference_tables.sql exactly — they are
 * the join contract with public.providers and public.collections.
 */

import { describe, test, expect } from 'vitest';
import { resolveProvider } from './resolve-provider.ts';

describe('resolveProvider — iNaturalist URLs', () => {
    test('returns inaturalist/inaturalist for www.inaturalist.org observation URL', () => {
        expect(resolveProvider('https://www.inaturalist.org/observations/12345'))
            .toEqual({ provider: 'inaturalist', collection: 'inaturalist' });
    });

    test('returns inaturalist/inaturalist for inaturalist.org (no www) observation URL', () => {
        expect(resolveProvider('https://inaturalist.org/observations/9'))
            .toEqual({ provider: 'inaturalist', collection: 'inaturalist' });
    });

    test('returns inaturalist/inaturalist for inaturalist.org non-observation path', () => {
        expect(resolveProvider('https://www.inaturalist.org/taxa/12345'))
            .toEqual({ provider: 'inaturalist', collection: 'inaturalist' });
    });
});

describe('resolveProvider — native salishsea.io URLs', () => {
    test('returns direct/salishsea-direct for salishsea.io observation URL', () => {
        expect(resolveProvider('https://salishsea.io/?o=abc-123'))
            .toEqual({ provider: 'direct', collection: 'salishsea-direct' });
    });

    test('returns direct/salishsea-direct for any salishsea.io URL', () => {
        expect(resolveProvider('https://salishsea.io/'))
            .toEqual({ provider: 'direct', collection: 'salishsea-direct' });
    });
});

describe('resolveProvider — null cases', () => {
    test('returns null for unrecognized URL', () => {
        expect(resolveProvider('https://example.com/foo')).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(resolveProvider('')).toBeNull();
    });

    test('returns null for non-URL string', () => {
        expect(resolveProvider('not a url')).toBeNull();
    });

    test('returns null for URL with unrecognized host', () => {
        expect(resolveProvider('https://facebook.com/groups/orca-network')).toBeNull();
    });
});
