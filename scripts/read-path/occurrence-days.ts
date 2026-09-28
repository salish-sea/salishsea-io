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
 * A day with no occurrences has no file. The directory is replaced whole each
 * run, so a day that loses its last occurrence loses its file too.
 *
 * Deterministic by construction: rows are ordered by observed_at and then id
 * (PostgREST orders by observed_at alone, so ties there fall in no particular
 * order), and each document is re-serialized compactly from Postgres's jsonb
 * text, whose key order Postgres fixes.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * The frontend's own definition of a day: `dateFromObservedAt` and
 * `fetchOccurrences` both use this zone.
 */
const DAY_ZONE = 'PST8PDT';

async function exists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
}

/**
 * Write the day files for `snapshot` under `exportDir/days`, replacing whatever
 * was there. Returns what it wrote.
 */
export async function writeDays(
    snapshot: string,
    exportDir: string,
): Promise<{files: number, occurrences: number}> {
    const outDir = path.join(exportDir, 'days');
    const staging = `${outDir}.staging`;
    const previous = `${outDir}.previous`;

    // A run that died between the two renames below left the last complete build
    // in previous and no days/. Put it back first, before anything here can fail,
    // so a failing run never leaves days/ missing.
    if (!(await exists(outDir)) && (await exists(previous))) {
        await rename(previous, outDir);
    }

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

    // Built beside the old directory and swapped in only once complete: a run that
    // fails partway leaves the last complete build in place, and a reader never
    // sees an empty or half-written days/ — which matters once it is served
    // straight from here.
    //
    // Swapping takes two renames, which is not atomic: days/ is absent between
    // them. Making it so is the publish step's job (it copies into the served
    // tree), not the build's. So is running one build at a time: the caller
    // holds the lock, as Stelis's callers do.
    await rm(staging, {recursive: true, force: true});
    await rm(previous, {recursive: true, force: true});
    try {
        await mkdir(staging, {recursive: true});
        for (const [day, list] of days) {
            await writeFile(path.join(staging, `${day}.json`), JSON.stringify(list));
        }
        const hadPrevious = await rename(outDir, previous).then(() => true, (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') return false;
            throw err;
        });
        try {
            await rename(staging, outDir);
        } catch (err) {
            if (hadPrevious) await rename(previous, outDir);
            throw err;
        }
        await rm(previous, {recursive: true, force: true});
    } finally {
        await rm(staging, {recursive: true, force: true});
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
