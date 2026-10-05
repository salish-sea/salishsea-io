/**
 * Happywhale's frozen tables, read from their file on the volume rather than from
 * Postgres (decision 064, salish-9uu.2.4).
 *
 *   node scripts/read-path/happywhale.ts <snapshot.duckdb> <happywhale.duckdb>
 *
 * Copies each `happywhale.<table>` from the frozen file (happywhale-export.ts wrote it)
 * into the snapshot under the same name and shape, so the derivation reads them
 * unchanged, in one transaction. Refuses an empty table rather than publish a map
 * without Happywhale.
 */

import { DuckDBInstance } from '@duckdb/node-api';

import { budget } from './duckdb-budget.ts';
import { HAPPYWHALE_TABLES } from './snapshot.ts';

export async function loadHappywhale(snapshot: string, frozen: string): Promise<Record<string, number>> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store`);
        await conn.run(`ATTACH '${frozen.replaceAll("'", "''")}' AS frozen (READ_ONLY)`);
        await conn.run('CREATE SCHEMA IF NOT EXISTS store.happywhale');
        await conn.run('BEGIN');
        const counts: Record<string, number> = {};
        for (const {table} of HAPPYWHALE_TABLES) {
            await conn.run(`CREATE OR REPLACE TABLE store.${table} AS SELECT * FROM frozen.${table}`);
            counts[table] = Number((await conn.runAndReadAll(`SELECT count(*) FROM store.${table}`)).getRows()[0]![0]);
            if (counts[table] === 0) throw new Error(`${table}: no rows in ${frozen}`);
        }
        await conn.run('COMMIT');
        return counts;
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

if (import.meta.main) {
    const [snapshot, frozen] = process.argv.slice(2);
    if (!snapshot || !frozen) {
        console.error('usage: happywhale.ts <snapshot.duckdb> <happywhale.duckdb>');
        process.exit(2);
    }
    for (const [table, n] of Object.entries(await loadHappywhale(snapshot, frozen))) console.log(`${table}: ${n} rows`);
}
