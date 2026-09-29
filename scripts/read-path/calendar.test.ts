/**
 * The calendar files count what occurrence_days counts: Pacific days, inclusive
 * boxes, and nothing without a location — not even for "Everywhere".
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { pugetSoundExtent } from '../../src/extents.ts';
import { writeCalendar, type MonthCounts } from './calendar.ts';

const [minLon, minLat, maxLon, maxLat] = pugetSoundExtent;

const ROWS: {id: string, observed_at: string, location: {lon: number, lat: number} | null}[] = [
    // Noon Pacific on 2025-03-09, on each edge of the Puget Sound box and outside it.
    {id: 'sw-corner', observed_at: '2025-03-09T20:00:00Z', location: {lon: minLon, lat: minLat}},
    {id: 'ne-corner', observed_at: '2025-03-09T20:00:00Z', location: {lon: maxLon, lat: maxLat}},
    {id: 'west-of-it', observed_at: '2025-03-09T20:00:00Z', location: {lon: minLon - 0.001, lat: minLat}},
    {id: 'nowhere', observed_at: '2025-03-09T20:00:00Z', location: null},
    // 23:30 Pacific on 2025-03-31 is April 1 in UTC: still March's file.
    {id: 'last-of-march', observed_at: '2025-04-01T06:30:00Z', location: {lon: minLon, lat: minLat}},
];

let dir: string;

beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'read-path-calendar-'));
    const snapshot = path.join(dir, 'snapshot.duckdb');
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(`ATTACH '${snapshot}' AS store`);
    await conn.run('CREATE SCHEMA store.snapshot');
    await conn.run('CREATE TABLE store.snapshot.occurrences (id VARCHAR, observed_at TIMESTAMPTZ, doc VARCHAR)');
    for (const {id, observed_at, location} of ROWS) {
        await conn.run(`INSERT INTO store.snapshot.occurrences VALUES
            ('${id}', '${observed_at}', '${JSON.stringify({id, observed_at, location})}')`);
    }
    await conn.run('DETACH store');
    conn.closeSync();
    await writeCalendar(snapshot, dir);
});

async function month(name: string): Promise<MonthCounts> {
    return JSON.parse(await readFile(path.join(dir, 'calendar', `${name}.json`), 'utf8'));
}

describe('writeCalendar', () => {
    test('a box counts its edges and not beyond them', async () => {
        expect((await month('2025-03'))['puget-sound']?.['2025-03-09']).toBe(2);
    });

    test('"Everywhere" counts every located row, and no unlocated one', async () => {
        expect((await month('2025-03'))['everywhere']?.['2025-03-09']).toBe(3);
    });

    test('a late-evening Pacific sighting is in its Pacific month', async () => {
        expect((await month('2025-03'))['puget-sound']?.['2025-03-31']).toBe(1);
        expect(await readdir(path.join(dir, 'calendar'))).toEqual(['2025-03.json']);
    });
});
