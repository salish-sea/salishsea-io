/**
 * The manifest's coverage is the Pacific date the snapshot was taken on — the
 * frontend's own day — so a snapshot a second before Pacific midnight covers
 * that day and not the next.
 */

import { describe, test, expect } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { writeManifest } from './manifest.ts';

async function snapshotTakenAt(takenAt: string): Promise<{snapshot: string, exportDir: string}> {
    const dir = await mkdtemp(path.join(tmpdir(), 'read-path-manifest-'));
    const snapshot = path.join(dir, 'snapshot.duckdb');
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(`ATTACH '${snapshot}' AS store`);
    await conn.run('CREATE SCHEMA store.snapshot');
    await conn.run(`CREATE TABLE store.snapshot.meta AS SELECT TIMESTAMPTZ '${takenAt}' AS taken_at`);
    await conn.run('DETACH store');
    conn.closeSync();
    return {snapshot, exportDir: dir};
}

describe('writeManifest', () => {
    test.each([
        ['2025-03-09T07:59:59.500Z', '2025-03-08'],   // 23:59:59 PST
        ['2025-03-09T08:00:00.000Z', '2025-03-09'],   // midnight PST, the spring-forward day
        ['2025-11-02T06:59:59.000Z', '2025-11-01'],   // 23:59:59 PDT
        ['2025-11-02T07:00:00.000Z', '2025-11-02'],   // midnight PDT, the fall-back day
    ])('a snapshot taken at %s covers through %s', async (takenAt, coveredThrough) => {
        const {snapshot, exportDir} = await snapshotTakenAt(takenAt);
        await writeManifest(snapshot, exportDir);
        const manifest = JSON.parse(await readFile(path.join(exportDir, 'manifest.json'), 'utf8'));
        expect(manifest).toEqual({version: 1, snapshot_taken_at: takenAt, covered_through: coveredThrough});
    });

    test('leaves no temporary file behind', async () => {
        const {snapshot, exportDir} = await snapshotTakenAt('2025-03-09T20:00:00.000Z');
        await writeManifest(snapshot, exportDir);
        expect((await readdir(exportDir)).sort()).toEqual(['manifest.json', 'snapshot.duckdb']);
    });
});
