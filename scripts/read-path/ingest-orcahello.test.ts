import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { parseOrcaHelloPage, type OrcaHelloRow } from '../ingest/orcahello.ts';
import { plan } from '../ingest/orcahello.ts';
import { ensureMirror, main, markAttempt, markDay, markDayAttempt, readSchedule, upsertRows } from './ingest-orcahello.ts';

/** Five OrcaHello detections from 2026 (scripts/ingest/fixtures/orcahello-detections.json). */
const page = parseOrcaHelloPage(JSON.parse(readFileSync(path.join(import.meta.dirname, '../ingest/fixtures/orcahello-detections.json'), 'utf8')));
if (!page.ok) throw new Error(page.error);
const rows: OrcaHelloRow[] = [...page.rows];

const read = (file: string) => {
    const db = new DatabaseSync(file, {readOnly: true});
    try { return db.prepare('SELECT * FROM detections ORDER BY id').all() as unknown as OrcaHelloRow[]; } finally { db.close(); }
};

describe('the mirror of OrcaHello\'s detections', () => {
    let dir: string;
    beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'orcahello-mirror-')); });
    afterAll(async () => { await rm(dir, {recursive: true, force: true}); });

    test('holds the rows written, counts what was added, and a second write of them changes nothing', () => {
        const file = path.join(dir, 'a.sqlite');
        expect(upsertRows(file, rows)).toEqual({changed: 5, kept: 0});
        expect(read(file).map(r => r.id).sort()).toEqual(rows.map(r => r.id).sort());
        expect(upsertRows(file, rows)).toEqual({changed: 0, kept: 0});
    });

    test('a moderator\'s answer replaces the unanswered row, and counts as one change', () => {
        const file = path.join(dir, 'b.sqlite');
        upsertRows(file, rows);
        const answered = {...rows[0]!, reviewed: 1, found: 'no', moderated_at: '2026-11-25T10:00:00+00:00'};
        expect(upsertRows(file, [answered])).toEqual({changed: 1, kept: 0});
        expect(read(file).find(r => r.id === answered.id)).toMatchObject({reviewed: 1, found: 'no'});
    });

    test('never deletes: a row OrcaHello stops sending stays', () => {
        const file = path.join(dir, 'c.sqlite');
        upsertRows(file, rows);
        upsertRows(file, rows.slice(0, 1));
        expect(read(file)).toHaveLength(5);
    });

    test('has no column for the moderator, their comment or the clip', () => {
        const file = path.join(dir, 'd.sqlite');
        ensureMirror(file);
        const db = new DatabaseSync(file, {readOnly: true});
        try {
            const columns = (db.prepare("SELECT name FROM pragma_table_info('detections')").all() as {name: string}[]).map(c => c.name);
            expect(columns.filter(c => /moderator|comment|audio|spectrogram/.test(c))).toEqual([]);
        } finally { db.close(); }
    });

    test('keeps the schedule\'s state: when each kind of fetch was attempted and when each day was read whole', () => {
        const file = path.join(dir, 'e.sqlite');
        expect(readSchedule(file)).toEqual({state: {recent: null, cycle: null, old: null}, fetchedAt: new Map()});
        markAttempt(file, 'recent', new Date('2026-11-26T12:00:00Z'));
        markDay(file, '2026-11-26', 120, new Date('2026-11-26T12:00:30Z'));
        markDay(file, '2026-11-26', 130, new Date('2026-11-26T12:20:30Z'));
        expect(readSchedule(file)).toEqual({
            state: {recent: '2026-11-26T12:00:00.000Z', cycle: null, old: null},
            fetchedAt: new Map([['2026-11-26', '2026-11-26T12:20:30.000Z']]),
        });
    });

    test('never replaces a row a moderator answered with one that says no one has, and says how many it kept', () => {
        const file = path.join(dir, 'f.sqlite');
        const answered = {...rows[0]!, reviewed: 1, found: 'no', moderated_at: '2026-11-25T10:00:00+00:00'};
        upsertRows(file, [answered]);
        const lost = {...rows[0]!, reviewed: 0, found: 'No', moderated_at: null};
        expect(upsertRows(file, [lost])).toEqual({changed: 0, kept: 1});
        expect(read(file).find(r => r.id === answered.id)).toMatchObject({reviewed: 1, found: 'no'});
        // a changed answer is still taken
        expect(upsertRows(file, [{...answered, found: 'yes'}])).toEqual({changed: 1, kept: 0});
    });

    test('a day that is tried goes to the back of the cycle, so one that never completes does not stall it', () => {
        const file = path.join(dir, 'g.sqlite');
        const now = new Date('2026-11-26T12:00:00Z');
        const state = {recent: now.toISOString(), cycle: null, old: now.toISOString()};
        const first = plan(state, readSchedule(file).fetchedAt, now, 0.5)[0]!.day;
        // it is tried and never completes: no markDay, only the attempt
        markDayAttempt(file, first, now);
        const second = plan(state, readSchedule(file).fetchedAt, now, 0.5)[0]!.day;
        expect(second).not.toBe(first);
        markDayAttempt(file, second, now);
        expect(plan(state, readSchedule(file).fetchedAt, now, 0.5)[0]!.day).not.toBe(second);
    });
});

// main() on a stubbed fetch: never the live API. Argv and the clock are the run's own.
describe('main', () => {
    let dir: string;
    beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'orcahello-main-')); });
    afterAll(async () => { await rm(dir, {recursive: true, force: true}); });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    const empty = () => new Response(null, {status: 204, headers: {totalNumberRecords: '0'}});
    const runs = (file: string) => {
        const db = new DatabaseSync(path.join(path.dirname(file), 'runs.sqlite'), {readOnly: true});
        try { return db.prepare('SELECT outcome, error FROM runs ORDER BY id').all() as {outcome: string | null, error: string | null}[]; } finally { db.close(); }
    };

    test('a second run straight after the first has nothing due and fetches nothing', async () => {
        const file = path.join(dir, 'twice', 'orcahello.sqlite');
        const fetched: string[] = [];
        vi.stubGlobal('fetch', (url: string) => { fetched.push(url); return Promise.resolve(empty()); });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        process.argv = ['node', 'ingest-orcahello.ts', file];
        await main({pauseMs: 0});
        // today and yesterday, one of the month, one old day
        expect(fetched).toHaveLength(4);
        fetched.length = 0;
        await main({pauseMs: 0});
        expect(fetched).toEqual([]);
        expect(runs(file).map(r => r.outcome)).toEqual(['success', 'success']);
    });

    test('each kind is stamped when its first fetch begins, not when the run started', async () => {
        const file = path.join(dir, 'clock', 'orcahello.sqlite');
        let t = Date.parse('2026-11-26T12:00:00Z');
        // every fetch takes a minute by the clock the run is given
        vi.stubGlobal('fetch', () => { t += 60_000; return Promise.resolve(empty()); });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        process.argv = ['node', 'ingest-orcahello.ts', file];
        await main({pauseMs: 0, clock: () => new Date(t)});
        const {state} = readSchedule(file);
        // recent begins at the start; today and yesterday took two minutes, so cycle begins then, old a minute after
        expect(state).toEqual({recent: '2026-11-26T12:00:00.000Z', cycle: '2026-11-26T12:02:00.000Z', old: '2026-11-26T12:03:00.000Z'});
    });

    test('a day that comes back short fails the run, keeps its pages and is not marked read', async () => {
        const file = path.join(dir, 'short', 'orcahello.sqlite');
        const page = JSON.parse(readFileSync(path.join(import.meta.dirname, '../ingest/fixtures/orcahello-detections.json'), 'utf8'))
            .slice(0, 2).map((d: object) => ({...d, timestamp: '2026-11-20T01:00:00Z'}));
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(page), {status: 200, headers: {totalNumberRecords: '9'}})));
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        process.argv = ['node', 'ingest-orcahello.ts', file, '2026-11-20', '2026-11-20'];
        await expect(main({pauseMs: 0})).rejects.toThrow(/2 of 9 detections came back/);
        expect(read(file)).toHaveLength(2);
        expect(readSchedule(file).fetchedAt.get('2026-11-20')).toBeDefined(); // attempted
        const db = new DatabaseSync(file, {readOnly: true});
        try { expect((db.prepare('SELECT count(*) AS n FROM windows').get() as {n: number}).n).toBe(0); } finally { db.close(); }
        expect(runs(file).at(-1)).toMatchObject({outcome: 'failed'});
    });

    test('a failure on one day does not stop the others that are due, unless the upstream is down', async () => {
        const file = path.join(dir, 'partial', 'orcahello.sqlite');
        let calls: string[] = [];
        // the first day's detections come back malformed (not an upstream fault); the others are empty
        vi.stubGlobal('fetch', (url: string) => {
            calls.push(new URL(url).searchParams.get('DateFrom')!);
            return Promise.resolve(calls.length === 1 ? new Response('{"nope":1}', {status: 200, headers: {totalNumberRecords: '1'}}) : empty());
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        process.argv = ['node', 'ingest-orcahello.ts', file];
        await main({pauseMs: 0});
        expect(calls).toHaveLength(4);
        expect(runs(file).at(-1)).toMatchObject({outcome: 'failed'});
        // now an upstream fault on the first day: the run stops there, and the kinds it never reached stay due
        const down = path.join(dir, 'down', 'orcahello.sqlite');
        calls = [];
        vi.stubGlobal('fetch', (url: string) => { calls.push(url); return Promise.resolve(new Response('', {status: 503})); });
        process.argv = ['node', 'ingest-orcahello.ts', down];
        await main({pauseMs: 0});
        expect(calls).toHaveLength(1);
        const {state} = readSchedule(down);
        expect(state).toMatchObject({cycle: null, old: null});
        expect(state.recent).not.toBeNull();
    });
});
