/**
 * Orcasound's detections, ingested by the read-path build itself (salish-fizm.1,
 * decision 122), beside the bouts.
 *
 *   node scripts/read-path/ingest-orcasound-detections.ts <orcasound-detections.sqlite> [<start> <end>]
 *
 * Fetches windows of orcasite's `/api/json/detections` with the shell and pure core in
 * scripts/ingest/ (fetch-orcasound-detections.ts, orcasound-detections.ts), and reconciles
 * each into a SQLite mirror as Maplify's are (ingest-maplify.ts): every detection fetched
 * is written, and every detection the mirror holds in the window that the fetch didn't
 * return is deleted. Given a curator's start and end (both inclusive 'YYYY-MM-DD'), that
 * one window. Otherwise two:
 *
 *   - the last 14 days, UTC, every run;
 *   - one older calendar month, for anti-entropy, chosen at random and weighted toward
 *     recent months (windows.ts).
 *
 * What makes a delete safe is stronger than Maplify's: orcasite counts what matches, and a
 * window is applied only when the fetch holds exactly that many detections
 * (fetch-orcasound-detections.ts). Maplify's floor on deletions stays on top of it.
 *
 * The mirror holds what orcasite said, in every category, hidden or not; which detections
 * are occurrences is the derivation's (derive/detections.sql). It leaves out orcasite's
 * `description` and `source_ip`: not requested, never stored. The feeds the detections
 * name are kept with their position, and never deleted. The days a fetch covered are
 * recorded in `covered_days`. A backfill is this script over past windows, a month at a time.
 *
 * Under Stelis it also writes the boundary receipt (STELIS_BOUNDARY_RECEIPT).
 */

import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { cutoff, fetchDetectionsWindow, windowEnd, type DetectionsWindow, type DetectionsWindowBounds } from '../ingest/fetch-orcasound-detections.ts';
import { reconcile, type NormalizedDetection } from '../ingest/orcasound-detections.ts';
import { defaultWindow } from '../ingest/window.ts';
import { boundaryReceipt, recordedRun } from './ingest-runs.ts';
import { DELETE_FLOOR_MIN_STORED, DELETE_FLOOR_SHARE, type ReconcileOptions, type ReconcileResult } from './ingest-maplify.ts';
import { addDays, antiEntropyWindow, curatorWindow, firstCoveredDay, windowDays } from './windows.ts';

/** How many days the regular fetch reaches back. */
export const REGULAR_DAYS = 14;

/** A detection as the mirror stores it. SQLite has no boolean. */
export type MirrorRow = {
    id: string, feed_id: string, timestamp: string, source: string, category: string | null,
    listener_count: number | null, visible: number, orcahello_id: string | null, candidate_id: string | null,
};

const COLUMNS = [
    'id', 'feed_id', 'timestamp', 'source', 'category', 'listener_count', 'visible', 'orcahello_id', 'candidate_id',
] as const;

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS detections (
        id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, timestamp TEXT NOT NULL, source TEXT NOT NULL,
        category TEXT, listener_count INTEGER, visible INTEGER NOT NULL, orcahello_id TEXT, candidate_id TEXT
    );
    CREATE INDEX IF NOT EXISTS detections_timestamp ON detections (timestamp);
    CREATE TABLE IF NOT EXISTS feeds (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, lon REAL NOT NULL, lat REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS covered_days (day TEXT PRIMARY KEY);`;

/**
 * Create the mirror's tables if it has none, so a derivation that attaches the file finds
 * them even when every fetch so far has failed.
 */
export function ensureMirror(path: string): void {
    mkdirSync(dirname(path), {recursive: true});
    const db = new DatabaseSync(path);
    try {
        db.exec('PRAGMA journal_mode = WAL');
        db.exec(SCHEMA);
    } finally {
        db.close();
    }
}

/** The row the mirror stores for a normalized detection. */
export function mirrorRow(d: NormalizedDetection): MirrorRow {
    return {
        id: d.id, feed_id: d.feedId, timestamp: d.timestamp, source: d.source, category: d.category,
        listener_count: d.listenerCount, visible: Number(d.visible), orcahello_id: d.orcahelloId, candidate_id: d.candidateId,
    };
}

/**
 * Reconcile one window's complete fetch into the mirror at `path`, creating it if need be.
 * The window is timestamp ∈ [start, windowEnd): the next midnight after `end`, or `until`
 * when the window stops short of it. Only days wholly inside are recorded as covered. `changed` counts detections added,
 * altered or deleted; a window that changed nothing and whose days were already covered
 * writes nothing. Feeds are upserted, never deleted.
 */
export function reconcileWindow(
    path: string, window: DetectionsWindowBounds, response: Pick<DetectionsWindow, 'detections' | 'feeds'>,
    {maxDeleteShare = DELETE_FLOOR_SHARE}: ReconcileOptions = {},
): ReconcileResult {
    mkdirSync(dirname(path), {recursive: true});
    const db = new DatabaseSync(path);
    try {
        // Write-ahead logging, so a build reading the mirror while this run writes it reads the
        // last commit rather than waiting out this one (as ingest-maplify.ts).
        db.exec('PRAGMA journal_mode = WAL');
        db.exec(SCHEMA);
        const stored = new Map(
            (db.prepare('SELECT * FROM detections WHERE timestamp >= ? AND timestamp < ?')
                .all(window.start, windowEnd(window)) as unknown as MirrorRow[])
                .map(r => [r.id, JSON.stringify(COLUMNS.map(c => r[c]))]));
        const plan = reconcile(response.detections, [...stored.keys()]);
        if (maxDeleteShare !== null && stored.size >= DELETE_FLOOR_MIN_STORED
            && plan.delete.length > maxDeleteShare * stored.size)
            throw new Error(`orcasound detections ${window.start}..${window.end}: the response lacks ${plan.delete.length} of the `
                + `${stored.size} detections the mirror holds for the window, more than the ${Math.round(maxDeleteShare * 100)}% `
                + `a scheduled run may delete; nothing written. If orcasite really removed them, a backfill of the window applies it.`);
        const rows = plan.upsert.map(mirrorRow);
        const altered = rows.filter(r => stored.get(r.id) !== JSON.stringify(COLUMNS.map(c => r[c])));
        // a day the window stops short of isn't covered: its later hours weren't asked for
        const days = windowDays(window).filter(day => `${addDays(day, 1)}T00:00:00.000000Z` <= windowEnd(window));
        const covered = days.length === 0 ? 0 : (db.prepare(`SELECT count(*) AS n FROM covered_days WHERE day >= ? AND day <= ?`)
            .get(days[0]!, days[days.length - 1]!) as {n: number}).n;
        const knownFeeds = new Map((db.prepare('SELECT * FROM feeds').all() as {id: string, name: string, lon: number, lat: number}[])
            .map(f => [f.id, JSON.stringify([f.name, f.lon, f.lat])]));
        const newFeeds = response.feeds.filter(f => knownFeeds.get(f.id) !== JSON.stringify([f.name, f.lon, f.lat]));
        const changed = altered.length + plan.delete.length;
        if (changed === 0 && covered === days.length && newFeeds.length === 0)
            return {upserted: rows.length, deleted: 0, changed: 0, duplicates: response.detections.length - rows.length};
        db.exec('BEGIN');
        try {
            const upsert = db.prepare(
                `INSERT OR REPLACE INTO detections (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`);
            for (const r of altered) upsert.run(...COLUMNS.map(c => r[c]));
            const remove = db.prepare('DELETE FROM detections WHERE id = ?');
            for (const id of plan.delete) remove.run(id);
            const feed = db.prepare('INSERT OR REPLACE INTO feeds (id, name, lon, lat) VALUES (?, ?, ?, ?)');
            for (const f of newFeeds) feed.run(f.id, f.name, f.lon, f.lat);
            const cover = db.prepare('INSERT OR IGNORE INTO covered_days (day) VALUES (?)');
            for (const day of days) cover.run(day);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        return {upserted: rows.length, deleted: plan.delete.length, changed, duplicates: response.detections.length - rows.length};
    } finally {
        db.close();
    }
}

export async function main(): Promise<void> {
    const [path, start, end] = process.argv.slice(2);
    if (!path || (start === undefined) !== (end === undefined)) {
        console.error('usage: ingest-orcasound-detections.ts <orcasound-detections.sqlite> [<start> <end>]');
        process.exit(2);
    }
    let windows: DetectionsWindowBounds[];
    if (start !== undefined && end !== undefined) {
        const window = curatorWindow(start, end);
        if (!window) {
            console.error(`not a window: ${start}..${end} (two days, 'YYYY-MM-DD', start first)`);
            process.exit(2);
        }
        windows = [window];
    } else {
        const now = new Date();
        const regular: DetectionsWindowBounds = {...defaultWindow(now, REGULAR_DAYS), until: cutoff(now)};
        const earliest = firstCoveredDay(path);
        const older = earliest === null ? null : antiEntropyWindow(earliest, regular.start, now, Math.random());
        windows = older ? [regular, older] : [regular];
    }
    // The tables exist before any fetch, so a derivation can attach the file even while orcasite is down.
    ensureMirror(path);
    const log = (msg: string, extra?: Record<string, unknown>) =>
        console.log(extra ? `${msg} ${JSON.stringify(extra)}` : msg);
    const trigger = start !== undefined ? 'manual' : 'cron';
    // Counted as windows land, so a failure after one still reports what it changed.
    let changedInAll = 0;
    const run = await recordedRun(path, 'orcasound-detections', trigger, async () => {
        for (const window of windows) {
            const response = await fetchDetectionsWindow(window, log);
            // a curator's backfill applies what it fetched, floor or no floor (see reconcileWindow)
            const {upserted, deleted, changed} = reconcileWindow(path, window, response,
                trigger === 'manual' ? {maxDeleteShare: null} : {});
            changedInAll += changed;
            console.log(`orcasound detections ${window.start}..${window.end}: ${response.detections.length} fetched in ${response.pages} pages; `
                + `${changed === 0 ? 'unchanged' : `${changed} changed (${deleted} deleted)`}; ${upserted} in the window`);
        }
        return changedInAll;
    });
    // A source that can't be reached leaves the mirror as it was, and the build goes on
    // with it (ingest-runs.ts); a backfill run by hand fails loudly instead.
    if (!run.ok) {
        console.error(`orcasound detections: fetch failed; the mirror keeps its last good copy: ${String(run.error)}`);
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
