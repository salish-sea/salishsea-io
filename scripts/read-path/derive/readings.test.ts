/**
 * The readings the build writes (derive/readings.ts): each source's texts, read by
 * src/sighting-text.ts, into memory.reading under the id its occurrence view gives it.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { expect, test } from 'vitest';

import { CREATE_READING, writeReadings } from './readings.ts';

test('each source, read into memory.reading by its occurrence id', async () => {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`CREATE TABLE source_maplify_sightings AS SELECT * FROM (VALUES
            (1, '[Orca Network] Biggs T46s (-D), likely T65A5 heading NB (Pat Doe)<br><br>Submitted by a Trusted Observer'),
            (2, 'Three orcas near the rocks.'),
            (3, NULL),
            (4, '[Orca Network: J and K pods southbound]')) AS t(id, comments)`);
        await conn.run(`CREATE TABLE source_inaturalist_observations AS SELECT * FROM (VALUES
            (9, 'Humpback BCX1068 lunge feeding, westbound')) AS t(id, description)`);
        await conn.run(`CREATE SCHEMA public`);
        await conn.run(`CREATE TABLE public.observations AS SELECT * FROM (VALUES
            ('0199-a', 'L pod milling')) AS t(id, body)`);
        await conn.run(CREATE_READING);
        expect(await writeReadings(conn, 'maplify')).toBe(2);
        expect(await writeReadings(conn, 'inaturalist')).toBe(1);
        expect(await writeReadings(conn, 'native')).toBe(1);
        const rows = (await conn.runAndReadAll('SELECT * FROM memory.reading ORDER BY id')).getRowObjectsJson();
        expect(rows).toEqual([
            {id: '0199-a', direction: 'milling', claims: [], pods: ['L']},
            {id: 'inaturalist:9', direction: 'west', claims: [{code: 'BCX1068', presence: 'present', certainty: 'certain'}], pods: []},
            {id: 'maplify:1', direction: 'north', claims: [
                {code: 'T46s', presence: 'present', certainty: 'certain'},
                {code: 'T65A5', presence: 'present', certainty: 'probable'},
                {code: 'T46D', presence: 'absent', certainty: 'certain'},
            ], pods: []},
            // a text that names nothing, or none at all, has no row
            {id: 'maplify:4', direction: 'south', claims: [], pods: ['J', 'K']},
        ]);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
});
