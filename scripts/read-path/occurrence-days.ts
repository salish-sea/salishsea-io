/**
 * One file per Pacific calendar day of occurrences, from the occurrences the build
 * derives into the snapshot file, build.occurrences (salish-t3g.1; decision 061).
 *
 *   EXPORT_DIR=… node scripts/read-path/occurrence-days.ts <snapshot.duckdb>
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
 * order), and each document is re-serialized compactly from its JSON text, whose
 * key order the derivation fixes as Postgres's to_jsonb did.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import * as path from 'node:path';

import { budget } from './duckdb-budget.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';

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
    await recoverDir(outDir);

    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    const counts = {files: 0, occurrences: 0};
    try {
        // Measured on 63,762 occurrences: runs out at 64 MB; at 128 the process peaks at
        // ~380 MB on macOS (366 on Fly uncapped). Most of that is outside DuckDB's budget,
        // in node-api holding the sorted result: the same query peaks at 152 MB in the
        // DuckDB CLI. Assembling each day's file in DuckDB instead (string_agg) was
        // byte-identical but peaked at 854 MB, so the cap is what's taken here.
        await budget(conn, snapshot, '128MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        // Streamed, a chunk of rows at a time, in day order: each day's file is
        // finished and written before the next day's rows are read. Reading every
        // row at once held the whole table three times over (DuckDB's result,
        // its JS copy, the parsed documents) and took the 1 GB Fly machine down.
        const result = await conn.stream(`
            SELECT strftime(timezone('${DAY_ZONE}', observed_at), '%Y-%m-%d') AS day, doc
            FROM store.build.occurrences
            ORDER BY day, observed_at DESC, id
        `);
        await replaceDir(outDir, dayFiles(result.yieldRows() as AsyncIterable<[string, string][]>, counts));
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    return counts;
}

/** Rows in day order, as one file per day: each emitted once its day's rows have all arrived. */
export async function* dayFiles(
    chunks: AsyncIterable<[string, string][]>,
    counts = {files: 0, occurrences: 0},
): AsyncGenerator<[string, string]> {
    let day: string | null = null;
    let list: unknown[] = [];
    for await (const rows of chunks) {
        for (const [rowDay, doc] of rows) {
            if (rowDay !== day) {
                if (day !== null) {
                    counts.files++;
                    yield [`${day}.json`, JSON.stringify(list)];
                }
                day = rowDay;
                list = [];
            }
            list.push(JSON.parse(doc));
            counts.occurrences++;
        }
    }
    if (day !== null) {
        counts.files++;
        yield [`${day}.json`, JSON.stringify(list)];
    }
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
if (import.meta.main) {
    await main();
}
