import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { sqlString, withSnapshot } from './duckdb-budget.ts';

describe('sqlString', () => {
    test('quotes a path, doubling any quote in it', () => {
        expect(sqlString("/data/o'neill/snapshot.duckdb")).toBe("'/data/o''neill/snapshot.duckdb'");
    });
});

describe('withSnapshot', () => {
    let dir: string;
    let snapshot: string;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), "with-snapshot-'"));
        snapshot = path.join(dir, 'snapshot.duckdb');
    });
    afterEach(() => rm(dir, {recursive: true, force: true}));

    test('attaches the snapshot as store, writable only when asked, and returns what use returns', async () => {
        await withSnapshot(snapshot, {memory: '64MB', write: true}, conn => conn.run('CREATE TABLE store.t AS SELECT 42 AS n'));
        const n = await withSnapshot(snapshot, {memory: '64MB'}, async conn =>
            (await conn.runAndReadAll('SELECT n FROM store.t')).getRows()[0]![0]);
        expect(n).toBe(42);
        await expect(withSnapshot(snapshot, {memory: '64MB'}, conn => conn.run('CREATE TABLE store.u (n INTEGER)')))
            .rejects.toThrow(/read-only/i);
    });

    // Checked by spying, since a process can reopen a DuckDB file whether or not it closed it.
    test('closes the connection and the database whether use returns or throws', async () => {
        const conns = vi.spyOn(DuckDBConnection.prototype, 'closeSync');
        const dbs = vi.spyOn(DuckDBInstance.prototype, 'closeSync');
        try {
            await withSnapshot(snapshot, {memory: '64MB', write: true}, async () => {});
            await expect(withSnapshot(snapshot, {memory: '64MB', write: true}, async () => { throw new Error('boom'); }))
                .rejects.toThrow('boom');
            expect([conns.mock.calls.length, dbs.mock.calls.length]).toEqual([2, 2]);
        } finally {
            conns.mockRestore();
            dbs.mockRestore();
        }
    });

    test('caps memory and threads as the budget says', async () => {
        const settings = await withSnapshot(snapshot, {memory: '64MB', write: true}, async conn => (await conn.runAndReadAll(
            "SELECT current_setting('memory_limit'), current_setting('threads')")).getRows()[0]);
        expect(settings).toEqual(['61.0 MiB', 1n]);
    });
});
