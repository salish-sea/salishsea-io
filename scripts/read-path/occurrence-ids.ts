/**
 * The read path's id index: which Pacific day each occurrence is on, so a
 * `?o=<id>` link can be opened without asking the database (decision 056), from
 * the build's occurrences (build.occurrences, decision 061).
 *
 *   EXPORT_DIR=… node scripts/read-path/occurrence-ids.ts <snapshot.duckdb>
 *
 * Writes $EXPORT_DIR/ids/<shard>.json, `{"<id>": "YYYY-MM-DD", …}`, one file per
 * shard of src/read-path-shard.ts — the browser computes the same shard from the
 * id it was given, fetches that one file, and then the day's own file. About 250
 * ids a shard, so a few KB, and a new sighting rewrites only its own shard.
 */

import { DuckDBInstance } from '@duckdb/node-api';

import { budget } from './duckdb-budget.ts';
import * as path from 'node:path';

import { idShard } from '../../src/read-path-shard.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';

/** The frontend's day, as in occurrence-days.ts. */
const DAY_ZONE = 'PST8PDT';

export async function writeIds(snapshot: string, exportDir: string): Promise<{shards: number, ids: number}> {
    const outDir = path.join(exportDir, 'ids');
    await recoverDir(outDir);

    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let rows;
    try {
        // Two columns of build.occurrences, read once and sorted; the sort is the only
        // thing that could grow (salish-xv35.19; measured on Fly: see the bead).
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        const reader = await conn.runAndReadAll(`
            SELECT id, strftime(timezone('${DAY_ZONE}', observed_at), '%Y-%m-%d') AS day
            FROM store.build.occurrences
            -- An undated occurrence is on no day, so no day file holds it and the
            -- index has nothing to point a link at (decision 043 keeps them out of
            -- scope anyway); a null here would become a day of "null".
            WHERE observed_at IS NOT NULL
            ORDER BY id
        `);
        rows = reader.getRows() as [string, string][];
    } finally {
        conn.closeSync();
    }

    const shards = new Map<string, Record<string, string>>();
    for (const [id, day] of rows) {
        const shard = idShard(id);
        let ids = shards.get(shard);
        if (!ids) shards.set(shard, ids = {});
        ids[id] = day;
    }
    await replaceDir(outDir,
        [...shards].map(([shard, ids]) => [`${shard}.json`, JSON.stringify(ids)] as [string, string]));
    return {shards: shards.size, ids: rows.length};
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !exportDir) {
        console.error('usage: EXPORT_DIR=… occurrence-ids.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const {shards, ids} = await writeIds(snapshot, exportDir);
    console.log(`ids/: ${ids} ids in ${shards} shards`);
}

if (import.meta.main) {
    await main();
}
