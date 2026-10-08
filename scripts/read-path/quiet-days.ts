/**
 * An empty day file for each recent day with no occurrences (salish-518u).
 *
 *   EXPORT_DIR=… node scripts/read-path/quiet-days.ts <snapshot.duckdb>
 *
 * Writes $EXPORT_DIR/quiet-days/<YYYY-MM-DD>.json, each `[]`, for every day of the
 * WINDOW_DAYS ending on the day the snapshot covers through (the manifest's
 * covered_through) that has no occurrence. The Fly app serves one of these at
 * /read-path/days/<date>.json when days/ has no file for that date (fly/Caddyfile).
 *
 * The client already reads a missing covered day as empty (src/read-path.ts), so this
 * changes no answer. It removes the 404 every visitor's browser logs as an error on a
 * quiet morning, which also failed the production smoke test on any deploy before the
 * day's first sighting.
 *
 * Not in days/ itself: Stelis keys that directory on the occurrences by day and holds
 * its files to exactly those keys. And only recent days: the day files reach back to
 * 1978, and an empty file for every quiet day since would be some 13,000 files, nearly
 * all for decades nobody browses. An older quiet day still 404s, and still reads as empty.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import * as path from 'node:path';

import { budget } from './duckdb-budget.ts';
import { dayOf } from './pacific-day.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';

/** How many days, ending on the covered day, get an empty file when they have nothing. */
export const WINDOW_DAYS = 30;

/** Write the empty files for `snapshot` under `exportDir/quiet-days`, replacing the directory. */
export async function writeQuietDays(snapshot: string, exportDir: string): Promise<string[]> {
    const outDir = path.join(exportDir, 'quiet-days');
    await recoverDir(outDir);
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let days: string[];
    try {
        // Reads one day's worth of a column; the cap is the scripts' smallest.
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        const metaRows = await conn.runAndReadAll('SELECT count(*) FROM store.snapshot.meta');
        const [[metaCount]] = metaRows.getRows() as [[bigint]];
        if (metaCount !== 1n) throw new Error(`snapshot.meta: expected one row, found ${metaCount}`);
        const reader = await conn.runAndReadAll(`
            WITH through AS (
                SELECT CAST(${dayOf('taken_at')} AS DATE) AS day FROM store.snapshot.meta
            ),
            recent AS (
                SELECT strftime(CAST(d.generate_series AS DATE), '%Y-%m-%d') AS day
                FROM through,
                     generate_series(through.day - INTERVAL ${WINDOW_DAYS - 1} DAY, through.day, INTERVAL 1 DAY) d
            )
            SELECT day FROM recent
            WHERE day NOT IN (
                SELECT ${dayOf('observed_at')} FROM store.build.occurrences
                WHERE observed_at IS NOT NULL
            )
            ORDER BY day
        `);
        days = (reader.getRows() as [string][]).map(([day]) => day);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    await replaceDir(outDir, days.map(day => [`${day}.json`, '[]'] as [string, string]));
    return days;
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !exportDir) {
        console.error('usage: EXPORT_DIR=… quiet-days.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const days = await writeQuietDays(snapshot, exportDir);
    console.log(`quiet-days/: ${days.length} of the last ${WINDOW_DAYS} days have no occurrences${days.length ? ` (${days.join(', ')})` : ''}`);
}

if (import.meta.main) {
    await main();
}
