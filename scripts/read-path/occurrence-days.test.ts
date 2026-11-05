/**
 * The day files agree with the frontend about which day an occurrence is on.
 *
 * The map asks for "the sightings on 2025-03-09" and gets one file, so the
 * build and the browser must draw the midnight line in the same place. The
 * browser draws it with Temporal in America/Los_Angeles (`dateFromObservedAt`); the build
 * draws it in DuckDB. They are two implementations of one rule, and the place
 * they could part is at a daylight-saving change, where Pacific midnight moves
 * from 08:00 to 07:00 UTC. So the fixture sits on both sides of midnight on
 * both change days, and the expected day comes from Temporal, not from a
 * hand-written table that could share the build's mistake.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Temporal } from 'temporal-polyfill';

import { daySegments, occurrences2segments } from '../../src/segments.ts';
import type { Occurrence } from '../../src/types.ts';
import { loadWaterGrid, waterMaskArgs } from './water-mask.ts';
import { seaDistanceFor } from '../../src/sea-distance.ts';
import { dayFiles, withSegments, PARTIAL_LIMIT, rebuildKeys, writeDays } from './occurrence-days.ts';

/** The frontend's definition of a day (src/salish-sea.ts, dateFromObservedAt). */
function frontendDay(observedAt: string): string {
    return Temporal.Instant.from(observedAt)
        .toZonedDateTimeISO('America/Los_Angeles')
        .toPlainDate()
        .toString();
}

const ROWS = [
    // Spring forward, 2025-03-09: Pacific midnight is still 08:00 UTC (PST).
    {id: 'spring-before', observed_at: '2025-03-09T07:59:59Z'},
    {id: 'spring-after', observed_at: '2025-03-09T08:00:00Z'},
    // Fall back, 2025-11-02: Pacific midnight is still 07:00 UTC (PDT).
    {id: 'fall-before', observed_at: '2025-11-02T06:59:59Z'},
    {id: 'fall-after', observed_at: '2025-11-02T07:00:00Z'},
    // Two at the same instant: PostgREST orders them arbitrarily; the file must not.
    {id: 'tie-z', observed_at: '2025-03-09T20:00:00Z'},
    {id: 'tie-y', observed_at: '2025-03-09T20:00:00Z'},
];

/** What the join reads of an occurrence, near enough: one species, one spot. */
function doc(id: string, observed_at: string, over: Record<string, unknown> = {}) {
    return {
        id, observed_at, location: {lon: -123.1, lat: 48.5}, vitality: null, identifiers: null,
        taxon: {scientific_name: 'Orcinus orca', species_id: 1}, ...over,
    };
}

let exportDir: string;
let snapshot: string;

beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'read-path-days-'));
    snapshot = path.join(dir, 'snapshot.duckdb');
    // Named snapshot.duckdb on purpose: the file's catalog then shares the
    // schema's name, which is ambiguous unless the reader attaches it by alias.
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    await conn.run(`ATTACH '${snapshot}' AS store`);
    await conn.run('CREATE SCHEMA store.build');
    await conn.run(
        'CREATE TABLE store.build.occurrences (id VARCHAR, observed_at TIMESTAMPTZ, doc VARCHAR)',
    );
    for (const {id, observed_at} of ROWS) {
        await conn.run(
            `INSERT INTO store.build.occurrences VALUES ('${id}', '${observed_at}', '${JSON.stringify(doc(id, observed_at))}')`,
        );
    }
    await conn.run('DETACH store');
    conn.closeSync();

    // A file from an earlier build for a day that no longer has occurrences.
    exportDir = path.join(dir, 'export');
    await mkdir(path.join(exportDir, 'days'), {recursive: true});
    await writeFile(path.join(exportDir, 'days', '2020-01-01.json'), '[]');

    await writeDays(snapshot, exportDir, null);
});

async function day(name: string): Promise<{id: string}[]> {
    return JSON.parse(await readFile(path.join(exportDir, 'days', `${name}.json`), 'utf8'));
}

describe('writeDays', () => {
    test.each(ROWS)('$id lands in the file for the day the frontend puts it on', async ({id, observed_at}) => {
        const ids = (await day(frontendDay(observed_at))).map(o => o.id);
        expect(ids).toContain(id);
    });

    test('each day is newest first, ties broken by id', async () => {
        expect((await day('2025-03-09')).map(o => o.id))
            .toEqual(['tie-y', 'tie-z', 'spring-after']);
    });

    test('a day with no occurrences left loses its file', async () => {
        expect((await readdir(path.join(exportDir, 'days'))).sort())
            .toEqual(['2025-03-08.json', '2025-03-09.json', '2025-11-01.json', '2025-11-02.json']);
    });

    test('the swap leaves nothing beside days/', async () => {
        expect(await readdir(exportDir)).toEqual(['days']);
    });

    test('a run after one that died mid-swap restores the last complete build first', async () => {
        // The state a crash between the two renames leaves: no days/, the last
        // complete build in days.previous. This run then fails on its snapshot,
        // and must still leave that build in place.
        const crashed = path.join(path.dirname(exportDir), 'crashed');
        await mkdir(path.join(crashed, 'days.previous'), {recursive: true});
        await writeFile(path.join(crashed, 'days.previous', '2020-01-01.json'), '[]');
        await expect(writeDays(path.join(crashed, 'no-such.duckdb'), crashed, null)).rejects.toThrow();
        expect(await readdir(path.join(crashed, 'days'))).toEqual(['2020-01-01.json']);
    });
});

// The build names the days that moved (Stelis ADR 0016): only those are rewritten, in
// place; the rest of the directory is not touched; a named day with no rows left loses
// its file; and a key that is not a date is refused.
describe('writeDays, told which days', () => {
    test('writes the named days in place and leaves the others alone', async () => {
        const dir = path.join(path.dirname(exportDir), 'partial');
        await mkdir(path.join(dir, 'days'), {recursive: true});
        await writeFile(path.join(dir, 'days', '2025-03-08.json'), '["stale but not mine to touch"]');
        await writeFile(path.join(dir, 'days', '2025-11-02.json'), '["to be rewritten"]');
        await writeFile(path.join(dir, 'days', '2020-01-01.json'), '["named, but no rows: goes"]');
        await writeFile(path.join(dir, 'days', '2025-03-09.json.partial'), 'left by a killed run');
        const counts = await writeDays(snapshot, dir, ['2025-11-02', '2020-01-01']);
        expect(counts).toEqual({files: 1, occurrences: 1, mode: 'some'});
        expect((await readdir(path.join(dir, 'days'))).sort()).toEqual(['2025-03-08.json', '2025-11-02.json']);
        expect(await readFile(path.join(dir, 'days', '2025-03-08.json'), 'utf8')).toBe('["stale but not mine to touch"]');
        expect(JSON.parse(await readFile(path.join(dir, 'days', '2025-11-02.json'), 'utf8')).map((o: {id: string}) => o.id)).toEqual(['fall-after']);
    });

    test('a day with no file yet gets one; a killed full run\'s leftovers beside the directory are swept', async () => {
        const dir = path.join(path.dirname(exportDir), 'added');
        await mkdir(path.join(dir, 'days'), {recursive: true});
        await mkdir(path.join(dir, 'days.previous'), {recursive: true});
        await writeFile(path.join(dir, 'days.previous', '2020-01-01.json'), '[]');
        const counts = await writeDays(snapshot, dir, ['2025-03-09']);
        expect(counts).toEqual({files: 1, occurrences: 3, mode: 'some'});
        expect(JSON.parse(await readFile(path.join(dir, 'days', '2025-03-09.json'), 'utf8')).map((o: {id: string}) => o.id))
            .toEqual(['tie-y', 'tie-z', 'spring-after']);
        expect((await readdir(dir)).sort()).toEqual(['days']);
    });

    test('told days but given no directory to rewrite into, a run is a full one', async () => {
        const dir = path.join(path.dirname(exportDir), 'fresh');
        await mkdir(dir, {recursive: true});
        expect((await writeDays(snapshot, dir, ['2025-03-09'])).mode).toBe('all');
        expect((await readdir(path.join(dir, 'days'))).length).toBe(4);
    });

    test('an empty list writes nothing and touches nothing', async () => {
        const dir = path.join(path.dirname(exportDir), 'nothing');
        await mkdir(path.join(dir, 'days'), {recursive: true});
        await writeFile(path.join(dir, 'days', 'x.json'), '[]');
        expect(await writeDays(snapshot, dir, [])).toEqual({files: 0, occurrences: 0, mode: 'some'});
        expect(await readdir(path.join(dir, 'days'))).toEqual(['x.json']);
    });

    test('told more days than the partial limit, the directory is replaced whole', async () => {
        const dir = path.join(path.dirname(exportDir), 'many');
        await mkdir(path.join(dir, 'days'), {recursive: true});
        await writeFile(path.join(dir, 'days', '2020-01-01.json'), '["would survive a partial run"]');
        const many = Array.from({length: PARTIAL_LIMIT + 1}, (_, i) => `2000-01-${String(1 + (i % 28)).padStart(2, '0')}`);
        expect((await writeDays(snapshot, dir, many)).mode).toBe('all');
        expect((await readdir(path.join(dir, 'days'))).sort())
            .toEqual(['2025-03-08.json', '2025-03-09.json', '2025-11-01.json', '2025-11-02.json']);
    });

    test('the variable is newline-separated days; absent is every day; a non-date, an empty key included, is refused', () => {
        expect(rebuildKeys({})).toBeNull();
        expect(rebuildKeys({STELIS_REBUILD_KEYS: ''})).toEqual([]);
        expect(rebuildKeys({STELIS_REBUILD_KEYS: '2025-11-02\n2025-03-09\n'})).toEqual(['2025-11-02', '2025-03-09']);
        expect(() => rebuildKeys({STELIS_REBUILD_KEYS: "2025-11-02') OR ('1'='1"})).toThrow(/not a date/);
        expect(() => rebuildKeys({STELIS_REBUILD_KEYS: '2025-11-02\n\n2025-03-09'})).toThrow(/not a date/);
    });
});

describe('dayFiles', () => {
    // Rows arrive in chunks that don't line up with days; each day's file must
    // still hold all of that day, and come out once its last row has arrived.
    const J = (id: string, at: string) => JSON.stringify(doc(id, at));
    async function* chunks(...cs: [string, string][][]) { yield* cs; }

    test('one file per day across chunk boundaries, counted', async () => {
        const counts = {files: 0, occurrences: 0};
        const files = [];
        for await (const file of dayFiles(chunks(
            [['2026-09-28', J('a', '2026-09-28T20:00:00Z')], ['2026-09-29', J('b', '2026-09-29T21:00:00Z')]],
            [['2026-09-29', J('c', '2026-09-29T20:00:00Z')]],
            [],
            [['2026-09-30', J('d', '2026-09-30T20:00:00Z')]],
        ), counts)) files.push(file);
        expect(files.map(([name, body]) => [name, JSON.parse(body).map((o: {id: string}) => o.id)])).toEqual([
            ['2026-09-28.json', ['a']],
            ['2026-09-29.json', ['b', 'c']],
            ['2026-09-30.json', ['d']],
        ]);
        expect(counts).toEqual({files: 3, occurrences: 4});
    });

    test('a row with no day is on no file and is not counted', async () => {
        const counts = {files: 0, occurrences: 0};
        const out: [string, string][] = [];
        for await (const file of dayFiles((async function* () { yield [['2025-01-01', J('a', '2025-01-01T20:00:00Z')], [null, J('no-day', '2025-01-01T21:00:00Z')]] as [string | null, string][]; })(), counts))
            out.push(file);
        expect(out.map(([name, body]) => [name, JSON.parse(body).map((o: {id: string}) => o.id)])).toEqual([['2025-01-01.json', ['a']]]);
        expect(counts).toEqual({files: 1, occurrences: 1});
    });

    test('no rows, no files', async () => {
        const files = [];
        for await (const file of dayFiles(chunks())) files.push(file);
        expect(files).toEqual([]);
    });
});

// The build decides a day's segments and writes them on the rows (decision 111); the
// browser's grouping of that file must give exactly what the join gives on the rows.
describe('the segment each row carries', () => {
    const asOccurrences = (list: Record<string, unknown>[]) =>
        list.map(o => ({...o, observed_at_ms: Date.parse(o['observed_at'] as string)}) as unknown as Occurrence);
    const shape = (segments: {occurrences: {id: string}[]}[]) => segments.map(s => s.occurrences.map(o => o.id));

    test('a day written to disk has a segment on every row: the oldest report of its track', async () => {
        const rows = await readFile(path.join(exportDir, 'days', '2025-03-09.json'), 'utf8').then(JSON.parse) as {id: string, segment: string}[];
        // all three are the same species at one place within hours: one track, whose oldest is the 08:00 report
        expect(rows.map(r => [r.id, r.segment])).toEqual([['tie-y', 'spring-after'], ['tie-z', 'spring-after'], ['spring-after', 'spring-after']]);
    });

    test('the segment is the last key, and observed_at_ms is not written', () => {
        const [row] = withSegments([doc('a', '2026-09-28T20:00:00Z')]);
        expect(Object.keys(row!).at(-1)).toBe('segment');
        expect(row).not.toHaveProperty('observed_at_ms');
    });

    // A fixed-seed generator, so a failure reproduces.
    function rng(seed: number) {
        return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    }

    test('grouping a built day by its field gives the join exactly, for 300 generated days', () => {
        const rand = rng(20261104);
        const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
        const taxa = [
            {scientific_name: 'Orcinus orca', species_id: 1}, {scientific_name: 'Orcinus orca ater', species_id: 1},
            {scientific_name: 'Megaptera novaeangliae', species_id: 2}, {scientific_name: null, species_id: null},
        ];
        for (let n = 0; n < 300; n++) {
            const size = 1 + Math.floor(rand() * 40);
            const list = Array.from({length: size}, (_, i) => doc(
                `r${String(i).padStart(2, '0')}`,
                // quarter-hours, some in the same instant, so the tie rule is exercised
                new Date(Date.UTC(2026, 9, 5, 12) + Math.floor(rand() * 40) * 15 * 60_000 * (rand() < 0.2 ? 0 : 1)).toISOString(),
                {
                    location: {lon: -123.2 + rand() * 0.5, lat: 48.3 + rand() * 0.5},
                    taxon: pick(taxa), vitality: rand() < 0.05 ? 'dead' : null,
                    identifiers: rand() < 0.3 ? [pick(['J35', 'K12', 'T65A', 'L pod', "Bigg's"])] : null,
                },
            )).sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at) || (a.id < b.id ? -1 : 1));
            const joined = occurrences2segments(asOccurrences(list));
            const grouped = daySegments(asOccurrences(withSegments(list)));
            expect(shape(grouped)).toEqual(shape(joined));
            expect(grouped.map(s => [s.expectedTravelSpeedKmph, s.lastOccurrenceAt.valueOf(), s.taxon]))
                .toEqual(joined.map(s => [s.expectedTravelSpeedKmph, s.lastOccurrenceAt.valueOf(), s.taxon]));
        }
    });
});

describe('the day writer with the water mask (salish-20u7.3)', () => {
    const fixture = (name: string) => new URL(`./fixtures/water-mask/${name}`, import.meta.url).pathname;
    const mask = fixture('water-mask');
    // The Saltspring pair of 2025-07-14: 13 km apart in a straight line, 29 km round the island by sea.
    const trincomali = doc('trincomali', '2025-07-14T19:09:00Z', {location: {lon: -123.46, lat: 48.88}});
    const mapleBay = doc('maple-bay', '2025-07-14T20:32:00Z', {location: {lon: -123.60, lat: 48.80}});
    const written = async (distanceM?: ReturnType<typeof seaDistanceFor>) => {
        // the file lists a day newest first
        const rows: [string, string][] = [[ '2025-07-14', JSON.stringify(mapleBay)], ['2025-07-14', JSON.stringify(trincomali)]];
        let body = '';
        for await (const [, text] of dayFiles((async function* () { yield rows; })(), undefined, distanceM)) body = text;
        return JSON.parse(body) as {id: string, segment: string}[];
    };

    test('without a mask the pair share a segment; with it, each has its own', async () => {
        expect((await written()).map(r => [r.id, r.segment])).toEqual([['maple-bay', 'trincomali'], ['trincomali', 'trincomali']]);
        const bySea = await written(seaDistanceFor(loadWaterGrid(`${mask}.png`, `${mask}.json`)));
        expect(bySea.map(r => [r.id, r.segment])).toEqual([['maple-bay', 'maple-bay'], ['trincomali', 'trincomali']]);
    });

    test('--water-mask <png> <json> is taken out of the arguments and loads the grid', () => {
        const none = waterMaskArgs(['snapshot.duckdb']);
        expect(none).toEqual({rest: ['snapshot.duckdb'], distanceM: undefined});
        const given = waterMaskArgs(['snapshot.duckdb', '--water-mask', `${mask}.png`, `${mask}.json`]);
        expect(given.rest).toEqual(['snapshot.duckdb']);
        expect(given.distanceM!([-123.46, 48.88], [-123.60, 48.80])).toBeNull();
        expect(() => waterMaskArgs(['snapshot.duckdb', '--water-mask', `${mask}.png`])).toThrow(/two paths/);
    });
});
