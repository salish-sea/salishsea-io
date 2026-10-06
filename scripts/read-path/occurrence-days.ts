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
 * Or only some days (Stelis ADR 0016, salish-9uu.8.2): the build observes the
 * occurrences by Pacific day, and when it knows which days moved since the last build
 * it names them in STELIS_REBUILD_KEYS (newline-separated), one file each to rewrite in
 * place, atomically, the rest of the directory untouched; a named day with no rows left
 * loses its file. Days that emptied are the build's to prune (it knows the removed
 * keys; this is told only what to write). A save touches one day, and this is how the
 * build stops rewriting 4,400 files for it. Without the variable, the whole directory
 * as before. The grouping here and the build's key expression are the same by hand
 * (pacific-day.ts's dayOf), and the build checks the directory's files against its keys.
 *
 * Deterministic by construction: rows are ordered by observed_at and then id
 * (PostgREST orders by observed_at alone, so ties there fall in no particular
 * order), and each document is re-serialized compactly from its JSON text, whose
 * key order the derivation fixes as Postgres's to_jsonb did.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import * as path from 'node:path';

import { access, readdir, rename, rm, writeFile } from 'node:fs/promises';

import { budget } from './duckdb-budget.ts';
import { dayOf } from './pacific-day.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';

const exists = (p: string) => access(p).then(() => true, () => false);

const DAY_EXPR = dayOf('observed_at');
const A_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The days the build asks to have rewritten, newline-separated in STELIS_REBUILD_KEYS;
 * null when it says nothing, which means every day. A key that is not a date — an
 * empty one included, which is what the build makes of a NULL observed_at, a row no
 * day file holds (dayFiles) — is a disagreement between the two groupings, refused
 * rather than interpolated or dropped.
 */
export function rebuildKeys(env: NodeJS.ProcessEnv): string[] | null {
    const raw = env['STELIS_REBUILD_KEYS'];
    if (raw === undefined) return null;
    const keys = raw === '' ? [] : raw.replace(/\n$/, '').split('\n');
    for (const key of keys) if (!A_DAY.test(key)) throw new Error(`STELIS_REBUILD_KEYS names a day that is not a date: ${JSON.stringify(key)}`);
    return keys;
}

/**
 * Past this many named days, a partial run costs more than the swap — one query and
 * two renames per file against one pass and two renames — and readers see a mixed
 * directory for longer. Whether a run is partial at all is the build's decision (it
 * has a basis or it has not); this is only how a partial run told "most of them"
 * chooses to do the work. The build's prune and identity check are the same either way.
 */
export const PARTIAL_LIMIT = 500;

/**
 * Write the day files for `snapshot` under `exportDir/days`: every day, replacing the
 * directory whole (`keys` null), or only `keys` (the days the build says moved), each
 * file rewritten in place and the rest untouched. Returns what it wrote, and how.
 */
export async function writeDays(
    snapshot: string,
    exportDir: string,
    keys: readonly string[] | null,
): Promise<{files: number, occurrences: number, mode: 'all' | 'some'}> {
    const outDir = path.join(exportDir, 'days');
    await recoverDir(outDir);
    // a partial run rewrites files in a directory the last run left; with none to
    // rewrite into (a fresh export dir, a hand run), it is a full run
    if (keys !== null && keys.length <= PARTIAL_LIMIT && await exists(outDir))
        return {...await writeSomeDays(snapshot, outDir, keys), mode: 'some'};

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
            SELECT ${DAY_EXPR} AS day, doc
            FROM store.build.occurrences
            ORDER BY day, observed_at DESC, id
        `);
        await replaceDir(outDir, dayFiles(result.yieldRows() as AsyncIterable<[string, string][]>, counts));
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    return {...counts, mode: 'all'};
}

/**
 * The named days only, each file written beside itself and renamed into place, so a
 * reader — the Fly app serves this directory — sees the old file or the new one. A day
 * named but empty loses its file: its rows went while the build was deciding, and a
 * file for a day with no occurrences is what the whole-directory run never leaves.
 */
async function writeSomeDays(
    snapshot: string, outDir: string, keys: readonly string[],
): Promise<{files: number, occurrences: number}> {
    const counts = {files: 0, occurrences: 0};
    // a run killed between writing a file beside itself and renaming it leaves the
    // `.partial` where the app would serve it; swept before and after. So is what a
    // full run killed mid-swap leaves beside the directory (replace-dir.ts's staging and
    // previous), which only a full run would otherwise clear.
    const sweep = async () => {
        for (const name of await readdir(outDir))
            if (name.endsWith('.partial')) await rm(path.join(outDir, name), {force: true});
        for (const beside of ['staging', 'previous']) await rm(`${outDir}.${beside}`, {recursive: true, force: true});
    };
    await sweep();
    if (keys.length === 0) return counts;
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '128MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        const result = await conn.stream(`
            SELECT ${DAY_EXPR} AS day, doc
            FROM store.build.occurrences
            WHERE ${DAY_EXPR} IN (${keys.map(k => `'${k}'`).join(', ')})
            ORDER BY day, observed_at DESC, id
        `);
        const written = new Set<string>();
        for await (const [name, body] of dayFiles(result.yieldRows() as AsyncIterable<[string, string][]>, counts)) {
            const final = path.join(outDir, name);
            const partial = `${final}.partial`;
            await writeFile(partial, body);
            await rename(partial, final);
            written.add(name);
        }
        for (const key of keys)
            if (!written.has(`${key}.json`)) await rm(path.join(outDir, `${key}.json`), {force: true});
    } finally {
        conn.closeSync();
        db.closeSync();
        await sweep();
    }
    return counts;
}

/**
 * Rows in day order, as one file per day: each emitted once its day's rows have all
 * arrived. A row with no day (a NULL observed_at: DuckDB orders those last) is on no
 * day's file and is left out, uncounted — before this it was counted and then lost to
 * the day sentinel.
 */
export async function* dayFiles(
    chunks: AsyncIterable<[string | null, string][]>,
    counts = {files: 0, occurrences: 0},
): AsyncGenerator<[string, string]> {
    let day: string | null = null;
    let list: unknown[] = [];
    for await (const rows of chunks) {
        for (const [rowDay, doc] of rows) {
            if (rowDay === null) continue;
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
    const keys = rebuildKeys(process.env);
    const {files, occurrences, mode} = await writeDays(snapshot, exportDir, keys);
    console.log(mode === 'all'
        ? `days/: ${files} files, ${occurrences} occurrences${keys === null ? '' : ` (told ${keys.length} days, past the partial limit: replaced whole)`}`
        : `days/: ${files} of ${keys!.length} named day(s) rewritten in place, ${occurrences} occurrences; the rest as they were`);
}

// Only when run as a script, so the test can import writeDays.
if (import.meta.main) {
    await main();
}
