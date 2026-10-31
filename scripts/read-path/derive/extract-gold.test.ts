/**
 * The two text extractions scored against the gold set (decision 102): 200 Maplify
 * reports read by hand, in scripts/read-path/fixtures/gold/sighting-text.json. The
 * fixture is the truth; what is pinned here is how the regex macros in extract.sql do
 * against it today, by stratum, with the rows they get wrong. A change to the macros
 * shows here as rows moving between right and wrong, to be reviewed like a twin fixture's
 * rows (fixtures/twins/README.md): an improvement should take rows off these lists, and
 * a row that joins one needs a reason.
 *
 * The two random strata estimate the corpus. The hard strata were drawn for the pattern
 * named, so their rates say how the macros do on that pattern, not how often it occurs.
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, test } from 'vitest';

type Gold = {
    row: number;
    stratum: string;
    comment: string;
    codes_present: string[];
    direction: string | null;
};

/** The rows the macros get wrong today, by stratum, and the count of right ones. */
const PINNED: Record<string, {reports: number, wrongDirection: number[], wrongCodes: number[]}> = {
    'random orca': {reports: 100, wrongDirection: [3, 39, 44, 56, 88, 91, 95], wrongCodes: [11, 44, 64, 67, 74, 92]},
    'random other species': {reports: 40, wrongDirection: [108], wrongCodes: [105]},
    'hard: exclusion': {reports: 15, wrongDirection: [144, 153], wrongCodes: [141, 143, 144, 145, 146, 148, 151, 153]},
    'hard: code without letter': {reports: 15, wrongDirection: [162], wrongCodes: [156, 157, 158, 159, 161, 162, 163, 164, 165, 166, 167, 168, 170]},
    'hard: hedge': {reports: 10, wrongDirection: [], wrongCodes: []},
    'hard: change of direction': {reports: 10, wrongDirection: [181, 184, 186, 190], wrongCodes: []},
    'hard: nickname': {reports: 5, wrongDirection: [191], wrongCodes: []},
    'hard: abbreviated direction': {reports: 5, wrongDirection: [196, 197, 198, 199, 200], wrongCodes: []},
};

let gold: Gold[];
let conn: DuckDBConnection;
beforeAll(async () => {
    gold = JSON.parse(await readFile(new URL('../fixtures/gold/sighting-text.json', import.meta.url), 'utf8'));
    conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(await readFile(new URL('./extract.sql', import.meta.url), 'utf8'));
});

type Extracted = {row: number, direction: string | null, identifiers: string[]};

/** Both macros over every gold row's full comment, as the build runs them. */
async function extractAll(): Promise<Map<number, Extracted>> {
    await conn.run('CREATE OR REPLACE TEMP TABLE corpus (n INTEGER, body VARCHAR)');
    const appender = await conn.createAppender('corpus');
    for (const g of gold) { appender.appendInteger(g.row); appender.appendVarchar(g.comment); appender.endRow(); }
    appender.flushSync(); appender.closeSync();
    const rows = (await conn.runAndReadAll(`
        SELECT n, extract_travel_direction(body) AS direction, extract_identifiers(body) AS identifiers
        FROM corpus ORDER BY n`)).getRowObjectsJS() as unknown as {n: number, direction: string | null, identifiers: {items: string[]} | string[] | null}[];
    return new Map(rows.map(r => [r.n, {
        row: r.n, direction: r.direction,
        identifiers: r.identifiers === null ? [] : Array.isArray(r.identifiers) ? r.identifiers : r.identifiers.items,
    }]));
}

/** A direction the text doesn't give as a compass point: the macro should answer NULL. */
const NO_DIRECTION = new Set([null, 'milling', 'unknown']);

describe('the extractions against the gold set', () => {
    test('the fixture is whole', () => {
        expect(gold.map(g => g.row)).toEqual(gold.map((_, i) => i + 1));
        const counts: Record<string, number> = {};
        for (const g of gold) counts[g.stratum] = (counts[g.stratum] ?? 0) + 1;
        expect(counts).toEqual(Object.fromEntries(Object.entries(PINNED).map(([k, v]) => [k, v.reports])));
    });

    test('which rows the macros get wrong, by stratum', async () => {
        const got = await extractAll();
        const scored: typeof PINNED = {};
        for (const g of gold) {
            const x = got.get(g.row)!;
            const s = scored[g.stratum] ??= {reports: 0, wrongDirection: [], wrongCodes: []};
            s.reports++;
            const directionRight = NO_DIRECTION.has(g.direction) ? x.direction === null : x.direction === g.direction;
            if (!directionRight) s.wrongDirection.push(g.row);
            if (x.identifiers.join('; ') !== g.codes_present.join('; ')) s.wrongCodes.push(g.row);
        }
        expect(scored).toEqual(PINNED);
    });
});
