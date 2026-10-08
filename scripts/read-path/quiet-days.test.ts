/**
 * The empty day files: one for each day of the window ending on the snapshot's Pacific
 * day, the manifest's covered_through, that has no occurrence, and none for a day that has.
 */

import { describe, test, expect } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { WINDOW_DAYS, writeQuietDays } from './quiet-days.ts';

async function snapshotWith(takenAt: string, observedAt: (string | null)[]): Promise<{snapshot: string, exportDir: string}> {
    const dir = await mkdtemp(path.join(tmpdir(), 'read-path-quiet-days-'));
    const snapshot = path.join(dir, 'snapshot.duckdb');
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(`ATTACH '${snapshot}' AS store`);
    await conn.run('CREATE SCHEMA store.snapshot');
    await conn.run('CREATE SCHEMA store.build');
    await conn.run(`CREATE TABLE store.snapshot.meta AS SELECT TIMESTAMPTZ '${takenAt}' AS taken_at`);
    await conn.run('CREATE TABLE store.build.occurrences (id VARCHAR, observed_at TIMESTAMPTZ)');
    for (const [i, at] of observedAt.entries())
        await conn.run(`INSERT INTO store.build.occurrences VALUES ('o${i}', ${at === null ? 'NULL' : `TIMESTAMPTZ '${at}'`})`);
    await conn.run('DETACH store');
    conn.closeSync();
    return {snapshot, exportDir: dir};
}

describe('writeQuietDays', () => {
    test('writes [] for each quiet day of the window and nothing for a day with occurrences', async () => {
        // 07:20 PDT on 2026-10-08, the morning of GH #651's red deploy
        const {snapshot, exportDir} = await snapshotWith('2026-10-08T14:20:00Z', [
            '2026-10-07T20:00:00Z',   // 13:00 PDT on the 7th
            '2026-10-08T06:30:00Z',   // 23:30 PDT on the 7th, not the 8th
            '2026-09-09T19:00:00Z',   // the window's first day
            '2026-09-08T19:00:00Z',   // before it
            null,                     // on no day, and harmless to the NOT IN
        ]);
        const days = await writeQuietDays(snapshot, exportDir);
        expect(days).toHaveLength(WINDOW_DAYS - 2);
        expect(days[0]).toBe('2026-09-10');
        expect(days.at(-1)).toBe('2026-10-08');
        expect(days).not.toContain('2026-10-07');
        const files = await readdir(path.join(exportDir, 'quiet-days'));
        expect(files.sort()).toEqual(days.map(d => `${d}.json`));
        expect(await readFile(path.join(exportDir, 'quiet-days', '2026-10-08.json'), 'utf8')).toBe('[]');
    });

    test('the window ends on the Pacific day, as the manifest\'s coverage does', async () => {
        // 23:59:59 PST on 2025-03-08: the 9th isn't covered yet, so it gets no file
        const {snapshot, exportDir} = await snapshotWith('2025-03-09T07:59:59Z', []);
        const days = await writeQuietDays(snapshot, exportDir);
        expect(days).toHaveLength(WINDOW_DAYS);
        expect(days.at(-1)).toBe('2025-03-08');
    });

    test('a day that gains an occurrence loses its file on the next run', async () => {
        const quiet = await snapshotWith('2026-10-08T14:20:00Z', []);
        await writeQuietDays(quiet.snapshot, quiet.exportDir);
        const reported = await snapshotWith('2026-10-08T15:00:00Z', ['2026-10-08T14:50:00Z']);
        // the same export dir, as each build rewrites it
        await writeQuietDays(reported.snapshot, quiet.exportDir);
        expect(await readdir(path.join(quiet.exportDir, 'quiet-days'))).not.toContain('2026-10-08.json');
    });
});
