/**
 * The day files agree with the frontend about which day an occurrence is on.
 *
 * The map asks for "the sightings on 2025-03-09" and gets one file, so the
 * build and the browser must draw the midnight line in the same place. The
 * browser draws it with Temporal in PST8PDT (`dateFromObservedAt`); the build
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

import { dayFiles, PARTIAL_LIMIT, rebuildKeys, writeDays } from './occurrence-days.ts';

/** The frontend's definition of a day (src/salish-sea.ts, dateFromObservedAt). */
function frontendDay(observedAt: string): string {
    return Temporal.Instant.from(observedAt)
        .toZonedDateTimeISO('PST8PDT')
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
            `INSERT INTO store.build.occurrences VALUES ('${id}', '${observed_at}', '${JSON.stringify({id, observed_at})}')`,
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
    async function* chunks(...cs: [string, string][][]) { yield* cs; }

    test('one file per day across chunk boundaries, counted', async () => {
        const counts = {files: 0, occurrences: 0};
        const files = [];
        for await (const file of dayFiles(chunks(
            [['2026-09-28', '{"id": "a"}'], ['2026-09-29', '{"id": "b"}']],
            [['2026-09-29', '{"id": "c"}']],
            [],
            [['2026-09-30', '{"id": "d"}']],
        ), counts)) files.push(file);
        expect(files).toEqual([
            ['2026-09-28.json', '[{"id":"a"}]'],
            ['2026-09-29.json', '[{"id":"b"},{"id":"c"}]'],
            ['2026-09-30.json', '[{"id":"d"}]'],
        ]);
        expect(counts).toEqual({files: 3, occurrences: 4});
    });

    test('a row with no day is on no file and is not counted', async () => {
        const counts = {files: 0, occurrences: 0};
        const out: [string, string][] = [];
        for await (const file of dayFiles((async function* () { yield [['2025-01-01', '{"id":"a"}'], [null, '{"id":"no-day"}']] as [string | null, string][]; })(), counts))
            out.push(file);
        expect(out).toEqual([['2025-01-01.json', '[{"id":"a"}]']]);
        expect(counts).toEqual({files: 1, occurrences: 1});
    });

    test('no rows, no files', async () => {
        const files = [];
        for await (const file of dayFiles(chunks())) files.push(file);
        expect(files).toEqual([]);
    });
});
