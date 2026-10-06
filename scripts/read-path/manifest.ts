/**
 * The read path's manifest: what the last build covered (salish-t3g.4).
 *
 *   EXPORT_DIR=… node scripts/read-path/manifest.ts <snapshot.duckdb>
 *
 * Writes $EXPORT_DIR/manifest.json:
 *
 *   {"version": 1,
 *    "snapshot_taken_at": "2026-09-28T20:39:36.123Z",
 *    "covered_through": "2026-09-28"}
 *
 * A day with no sightings has no file, and neither does a day no build has
 * reached, so a missing file means nothing on its own. `covered_through` is the
 * Pacific date the snapshot was taken on: every day up to and including it is
 * covered, so a missing file there is a day with no sightings, and past it is a
 * day not built yet. The browser also watches `snapshot_taken_at` to notice a
 * new build.
 *
 * Deliberately small, with no list of days or their hashes: a signed-out tab
 * polls it every minute. It is written after the day files, by the graph's
 * ordering, so it never claims a build whose files aren't in place; and it is
 * replaced with a rename, so a reader never sees half of one.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { dayOf } from './pacific-day.ts';


export type Manifest = {
    version: 1,
    snapshot_taken_at: string,
    covered_through: string,
};

export async function writeManifest(snapshot: string, exportDir: string): Promise<Manifest> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let row;
    try {
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        const reader = await conn.runAndReadAll(`
            SELECT strftime(taken_at AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%M:%S.%gZ') AS taken_at,
                   ${dayOf('taken_at')} AS covered_through
            FROM store.snapshot.meta
        `);
        const rows = reader.getRows() as [string, string][];
        if (rows.length !== 1) throw new Error(`snapshot.meta: expected one row, found ${rows.length}`);
        row = rows[0]!;
    } finally {
        conn.closeSync();
    }

    const manifest: Manifest = {version: 1, snapshot_taken_at: row[0], covered_through: row[1]};
    const file = path.join(exportDir, 'manifest.json');
    await writeFile(`${file}.tmp`, JSON.stringify(manifest));
    await rename(`${file}.tmp`, file);
    return manifest;
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !exportDir) {
        console.error('usage: EXPORT_DIR=… manifest.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const manifest = await writeManifest(snapshot, exportDir);
    console.log(`manifest.json: covered through ${manifest.covered_through} (snapshot ${manifest.snapshot_taken_at})`);
}

if (import.meta.main) {
    await main();
}
