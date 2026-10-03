/**
 * The calendar's day counts, one file per Pacific month, from the read-path
 * build's occurrences, build.occurrences (decision 056; decision 061).
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
 *
 * Beside it, $EXPORT_DIR/calendar/<YYYY-MM>.native.json counts, in the same
 * shape, only the sightings contributors saved here (decision 061's overlay): a
 * signed-in tab subtracts them and adds what Supabase says now, so a sighting
 * saved since the build has its circle and an edited one isn't counted twice. A
 * native sighting is one with a contributor; no upstream source has one. A month
 * with none has no native file.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import * as path from 'node:path';

import { REGIONS } from '../../src/constants.ts';
import { budget } from './duckdb-budget.ts';
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
    const nativeMonths = new Map<string, MonthCounts>();
    try {
        // Measured on 63,762 occurrences: runs out at 32 MB, completes at 64; uncapped it
        // peaked at 275 MB, and at 96 MB it peaks at 239.
        await budget(conn, snapshot, '96MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run(`
            CREATE TEMP TABLE located AS
            SELECT strftime(timezone('${DAY_ZONE}', observed_at), '%Y-%m-%d') AS day,
                   json_extract(doc, '$.location.lon')::DOUBLE AS lon,
                   json_extract(doc, '$.location.lat')::DOUBLE AS lat,
                   json_extract_string(doc, '$.contributor_id') IS NOT NULL AS native
            FROM store.build.occurrences
        `);
        for (const region of REGIONS) {
            const [minLon, minLat, maxLon, maxLat] = region.extent ?? WORLD;
            const reader = await conn.runAndReadAll(`
                SELECT day, count(*)::INTEGER, count(*) FILTER (native)::INTEGER
                FROM located
                WHERE lon BETWEEN ${minLon} AND ${maxLon} AND lat BETWEEN ${minLat} AND ${maxLat}
                GROUP BY day
                ORDER BY day
            `);
            for (const [day, count, native] of reader.getRows() as [string, number, number][]) {
                tally(months, region.slug, day, count);
                if (native > 0) tally(nativeMonths, region.slug, day, native);
            }
        }
    } finally {
        conn.closeSync();
    }

    await replaceDir(outDir, [
        ...[...months].map(([month, counts]) => [`${month}.json`, JSON.stringify(counts)] as [string, string]),
        ...[...nativeMonths].map(([month, counts]) => [`${month}.native.json`, JSON.stringify(counts)] as [string, string]),
    ]);
    return {months: months.size};
}

function tally(months: Map<string, MonthCounts>, region: string, day: string, count: number): void {
    const month = day.slice(0, 7);
    let counts = months.get(month);
    if (!counts) months.set(month, counts = {});
    (counts[region] ??= {})[day] = count;
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

if (import.meta.main) {
    await main();
}
