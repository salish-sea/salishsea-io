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

import { writeDays } from './occurrence-days.ts';

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

beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'read-path-days-'));
    const snapshot = path.join(dir, 'snapshot.duckdb');
    // Named snapshot.duckdb on purpose: the file's catalog then shares the
    // schema's name, which is ambiguous unless the reader attaches it by alias.
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    await conn.run(`ATTACH '${snapshot}' AS store`);
    await conn.run('CREATE SCHEMA store.snapshot');
    await conn.run(
        'CREATE TABLE store.snapshot.occurrences (id VARCHAR, observed_at TIMESTAMPTZ, doc VARCHAR)',
    );
    for (const {id, observed_at} of ROWS) {
        await conn.run(
            `INSERT INTO store.snapshot.occurrences VALUES ('${id}', '${observed_at}', '${JSON.stringify({id, observed_at})}')`,
        );
    }
    await conn.run('DETACH store');
    conn.closeSync();

    // A file from an earlier build for a day that no longer has occurrences.
    exportDir = path.join(dir, 'export');
    await mkdir(path.join(exportDir, 'days'), {recursive: true});
    await writeFile(path.join(exportDir, 'days', '2020-01-01.json'), '[]');

    await writeDays(snapshot, exportDir);
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
});
