/**
 * Write Happywhale's frozen tables to one DuckDB file, for the build to read (decision
 * 064, salish-9uu.2.4).
 *
 *   node scripts/read-path/happywhale-export.ts <happywhale.duckdb> --from-snapshot <snapshot.duckdb>
 *
 * Nothing has written happywhale.* since its in-database loader stopped being called
 * (decision 061), so the build needs it once. The file holds each table as the snapshot
 * read it (snapshot.ts's HAPPYWHALE_TABLES: the same columns, a location as two doubles,
 * enums as text), under `happywhale.<table>`, and lives beside the mirrors on the volume,
 * not in the repository: it carries Happywhale contributors' names (Peter, 2026-10-05).
 *
 * From a snapshot that already holds them in that shape, which is how the volume's copy
 * was made. Postgres is gone (salish-9uu.14); its final dump, in the backups bucket at
 * final/postgres-2026-10-09/, still holds the tables if the volume's copy and its snapshots
 * are ever all lost. Refuses to replace an existing file: the build treats it as upstream
 * data snapshotted in, and replacing it is a deliberate act (delete it first). The export
 * is written beside it and renamed into place only once it is complete, so a failed or
 * interrupted one leaves nothing at `out`; the finished file is read-only, as the build
 * only reads it.
 */

import { chmodSync, existsSync, renameSync, rmSync } from 'node:fs';

import { DuckDBInstance } from '@duckdb/node-api';

import { HAPPYWHALE_TABLES } from './snapshot.ts';

export async function exportHappywhale(out: string, source: {snapshot: string}): Promise<Record<string, number>> {
    if (existsSync(out)) throw new Error(`${out} exists: Happywhale's frozen file is replaced only on purpose — delete it first`);
    const staging = `${out}.partial`;
    for (const f of [staging, `${staging}.wal`]) rmSync(f, {force: true});
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let done = false;
    try {
        await conn.run(`ATTACH '${staging.replaceAll("'", "''")}' AS out`);
        await conn.run('CREATE SCHEMA out.happywhale');
        await conn.run(`ATTACH '${source.snapshot.replaceAll("'", "''")}' AS snap (READ_ONLY)`);
        await conn.run('BEGIN');
        const counts: Record<string, number> = {};
        for (const {table} of HAPPYWHALE_TABLES) {
            await conn.run(`CREATE TABLE out.${table} AS SELECT * FROM snap.${table}`);
            counts[table] = Number((await conn.runAndReadAll(`SELECT count(*) FROM out.${table}`)).getRows()[0]![0]);
            if (counts[table] === 0) throw new Error(`${table}: no rows`);
        }
        await conn.run('COMMIT');
        done = true;
        return counts;
    } finally {
        // closing checkpoints the staging file, so it is whole before it is published
        conn.closeSync();
        db.closeSync();
        if (done) {
            renameSync(staging, out);
            chmodSync(out, 0o444);
        } else {
            for (const f of [staging, `${staging}.wal`]) rmSync(f, {force: true});
        }
    }
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const at = args.indexOf('--from-snapshot');
    const snapshot = at >= 0 ? args[at + 1] : undefined;
    const [out] = at >= 0 ? args.slice(0, at) : args;
    if (!out || !snapshot) {
        console.error('usage: happywhale-export.ts <happywhale.duckdb> --from-snapshot <snapshot.duckdb>');
        process.exit(2);
    }
    const counts = await exportHappywhale(out, {snapshot});
    for (const [table, n] of Object.entries(counts)) console.log(`${table}: ${n} rows`);
}
