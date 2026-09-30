/**
 * The calendar's day counts, one file per Pacific month, from the read-path
 * snapshot (decision 056).
 *
 *   EXPORT_DIR=… node scripts/read-path/calendar.ts <snapshot.duckdb>
 *
 * Writes $EXPORT_DIR/calendar/<YYYY-MM>.json:
 *
 *   {"puget-sound": {"2026-09-04": 31, …}, "salish-sea": {…}, …, "everywhere": {…}}
 *
 * What the calendar's `occurrence_days` call returns today, for every region at
 * once: a day's count of occurrences inside the region's box. The same rules, so
 * the circles don't change size when the source does:
 *   - a day is a Pacific day (PST8PDT)
 *   - the box is inclusive on every side
 *   - a row without a location is not counted, not even for "Everywhere", whose
 *     function bounds are the whole world and so exclude only a missing one.
 * The boxes are the map's own, imported from src/constants.ts, so a region can't
 * be redrawn in one place and not the other.
 *
 * A month with no occurrences in any region has no file; a day with none in a
 * region is absent from that region's map. Months, not days, because the
 * calendar draws six weeks at a time: at most three files per view, and a new
 * sighting today rewrites only this month's.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import * as path from 'node:path';

import { REGIONS } from '../../src/constants.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';

/** occurrence_days' own day. */
const DAY_ZONE = 'PST8PDT';

/** occurrence_days' bounds when a region has none: the whole world. */
const WORLD = [-180, -90, 180, 90] as const;

export type MonthCounts = Record<string, Record<string, number>>;

export async function writeCalendar(snapshot: string, exportDir: string): Promise<{months: number}> {
    const outDir = path.join(exportDir, 'calendar');
    await recoverDir(outDir);

    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    const months = new Map<string, MonthCounts>();
    try {
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run(`
            CREATE TEMP TABLE located AS
            SELECT strftime(timezone('${DAY_ZONE}', observed_at), '%Y-%m-%d') AS day,
                   json_extract(doc, '$.location.lon')::DOUBLE AS lon,
                   json_extract(doc, '$.location.lat')::DOUBLE AS lat
            FROM store.snapshot.occurrences
        `);
        for (const region of REGIONS) {
            const [minLon, minLat, maxLon, maxLat] = region.extent ?? WORLD;
            const reader = await conn.runAndReadAll(`
                SELECT day, count(*)::INTEGER
                FROM located
                WHERE lon BETWEEN ${minLon} AND ${maxLon} AND lat BETWEEN ${minLat} AND ${maxLat}
                GROUP BY day
                ORDER BY day
            `);
            for (const [day, count] of reader.getRows() as [string, number][]) {
                const month = day.slice(0, 7);
                let counts = months.get(month);
                if (!counts) months.set(month, counts = {});
                (counts[region.slug] ??= {})[day] = count;
            }
        }
    } finally {
        conn.closeSync();
    }

    await replaceDir(outDir,
        [...months].map(([month, counts]) => [`${month}.json`, JSON.stringify(counts)] as [string, string]));
    return {months: months.size};
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !exportDir) {
        console.error('usage: EXPORT_DIR=… calendar.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const {months} = await writeCalendar(snapshot, exportDir);
    console.log(`calendar/: ${months} month files`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
