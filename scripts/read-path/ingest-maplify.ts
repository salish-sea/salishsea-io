/**
 * Maplify's sightings, ingested by the read-path build itself (decision 061,
 * salish-xv35.7): the second source to stop depending on Postgres for what it says.
 *
 *   node scripts/read-path/ingest-maplify.ts <maplify.sqlite> [<start> <end>]
 *
 * Fetches windows with the same shell and pure core the Supabase function uses
 * (scripts/ingest/fetch-maplify.ts, scripts/ingest/maplify.ts), and reconciles each into
 * a SQLite mirror: every sighting fetched is written, and every sighting the mirror holds
 * in the window that the fetch didn't return is deleted. Given a curator's start and end
 * (both inclusive 'YYYY-MM-DD'), that one window. Otherwise two (salish-xv35.15):
 *
 *   - the thirty days ending today. Postgres's ingest fetches ten, and a sighting Maplify
 *     publishes after its date has left that window never arrives at all: 66 such, dated
 *     October 2025 to May 2026, were missing from Postgres on 2026-10-02.
 *   - one older calendar month, for anti-entropy: Maplify also edits, deletes and
 *     re-sources sightings long after their date, and only a fetch of that month again
 *     finds out. Chosen at random, weighted toward recent months as BeeAtlas's
 *     anti_entropy_pipeline.py weights its sample (a month a year old is half as likely
 *     as this one), so across builds every month the mirror covers is revisited.
 *
 * The mirror holds what Maplify said and nothing else (decision 008, as 061 applies it).
 * So unlike Postgres's ingest it keeps every sighting in the fetch box, in scope or not:
 * whether one belongs on the map (isIngestable) depends on the register, and a register
 * edition is the derivation's input, not the mirror's (Peter, 2026-10-02). Unfiltered,
 * Maplify returns about twice what is in scope, ~1,100 sightings a month. Nor does it
 * hold the entity and collection Postgres resolves (salish-xv35.11).
 *
 * Decision 011's rule holds: a fetch that doesn't parse whole throws, and nothing is
 * written. The window's reconcile is one SQLite transaction. The days a fetch covered
 * are recorded in `covered_days`, so a comparison or a backfill can say which days the
 * mirror speaks for. A backfill is this script over past windows, a month at a time.
 *
 * Under Stelis it also writes the boundary receipt (STELIS_BOUNDARY_RECEIPT), saying
 * whether the window changed anything.
 */

import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { fetchMaplify } from '../ingest/fetch-maplify.ts';
import { parseMaplifyResponse, reconcile, type NormalizedSighting } from '../ingest/maplify.ts';
import type { IngestWindow } from '../ingest/persist.ts';
import { defaultWindow } from '../ingest/window.ts';
import { addDays, antiEntropyWindow, curatorWindow, firstCoveredDay, windowDays } from './windows.ts';
import { boundaryReceipt, recordedRun } from './ingest-runs.ts';

/** How many days the regular fetch reaches back (salish-xv35.15, Peter 2026-10-02). */
export const REGULAR_DAYS = 30;

/** A sighting as the mirror stores it: Maplify's fields, normalized as the core does. */
export type MirrorRow = {
    id: number, project_id: number, trip_id: number, name: string | null, scientific_name: string,
    lon: number, lat: number, number_sighted: number, created_at: string, photo_url: string | null,
    comments: string | null, in_ocean: number, moderated: number, trusted: number, is_test: number,
    source: string, usernm: string | null,
};

const COLUMNS = [
    'id', 'project_id', 'trip_id', 'name', 'scientific_name', 'lon', 'lat', 'number_sighted',
    'created_at', 'photo_url', 'comments', 'in_ocean', 'moderated', 'trusted', 'is_test', 'source',
    'usernm',
] as const;

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS sightings (
        id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, trip_id INTEGER NOT NULL,
        name TEXT, scientific_name TEXT NOT NULL, lon REAL NOT NULL, lat REAL NOT NULL,
        number_sighted INTEGER NOT NULL, created_at TEXT NOT NULL, photo_url TEXT, comments TEXT,
        in_ocean INTEGER NOT NULL, moderated INTEGER NOT NULL, trusted INTEGER NOT NULL,
        is_test INTEGER NOT NULL, source TEXT NOT NULL, usernm TEXT
    );
    CREATE INDEX IF NOT EXISTS sightings_created_at ON sightings (created_at);
    CREATE TABLE IF NOT EXISTS covered_days (day TEXT PRIMARY KEY);`;

/** The row the mirror stores for a normalized sighting. SQLite has no boolean. */
export function mirrorRow(s: NormalizedSighting): MirrorRow {
    return {
        id: s.id, project_id: s.projectId, trip_id: s.tripId, name: s.name,
        scientific_name: s.scientificName, lon: s.lon, lat: s.lat, number_sighted: s.numberSighted,
        created_at: s.createdAt, photo_url: s.photoUrl, comments: s.comments,
        in_ocean: Number(s.inOcean), moderated: s.moderated, trusted: Number(s.trusted),
        is_test: Number(s.isTest), source: s.source, usernm: s.usernm,
    };
}

export type ReconcileResult = {upserted: number, deleted: number, changed: number};

/**
 * Reconcile one window's complete fetch into the mirror at `path`, creating it if need be.
 * The window is created_at ∈ [start, end + 1 day), as Postgres's fetchWindowIds bounds it;
 * Maplify's timestamps are 'YYYY-MM-DD HH:MM:SS', which compare as text the way they do as
 * times. `changed` counts sightings added, altered or deleted; a window that changed
 * nothing and whose days were already covered writes nothing.
 */
export function reconcileWindow(path: string, window: IngestWindow, fetched: readonly NormalizedSighting[]): ReconcileResult {
    mkdirSync(dirname(path), {recursive: true});
    const db = new DatabaseSync(path);
    try {
        db.exec(SCHEMA);
        const stored = new Map(
            (db.prepare('SELECT * FROM sightings WHERE created_at >= ? AND created_at < ?')
                .all(window.start, addDays(window.end, 1)) as unknown as MirrorRow[])
                .map(r => [r.id, JSON.stringify(COLUMNS.map(c => r[c]))]));
        const plan = reconcile(fetched, [...stored.keys()]);
        const rows = plan.upsert.map(mirrorRow);
        const altered = rows.filter(r => stored.get(r.id) !== JSON.stringify(COLUMNS.map(c => r[c])));
        const days = windowDays(window);
        const covered = (db.prepare(`SELECT count(*) AS n FROM covered_days WHERE day >= ? AND day <= ?`)
            .get(window.start, window.end) as {n: number}).n;
        const changed = altered.length + plan.delete.length;
        if (changed === 0 && covered === days.length)
            return {upserted: rows.length, deleted: 0, changed: 0};
        db.exec('BEGIN');
        try {
            const upsert = db.prepare(
                `INSERT OR REPLACE INTO sightings (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`);
            for (const r of altered) upsert.run(...COLUMNS.map(c => r[c]));
            const remove = db.prepare('DELETE FROM sightings WHERE id = ?');
            for (const id of plan.delete) remove.run(id);
            const cover = db.prepare('INSERT OR IGNORE INTO covered_days (day) VALUES (?)');
            for (const day of days) cover.run(day);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        return {upserted: rows.length, deleted: plan.delete.length, changed};
    } finally {
        db.close();
    }
}

export async function main(): Promise<void> {
    const [path, start, end] = process.argv.slice(2);
    if (!path || (start === undefined) !== (end === undefined)) {
        console.error('usage: ingest-maplify.ts <maplify.sqlite> [<start> <end>]');
        process.exit(2);
    }
    let windows: IngestWindow[];
    if (start !== undefined && end !== undefined) {
        const window = curatorWindow(start, end);
        if (!window) {
            console.error(`not a window: ${start}..${end} (two days, 'YYYY-MM-DD', start first)`);
            process.exit(2);
        }
        windows = [window];
    } else {
        const now = new Date();
        const regular = defaultWindow(now, REGULAR_DAYS);
        const earliest = firstCoveredDay(path);
        const older = earliest === null ? null : antiEntropyWindow(earliest, regular.start, now, Math.random());
        windows = older ? [regular, older] : [regular];
    }
    const log = (msg: string, extra?: Record<string, unknown>) =>
        console.log(extra ? `${msg} ${JSON.stringify(extra)}` : msg);
    const trigger = start !== undefined ? 'manual' : 'cron';
    // Counted as windows land, so a failure after one still reports what it changed.
    let changedInAll = 0;
    const run = await recordedRun(path, 'maplify', trigger, async () => {
        for (const window of windows) {
            const result = parseMaplifyResponse(await fetchMaplify(window, log));
            if (!result.ok) throw new Error(`maplify parse failed: ${result.error}`);
            const {upserted, deleted, changed} = reconcileWindow(path, window, result.sightings);
            changedInAll += changed;
            console.log(`maplify ${window.start}..${window.end}: ${result.sightings.length} sightings fetched; `
                + `${changed === 0 ? 'unchanged' : `${changed} changed (${deleted} deleted)`}; ${upserted} in the window`);
        }
        return changedInAll;
    });
    // A source that can't be reached leaves the mirror as it was, and the build goes on
    // with it (ingest-runs.ts); a backfill run by hand fails loudly instead.
    if (!run.ok) {
        console.error(`maplify: fetch failed; the mirror keeps its last good copy: ${String(run.error)}`);
        if (trigger === 'manual') throw run.error;
    }
    const receipt = process.env['STELIS_BOUNDARY_RECEIPT'];
    // `since` is where the fetch reached back to, the anti-entropy month when there is one.
    const since = windows.map(w => w.start).sort()[0]!;
    if (receipt) await writeFile(receipt, boundaryReceipt(run, since));
}

if (import.meta.main) {
    await main();
}
