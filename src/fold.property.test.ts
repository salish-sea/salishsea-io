import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { withMacros } from '../scripts/read-path/derive/sql-macros.ts';
import { fold } from './fold.ts';

/**
 * Discovery suite (salish-us33): src/fold.ts against its SQL twin, register_fold in
 * derive/identifier-candidates.sql, which the build joins against the catalogue's
 * TypeScript-folded codes. Any string the two fold differently is an identifier that
 * links in one place and not the other.
 *
 * The alphabet is chosen so the interesting interactions happen often: zeros next to
 * digits and to stripped characters, every kind of whitespace JavaScript's \s and the
 * SQL's [\s\p{Z}] might disagree on, and letters whose lowercase differs between
 * Unicode's full and simple mappings.
 */
const PIECES = [
    'T', 't', 'J', 's', 'A', 'b', '0', '00', '1', '5', '9', '10',
    "'", '’', '-', '‐', '–',
    ' ', '  ', '\t', '\n', '\r', '\v', '\f', ' ', ' ', '　', ' ', ' ', '﻿', '\u0085', '᠎',
    'İ', 'Σ', 'ΑΣ', 'ẞ', 'K', 'Ǆ', 'é', 'é',
    '０', '٣',
];
const designationish = fc.array(fc.constantFrom(...PIECES), {maxLength: 8}).map(parts => parts.join(''));

describe('fold (discovery)', () => {
    test('is idempotent', () => {
        fc.assert(fc.property(fc.oneof(designationish, fc.string({unit: 'grapheme'})), s => {
            expect(fold(fold(s))).toBe(fold(s));
        }), {numRuns: 5000});
    });

    // Fails, and is expected to until the register says which Unicode tables its fold
    // means: the SQL keeps \v and U+FEFF that JavaScript's \s collapses, and lowercases
    // İ and a final Σ by the simple mapping where toLowerCase uses the full one. The
    // register's own fold (bin/validate.py in salish-sea/animals) is Python's, which differs
    // from both (Unicode digits, U+0085 and U+001C–U+001F as space). The build's join only
    // ever sees ASCII codes (extract_identifiers), so no link changes today.
    test.fails('agrees with its SQL twin', async () => {
        const query = await withMacros('identifier-candidates.sql');
        const disagreements = new Map<string, [string, unknown]>();
        await fc.assert(fc.asyncProperty(designationish, async s => {
            const sql = await query('SELECT register_fold($s)', {s});
            if (sql !== fold(s)) disagreements.set(JSON.stringify(s), [fold(s), sql]);
        }), {numRuns: 3000});
        // Report every disagreement at once, keyed by the input, rather than the first shrunk one.
        expect(Object.fromEntries(disagreements)).toEqual({});
    });
});
