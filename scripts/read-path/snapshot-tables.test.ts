import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { expect, test } from 'vitest';

import { readSnapshot } from './snapshot-tables.ts';

// A page's "current year" is snapshot.year, never snapshot.meta's moment: the pages'
// Stelis tasks take only the year as input, so they skip a build in the same year that
// changed nothing they show (salish-xv35.12). Reading taken_at here would make that
// input a lie: a page could then change without its declared input changing.
test('the year comes from snapshot.year, and snapshot.meta is not read', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'snapshot-tables-'));
    try {
        const file = path.join(dir, 'pages.duckdb');
        const db = await DuckDBInstance.create(file);
        const conn = await db.connect();
        await conn.run('CREATE SCHEMA snapshot');
        await conn.run('CREATE TABLE snapshot.year AS SELECT 2026::INTEGER AS year');
        conn.closeSync();
        db.closeSync();
        expect(await readSnapshot(file, s => s.year())).toBe(2026);
    } finally {
        await rm(dir, {recursive: true, force: true});
    }
});

// The links from a subject to its sightings are the build's (salish-xv35.13), derived under
// build.; the catalogue is Postgres's, under snapshot. Postgres's own link views are no
// longer in a production snapshot at all (salish-xv35.9).
test('a link table comes from build., a catalogue table from snapshot.', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'snapshot-tables-'));
    try {
        const file = path.join(dir, 'pages.duckdb');
        const db = await DuckDBInstance.create(file);
        const conn = await db.connect();
        await conn.run('CREATE SCHEMA snapshot; CREATE SCHEMA build');
        await conn.run(`CREATE TABLE snapshot.haulouts AS SELECT '{"id":1}' AS doc`);
        await conn.run(`CREATE TABLE build.haulout_occurrences AS SELECT '{"haulout_id":1}' AS doc`);
        conn.closeSync();
        db.closeSync();
        expect(await readSnapshot(file, s => s.tables(['haulouts', 'haulout_occurrences']))).toEqual({
            haulouts: [{id: 1}],
            haulout_occurrences: [{haulout_id: 1}],
        });
    } finally {
        await rm(dir, {recursive: true, force: true});
    }
});
