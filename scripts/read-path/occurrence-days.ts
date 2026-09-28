/**
 * One file per Pacific calendar day of occurrences, from the read-path snapshot
 * (salish-t3g.1).
 *
 *   EXPORT_DIR=… tsx scripts/read-path/occurrence-days.ts <snapshot.duckdb>
 *
 * Writes $EXPORT_DIR/days/<YYYY-MM-DD>.json for every day that has at least one
 * occurrence: a JSON array, newest first — what `fetchOccurrences` receives for
 * that day with no region selected. The region is left to the browser, so the
 * seven regions don't multiply the files.
 *
 * A day with no occurrences has no file. The directory is rewritten whole each
 * run, so a day that loses its last occurrence loses its file too.
 *
 * Deterministic by construction: rows are ordered by observed_at and then id
 * (PostgREST orders by observed_at alone, so ties there fall in no particular
 * order), and each document is re-serialized compactly from Postgres's jsonb
 * text, whose key order Postgres fixes.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * The frontend's own definition of a day: `dateFromObservedAt` and
 * `fetchOccurrences` both use this zone.
 */
const DAY_ZONE = 'PST8PDT';

/**
 * Write the day files for `snapshot` under `exportDir/days`, replacing whatever
 * was there. Returns what it wrote.
 */
export async function writeDays(
    snapshot: string,
    exportDir: string,
): Promise<{files: number, occurrences: number}> {
    const outDir = path.join(exportDir, 'days');

    // Attached under a fixed name: opened directly, the file's catalog is named
    // after the file, and a file called snapshot.duckdb would make
    // `snapshot.occurrences` ambiguous between catalog and schema.
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let rows;
    try {
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        const reader = await conn.runAndReadAll(`
            SELECT strftime(timezone('${DAY_ZONE}', observed_at), '%Y-%m-%d') AS day, doc
            FROM store.snapshot.occurrences
            ORDER BY day, observed_at DESC, id
        `);
        rows = reader.getRows() as [string, string][];
    } finally {
        conn.closeSync();
    }

    const days = new Map<string, unknown[]>();
    for (const [day, doc] of rows) {
        let list = days.get(day);
        if (!list) days.set(day, list = []);
        list.push(JSON.parse(doc));
    }

    await rm(outDir, {recursive: true, force: true});
    await mkdir(outDir, {recursive: true});
    for (const [day, list] of days) {
        await writeFile(path.join(outDir, `${day}.json`), JSON.stringify(list));
    }
    return {files: days.size, occurrences: rows.length};
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !exportDir) {
        console.error('usage: EXPORT_DIR=… occurrence-days.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const {files, occurrences} = await writeDays(snapshot, exportDir);
    console.log(`days/: ${files} files, ${occurrences} occurrences`);
}

// Only when run as a script, so the test can import writeDays.
if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
