/**
 * The two text extractions as the build runs them (derive/extract.sql): twins of
 * Postgres's extract_travel_direction and extract_identifiers in RE2, with \b for
 * Postgres's \m and \M (salish-xv35.17).
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

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
    'K37 eaſt', 'ſ65',
    // A non-ASCII letter or digit touching a match: the one place RE2's \b (ASCII word
    // characters) and Postgres's \m/\M (Unicode ones) part ways.
    'éT65A', 'T65Aé', '北east', 'east北', 'T65A T65B', 'J27,K37',
];

/**
 * Where the twin knowingly differs from Postgres: RE2's word boundary does not count a
 * non-ASCII letter or digit as part of a word, so a code or direction word touching one
 * is found here and not there (or, for Arabic-Indic digits, there and not here). No
 * production text has ever had one (52,988 checked on 2026-10-04, 911 with a non-ASCII
 * character, 0 differences); this is the shape it would take.
 */
const KNOWN_DIVERGENCES = new Set(['J٢٧', 'éT65A', 'T65Aé', '北east', 'east北']);

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
    ['T65A T65B', null, ['T65A', 'T65B']],
    ['J27,K37', null, ['J27', 'K37']],
    ['ſouthbound', null, null],
    ['K37 eaſt', null, null],
];

type Extracted = {body: string, direction: string | null, identifiers: string[] | null};

let conn: DuckDBConnection;
beforeAll(async () => {
    conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(await readFile(new URL('./extract.sql', import.meta.url), 'utf8'));
});

/** Both extractions over `bodies`, in order, as the build's SQL answers them. */
async function extract(bodies: readonly string[]): Promise<Extracted[]> {
    const rows = (await conn.runAndReadAll(`
        SELECT body, extract_travel_direction(body) AS direction, extract_identifiers(body) AS identifiers
        FROM (SELECT unnest($bodies::VARCHAR[]) AS body, generate_subscripts($bodies::VARCHAR[], 1) AS n)
        ORDER BY n`, {bodies: JSON.stringify(bodies)})).getRowObjectsJS() as unknown as {body: string, direction: string | null, identifiers: {items: string[]} | string[] | null}[];
    return rows.map(r => ({
        body: r.body, direction: r.direction,
        identifiers: r.identifiers === null ? null : Array.isArray(r.identifiers) ? r.identifiers : r.identifiers.items,
    }));
}

describe('the extractions', () => {
    test.each(PINNED)('%j', async (body, direction, identifiers) => {
        const [got] = await extract([body]);
        expect(got!.direction).toBe(direction);
        expect(got!.identifiers).toEqual(identifiers);
    });

    test('NULL in, NULL out, as the functions are STRICT', async () => {
        const rows = (await conn.runAndReadAll(
            'SELECT extract_travel_direction(NULL) AS d, extract_identifiers(NULL) AS i')).getRowObjectsJS();
        expect(rows[0]).toEqual({d: null, i: null});
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

// The twins' whole claim: Postgres answers the same. Checked against the functions
// themselves, as the migrations define them, on every string in the corpus — except the
// strings pinned above as the one known divergence, which must be exactly those.
describe.skipIf(!DSN)('the extractions match Postgres (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    test('on every string in the corpus, but the known divergences', async () => {
        const theirs = await sql<Extracted[]>`
            SELECT body, public.extract_travel_direction(body)::text AS direction,
                   public.extract_identifiers(body)::text[] AS identifiers
            FROM unnest(${CORPUS}::text[]) WITH ORDINALITY AS c(body, n)
            ORDER BY n`;
        const ours = await extract(CORPUS);
        const differing = new Set<string>();
        for (const [i, t] of theirs.entries()) {
            const o = ours[i]!;
            if (o.direction !== t.direction || JSON.stringify(o.identifiers) !== JSON.stringify(t.identifiers))
                differing.add(t.body);
        }
        expect([...differing].sort()).toEqual([...KNOWN_DIVERGENCES].sort());
    });
});
