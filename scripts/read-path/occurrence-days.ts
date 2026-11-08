/**
 * One file per Pacific calendar day of occurrences, from the occurrences the build
 * derives into the snapshot file, build.occurrences (salish-t3g.1; decision 061).
 *
 *   EXPORT_DIR=… node scripts/read-path/occurrence-days.ts <snapshot.duckdb> [--water-mask <png> <json>]
 *
 * Writes $EXPORT_DIR/days/<YYYY-MM-DD>.json for every day that has at least one
 * occurrence: a JSON array, newest first — what `fetchOccurrences` receives for
 * that day with no region selected. The region is left to the browser, so the
 * seven regions don't multiply the files.
 *
 * A day with no occurrences has no file here (a recent one has an empty file in
 * quiet-days/, quiet-days.ts). The directory is replaced whole each
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
 * Each occurrence carries `segment`, the travel segment the build put it in (decision
 * 111): the id of the segment's oldest occurrence, from the day's rows as the file lists
 * them (src/segments.ts's segmentIds), measuring distance by sea on the basemap's water
 * mask when told where it is (salish-20u7.3; the build always does, and encounters.ts is
 * given the same mask so the two join a day alike). The browser groups by it rather than joining the
 * day again. Editing this script or what it imports (the join rule included) changes the
 * task's address, so the first build after a change rewrites every file.
 *
 * Deterministic by construction: rows are ordered by observed_at and then id
 * (PostgREST ordered by observed_at alone, so ties there fell in no particular
 * order), and each document is re-serialized compactly from its JSON text, whose
 * key order the derivation fixes as Postgres's to_jsonb did.
 */

import * as path from 'node:path';

import { access, readdir, rename, rm, writeFile } from 'node:fs/promises';

import type { Occurrence } from '../../src/types.ts';
import { occurrences2segments, type DistanceM } from '../../src/segments.ts';
import type { LegOf } from '../../src/sea-distance.ts';
import { withSnapshot } from './duckdb-budget.ts';
import { dayOf } from './pacific-day.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';
import { waterMaskArgs } from './water-mask.ts';

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
    distanceM?: DistanceM,
    legOf?: LegOf,
): Promise<{files: number, occurrences: number, mode: 'all' | 'some'}> {
    const outDir = path.join(exportDir, 'days');
    await recoverDir(outDir);
    // a partial run rewrites files in a directory the last run left; with none to
    // rewrite into (a fresh export dir, a hand run), it is a full run
    if (keys !== null && keys.length <= PARTIAL_LIMIT && await exists(outDir))
        return {...await writeSomeDays(snapshot, outDir, keys, distanceM, legOf), mode: 'some'};

    const counts = {files: 0, occurrences: 0};
    // Measured on 63,762 occurrences: runs out at 64 MB; at 128 the process peaks at
    // ~380 MB on macOS (366 on Fly uncapped). Most of that is outside DuckDB's budget,
    // in node-api holding the sorted result: the same query peaks at 152 MB in the
    // DuckDB CLI. Assembling each day's file in DuckDB instead (string_agg) was
    // byte-identical but peaked at 854 MB, so the cap is what's taken here.
    await withSnapshot(snapshot, {memory: '128MB'}, async conn => {
        // Streamed, a chunk of rows at a time, in day order: each day's file is
        // finished and written before the next day's rows are read. Reading every
        // row at once held the whole table three times over (DuckDB's result,
        // its JS copy, the parsed documents) and took the 1 GB Fly machine down.
        const result = await conn.stream(`
            SELECT ${DAY_EXPR} AS day, doc
            FROM store.build.occurrences
            ORDER BY day, observed_at DESC, id
        `);
        await replaceDir(outDir, dayFiles(result.yieldRows() as AsyncIterable<[string, string][]>, counts, distanceM, legOf));
    });
    return {...counts, mode: 'all'};
}

/**
 * The named days only, each file written beside itself and renamed into place, so a
 * reader — the Fly app serves this directory — sees the old file or the new one. A day
 * named but empty loses its file: its rows went while the build was deciding, and a
 * file for a day with no occurrences is what the whole-directory run never leaves.
 */
async function writeSomeDays(
    snapshot: string, outDir: string, keys: readonly string[], distanceM?: DistanceM, legOf?: LegOf,
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
    try {
        await withSnapshot(snapshot, {memory: '128MB'}, async conn => {
            const result = await conn.stream(`
                SELECT ${DAY_EXPR} AS day, doc
                FROM store.build.occurrences
                WHERE ${DAY_EXPR} IN (${keys.map(k => `'${k}'`).join(', ')})
                ORDER BY day, observed_at DESC, id
            `);
            const written = new Set<string>();
            for await (const [name, body] of dayFiles(result.yieldRows() as AsyncIterable<[string, string][]>, counts, distanceM, legOf)) {
                const final = path.join(outDir, name);
                const partial = `${final}.partial`;
                await writeFile(partial, body);
                await rename(partial, final);
                written.add(name);
            }
            for (const key of keys)
                if (!written.has(`${key}.json`)) await rm(path.join(outDir, `${key}.json`), {force: true});
        });
    } finally {
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
    distanceM?: DistanceM,
    legOf?: LegOf,
): AsyncGenerator<[string, string]> {
    let day: string | null = null;
    let list: Record<string, unknown>[] = [];
    for await (const rows of chunks) {
        for (const [rowDay, doc] of rows) {
            if (rowDay === null) continue;
            if (rowDay !== day) {
                if (day !== null) {
                    counts.files++;
                    yield [`${day}.json`, JSON.stringify(withSegments(list, distanceM, legOf))];
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
        yield [`${day}.json`, JSON.stringify(withSegments(list, distanceM, legOf))];
    }
}

/**
 * A day's documents, in the order the file lists them, each with its `segment` last, and
 * after it, on a report that the straight line from the segment's previous report does not
 * reach across water, its `leg`: the route by sea between the two (decision 113; `legOf`,
 * given only when the build has the water mask). The join reads `observed_at_ms`, which the
 * browser adds on reading a file; it is added here for the join only and not written.
 */
export function withSegments(list: Record<string, unknown>[], distanceM?: DistanceM, legOf?: LegOf): Record<string, unknown>[] {
    const segments = occurrences2segments(list.map(doc => ({...doc, observed_at_ms: Date.parse(doc['observed_at'] as string)}) as unknown as Occurrence), distanceM);
    const ids = new Map<string, string>();
    const legs = new Map<string, [number, number][]>();
    for (const {occurrences} of segments) {
        occurrences.forEach((report, i) => {
            ids.set(report.id, occurrences[0]!.id);
            // the segment's reports are already in time order, the order the join took them
            const leg = i > 0 && legOf ? legOf(coord(occurrences[i - 1]!), coord(report)) : null;
            if (leg) legs.set(report.id, leg);
        });
    }
    return list.map(doc => {
        const id = doc['id'] as string;
        return legs.has(id) ? {...doc, segment: ids.get(id), leg: legs.get(id)} : {...doc, segment: ids.get(id)};
    });
}

const coord = ({location: {lon, lat}}: Occurrence): [number, number] => [lon!, lat!];

export async function main(): Promise<void> {
    const {rest: [snapshot, ...extra], distanceM, legOf} = waterMaskArgs(process.argv.slice(2));
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || extra.length || !exportDir) {
        console.error('usage: EXPORT_DIR=… occurrence-days.ts <snapshot.duckdb> [--water-mask <png> <json>]');
        process.exit(2);
    }
    const keys = rebuildKeys(process.env);
    const {files, occurrences, mode} = await writeDays(snapshot, exportDir, keys, distanceM, legOf);
    console.log(mode === 'all'
        ? `days/: ${files} files, ${occurrences} occurrences${keys === null ? '' : ` (told ${keys.length} days, past the partial limit: replaced whole)`}`
        : `days/: ${files} of ${keys!.length} named day(s) rewritten in place, ${occurrences} occurrences; the rest as they were`);
}

// Only when run as a script, so the test can import writeDays.
if (import.meta.main) {
    await main();
}
