/**
 * The two text extractions as the build runs them (derive/extract.sql): twins of
 * Postgres's extract_travel_direction and extract_identifiers in RE2, with \b for
 * Postgres's \m and \M (salish-xv35.17).
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, test } from 'vitest';

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
    ['T65A\nnorthbound', 'north', ['T65A']],
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

/**
 * Both extractions over `bodies`, in order, as the build's SQL answers them. The texts
 * go in through the appender, byte for byte: a cast from a string literal to VARCHAR[]
 * would not unescape a JSON "\n", and CI caught exactly that.
 */
async function extract(bodies: readonly string[]): Promise<Extracted[]> {
    await conn.run('CREATE OR REPLACE TEMP TABLE corpus (n INTEGER, body VARCHAR)');
    const appender = await conn.createAppender('corpus');
    bodies.forEach((body, n) => { appender.appendInteger(n); appender.appendVarchar(body); appender.endRow(); });
    appender.flushSync(); appender.closeSync();
    const rows = (await conn.runAndReadAll(`
        SELECT body, extract_travel_direction(body) AS direction, extract_identifiers(body) AS identifiers
        FROM corpus ORDER BY n`)).getRowObjectsJS() as unknown as {body: string, direction: string | null, identifiers: {items: string[]} | string[] | null}[];
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

/**
 * What Postgres's extract_travel_direction and extract_identifiers answered for each string
 * in the corpus, in order, captured from the functions as the migrations defined them
 * before Postgres retired (salish-9uu.11).
 */
const POSTGRES: [string, string | null, string[] | null][] = [
    ["J pod southbound, surface active", "south", null],
    ["Southbound", "south", null],
    ["NORTHBOUND", "north", null],
    ["north-east bound", "northeast", null],
    ["North, Eastbound", "northeast", null],
    ["south west", "southwest", null],
    ["southwesterly", null, null],
    ["eastern side", null, null],
    ["westward", null, null],
    ["headed east.", "east", null],
    ["going north-ish", "north", null],
    ["northbound then southbound", "north", null],
    ["north_east", null, null],
    ["Nordeste", null, null],
    ["éast", null, null],
    ["east,west", "east", null],
    ["T65A and T065A2 with T-65B, t 65c, T65As", null, ["T65A", "T65A2", "T65B", "T65c", "T65As"]],
    ["J27 J39 K37s L87", null, ["J27", "J39", "K37s", "L87"]],
    ["CRC-18676", null, ["CRC18676"]],
    ["crc2356", null, ["CRC2356"]],
    ["T00", null, ["T00"]],
    ["T0", null, null],
    ["T001", null, ["T01"]],
    ["J27s2", null, null],
    ["XJ27", null, null],
    ["J27_", null, null],
    ["J٢٧", null, ["J٢٧"]],
    ["T65Ab", null, ["T65Ab"]],
    ["T65ABs", null, ["T65ABs"]],
    ["L-pod", null, null],
    ["J--27", null, null],
    ["T137A, T137B.", null, ["T137A", "T137B"]],
    ["(T65A)", null, ["T65A"]],
    ["T65A/T65B", null, ["T65A", "T65B"]],
    ["T65a", null, ["T65a"]],
    ["T 65 A", null, ["T65"]],
    ["Jpod", null, null],
    ["J 1", null, null],
    ["J1", null, null],
    ["J11", null, ["J11"]],
    ["", null, null],
    ["no identifiers here", null, null],
    ["T65A\nnorthbound", "north", ["T65A"]],
    ["ſouthbound", null, null],
    ["K Pod moving north-west!", "northwest", null],
    ["K37 eaſt", null, null],
    ["ſ65", null, null],
    ["éT65A", null, null],
    ["T65Aé", null, null],
    ["北east", null, null],
    ["east北", null, null],
    ["T65A T65B", null, ["T65A", "T65B"]],
    ["J27,K37", null, ["J27", "K37"]],
];

// The twins' whole claim: Postgres answered the same, on every string in the corpus —
// except the strings pinned above as the one known divergence, which must be exactly those.
describe('the extractions match what Postgres answered', () => {
    test('the corpus is the one Postgres answered', () => {
        expect(POSTGRES.map(([body]) => body)).toEqual(CORPUS);
    });

    test('on every string in the corpus, but the known divergences', async () => {
        const ours = await extract(CORPUS);
        const differing = new Set<string>();
        for (const [i, [body, direction, identifiers]] of POSTGRES.entries()) {
            const o = ours[i]!;
            if (o.direction !== direction || JSON.stringify(o.identifiers) !== JSON.stringify(identifiers))
                differing.add(body);
        }
        expect([...differing].sort()).toEqual([...KNOWN_DIVERGENCES].sort());
    });
});
