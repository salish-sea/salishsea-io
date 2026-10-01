import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

import { extractIdentifiers, extractTravelDirection } from './extract.ts';

/**
 * Text that has tripped, or could trip, a twin of a Postgres regex: word boundaries
 * next to punctuation and non-ASCII letters, a designation's optional hyphen or space,
 * leading zeros, hex digits, a matriline's `s`, case, and "bound".
 */
const CORPUS = [
    'J pod southbound, surface active',
    'Southbound', 'NORTHBOUND', 'north-east bound', 'North, Eastbound', 'south west',
    'southwesterly', 'eastern side', 'westward', 'headed east.', 'going north-ish',
    'northbound then southbound', 'north_east', 'Nordeste', 'éast', 'east,west',
    'T65A and T065A2 with T-65B, t 65c, T65As', 'J27 J39 K37s L87', 'CRC-18676', 'crc2356',
    'T00', 'T0', 'T001', 'J27s2', 'XJ27', 'J27_', 'J٢٧', 'T65Ab', 'T65ABs', 'L-pod', 'J--27',
    'T137A, T137B.', '(T65A)', 'T65A/T65B', 'T65a', 'T 65 A', 'Jpod', 'J 1', 'J1', 'J11',
    '', 'no identifiers here', 'T65A\nnorthbound', 'ſouthbound', 'K Pod moving north-west!',
    // Letters JavaScript's Unicode case folding equates with the pattern's and Postgres's doesn't.
    '\u212A37 eaſt', 'ſ65',
];

const PINNED: [string, string | null, string[] | null][] = [
    ['J pod southbound, surface active', 'south', null],
    ['north-east bound', 'northeast', null],
    ['North, Eastbound', 'northeast', null],
    ['southwesterly', null, null],
    ['eastern side', null, null],
    ['T65A and T065A2 with T-65B, t 65c, T65As', null, ['T65A', 'T65A2', 'T65B', 'T65c', 'T65As']],
    ['J27 J39 K37s L87', null, ['J27', 'J39', 'K37s', 'L87']],
    ['CRC-18676', null, ['CRC18676']],
    ['T0', null, null],
    ['J27s2', null, null],
    ['XJ27', null, null],
    ['', null, null],
];

describe('the extractions', () => {
    test.each(PINNED)('%j', (body, direction, identifiers) => {
        expect(extractTravelDirection(body)).toBe(direction);
        expect(extractIdentifiers(body)).toEqual(identifiers);
    });

    test('NULL in, NULL out, as the functions are STRICT', () => {
        expect(extractTravelDirection(null)).toBeNull();
        expect(extractIdentifiers(null)).toBeNull();
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

// The twins' whole claim: Postgres answers the same. Checked against the functions
// themselves, as the migrations define them, on every string in the corpus.
describe.skipIf(!DSN)('the extractions match Postgres (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    test('on every string in the corpus', async () => {
        const rows = await sql<{body: string, direction: string | null, identifiers: string[] | null}[]>`
            SELECT body, public.extract_travel_direction(body)::text AS direction,
                   public.extract_identifiers(body)::text[] AS identifiers
            FROM unnest(${CORPUS}::text[]) WITH ORDINALITY AS c(body, n)
            ORDER BY n`;
        for (const {body, direction, identifiers} of rows) {
            expect(extractTravelDirection(body), body).toBe(direction);
            expect(extractIdentifiers(body), body).toEqual(identifiers);
        }
    });
});
