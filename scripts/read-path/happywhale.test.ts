import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, test } from 'vitest';

import { exportHappywhale } from './happywhale-export.ts';
import { loadHappywhale } from './happywhale.ts';
import { HAPPYWHALE_TABLES } from './snapshot.ts';

/** A snapshot holding one row of each Happywhale table, as snapshot.ts would have read it. */
async function snapshotWithHappywhale(file: string, empty?: string): Promise<void> {
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(`ATTACH '${file}' AS s; CREATE SCHEMA s.happywhale`);
    for (const {table} of HAPPYWHALE_TABLES)
        await conn.run(`CREATE TABLE s.${table} AS SELECT 1 AS id, 'x' AS name${table === empty ? ' WHERE false' : ''}`);
    conn.closeSync();
}

describe("Happywhale's frozen file (decision 064)", () => {
    test('exported from a snapshot and loaded into another, every table arrives as it was', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'happywhale-'));
        try {
            await snapshotWithHappywhale(path.join(dir, 'from.duckdb'));
            const frozen = path.join(dir, 'happywhale.duckdb');
            await exportHappywhale(frozen, {snapshot: path.join(dir, 'from.duckdb')});
            const counts = await loadHappywhale(path.join(dir, 'to.duckdb'), frozen);
            expect(Object.keys(counts)).toEqual(HAPPYWHALE_TABLES.map(t => t.table));
            expect(Object.values(counts).every(n => n === 1)).toBe(true);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });

    test('the file is never replaced by accident', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'happywhale-'));
        try {
            await snapshotWithHappywhale(path.join(dir, 'from.duckdb'));
            const frozen = path.join(dir, 'happywhale.duckdb');
            await exportHappywhale(frozen, {snapshot: path.join(dir, 'from.duckdb')});
            await expect(exportHappywhale(frozen, {snapshot: path.join(dir, 'from.duckdb')})).rejects.toThrow(/delete it first/);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });

    test('an empty table is refused rather than a map published without Happywhale', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'happywhale-'));
        try {
            await snapshotWithHappywhale(path.join(dir, 'from.duckdb'), 'happywhale.media');
            await expect(exportHappywhale(path.join(dir, 'happywhale.duckdb'), {snapshot: path.join(dir, 'from.duckdb')}))
                .rejects.toThrow(/happywhale.media: no rows/);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });
});
