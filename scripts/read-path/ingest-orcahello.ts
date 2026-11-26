/**
 * OrcaHello's detections and moderators' answers, ingested by the read-path build itself
 * (salish-fizm.1, decision 122), beside orcasite's.
 *
 *   node scripts/read-path/ingest-orcahello.ts <orcahello.sqlite> [<start> <end>]
 *
 * Fetches one UTC day at a time of OrcaHello's `/api/detections` with the shell and pure
 * core in scripts/ingest/ (fetch-orcahello.ts, orcahello.ts) and upserts every detection
 * into a SQLite mirror. It never deletes a row: a moderator's "no" that OrcaHello later
 * lost must not put a rejected detection back, and what upstream forgets is not ours to
 * forget. For the same reason a row a moderator has answered is never replaced by one that
 * says no one has (an upstream that lost its answers): the stored answer stays, and the run
 * log says how many were kept. OrcaHello's API falls over under load, so the days to ask for come from a
 * schedule (orcahello.ts's `plan`) that reads its state from the mirror and never fetches
 * faster than it allows, however often the build runs this: today and yesterday every
 * 20 minutes, one of the last thirty days each run (the one fetched longest ago), one
 * older day at random each hour. A run with nothing due fetches nothing and succeeds.
 *
 * Given a curator's start and end (both inclusive 'YYYY-MM-DD', at most 31 days), those
 * days instead, in order, for a backfill by hand; it fails loudly. Run it a month at a time.
 *
 * On a 5xx, a 403, a 429 or a timeout a run stops and keeps what it has; the pages it had
 * are written, and the day is not marked fetched until all of it came back. A day that comes
 * back short fails the run the same way (a backfill by hand then fails loudly), and so does
 * any other failure, after the other days that were due have been tried (only an upstream
 * fault stops the run, since asking again at once would not help). Every day is noted when
 * it is attempted, so a day that never completes is tried again after the others, not
 * instead of them. A failed run leaves the mirror as it was and the build goes on with it
 * (ingest-runs.ts).
 *
 * The mirror holds what OrcaHello said, in the fields decision 122 uses; the moderator's
 * name, comment and the clip's links are never stored (orcahello.ts).
 *
 * Under Stelis it also writes the boundary receipt (STELIS_BOUNDARY_RECEIPT).
 */

import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { fetchOrcaHelloDay, PAUSE_MS } from '../ingest/fetch-orcahello.ts';
import { plan, type Kind, type OrcaHelloRow, type ScheduleState } from '../ingest/orcahello.ts';
import { isTransientUpstream } from '../ingest/retry.ts';
import { boundaryReceipt, recordedRun } from './ingest-runs.ts';
import { curatorWindow, windowDays } from './windows.ts';

/** The longest backfill one command may ask for. */
export const MAX_BACKFILL_DAYS = 31;

const COLUMNS = [
    'id', 'location_id', 'location_name', 'lon', 'lat', 'timestamp', 'model_id', 'ai_model', 'confidence',
    'global_prediction_label', 'reviewed', 'found', 'moderated_at', 'tags', 'annotations',
] as const;

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS detections (
        id TEXT PRIMARY KEY, location_id TEXT NOT NULL, location_name TEXT, lon REAL, lat REAL,
        timestamp TEXT NOT NULL, model_id TEXT, ai_model TEXT, confidence REAL,
        global_prediction_label TEXT, reviewed INTEGER NOT NULL, found TEXT, moderated_at TEXT,
        tags TEXT NOT NULL, annotations TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS detections_timestamp ON detections (timestamp);
    CREATE TABLE IF NOT EXISTS windows (day TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, records INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (day TEXT PRIMARY KEY, attempted_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

function withMirror<T>(path: string, use: (db: DatabaseSync) => T): T {
    mkdirSync(dirname(path), {recursive: true});
    const db = new DatabaseSync(path);
    try {
        // Write-ahead logging, so a build reading the mirror while this run writes it reads
        // the last commit rather than waiting out this one (as ingest-maplify.ts).
        db.exec('PRAGMA journal_mode = WAL');
        db.exec(SCHEMA);
        return use(db);
    } finally {
        db.close();
    }
}

/** Create the mirror's tables if it has none, so a derivation can attach the file before any fetch. */
export function ensureMirror(path: string): void {
    withMirror(path, () => undefined);
}

/**
 * Upsert rows into the mirror: add the new, replace the altered, delete nothing, and keep a
 * stored moderator's answer when the row says no one has answered. Returns how many were
 * added or altered, and how many answered rows were kept as they were.
 */
export function upsertRows(path: string, rows: readonly OrcaHelloRow[]): {changed: number, kept: number} {
    return withMirror(path, db => {
        const find = db.prepare('SELECT * FROM detections WHERE id = ?');
        const upsert = db.prepare(
            `INSERT OR REPLACE INTO detections (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`);
        let changed = 0, kept = 0;
        db.exec('BEGIN');
        try {
            for (const row of rows) {
                const stored = find.get(row.id) as Record<string, unknown> | undefined;
                if (stored !== undefined && COLUMNS.every(c => stored[c] === row[c])) continue;
                if (stored !== undefined && stored['reviewed'] === 1 && row.reviewed === 0) { kept++; continue; }
                upsert.run(...COLUMNS.map(c => row[c]));
                changed++;
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        return {changed, kept};
    });
}

/** What the schedule reads: when each kind of fetch was last attempted, and when each day was last read whole. */
export function readSchedule(path: string): {state: ScheduleState, fetchedAt: Map<string, string>} {
    return withMirror(path, db => {
        const kv = new Map((db.prepare('SELECT key, value FROM state').all() as {key: string, value: string}[]).map(r => [r.key, r.value]));
        // The later of when a day was last read whole and when it was last tried, so a day that
        // never completes goes to the back of the cycle instead of stalling it.
        const fetchedAt = new Map((db.prepare(
            `SELECT day, max(at) AS at FROM (SELECT day, fetched_at AS at FROM windows UNION ALL SELECT day, attempted_at FROM attempts)
             GROUP BY day`).all() as {day: string, at: string}[]).map(r => [r.day, r.at]));
        return {state: {recent: kv.get('recent') ?? null, cycle: kv.get('cycle') ?? null, old: kv.get('old') ?? null}, fetchedAt};
    });
}

/** Note that a kind of fetch is being attempted now, before it is, so a run that dies holds the next one back. */
export function markAttempt(path: string, kind: Kind, at: Date): void {
    withMirror(path, db => db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)').run(kind, at.toISOString()));
}

/** Note that a day is being tried now, before it is, so one that fails or never completes is not tried again first. */
export function markDayAttempt(path: string, day: string, at: Date): void {
    withMirror(path, db => db.prepare('INSERT OR REPLACE INTO attempts (day, attempted_at) VALUES (?, ?)').run(day, at.toISOString()));
}

/** Record that a whole day was read. */
export function markDay(path: string, day: string, records: number, at: Date): void {
    withMirror(path, db => db.prepare('INSERT OR REPLACE INTO windows (day, fetched_at, records) VALUES (?, ?, ?)')
        .run(day, at.toISOString(), records));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function main({pauseMs = PAUSE_MS}: {pauseMs?: number} = {}): Promise<void> {
    const [path, start, end] = process.argv.slice(2);
    if (!path || (start === undefined) !== (end === undefined)) {
        console.error('usage: ingest-orcahello.ts <orcahello.sqlite> [<start> <end>]');
        process.exit(2);
    }
    let backfill: string[] | null = null;
    if (start !== undefined && end !== undefined) {
        const window = curatorWindow(start, end);
        if (!window) {
            console.error(`not a window: ${start}..${end} (two days, 'YYYY-MM-DD', start first)`);
            process.exit(2);
        }
        backfill = windowDays(window);
        if (backfill.length > MAX_BACKFILL_DAYS) {
            console.error(`${backfill.length} days is too many for one command: at most ${MAX_BACKFILL_DAYS}, a month at a time`);
            process.exit(2);
        }
    }
    // The tables exist before any fetch, so a derivation can attach the file even while OrcaHello is down.
    ensureMirror(path);
    const log = (msg: string, extra?: Record<string, unknown>) =>
        console.log(extra ? `${msg} ${JSON.stringify(extra)}` : msg);
    const trigger = backfill ? 'manual' : 'cron';
    const now = new Date();
    const days: {kind: Kind | null, day: string}[] = backfill
        ? backfill.map(day => ({kind: null, day}))
        : (() => {
            const {state, fetchedAt} = readSchedule(path);
            return plan(state, fetchedAt, now, Math.random());
        })();
    let changedInAll = 0;
    const run = await recordedRun(path, 'orcahello', trigger, async () => {
        // A day that fails does not end the run, unless the upstream is at fault (asking again
        // at once would not help): the others due are tried, and the first failure is thrown after.
        // A kind is noted when its first day begins, so one the run never reached is still due.
        let failure: unknown;
        const begun = new Set<Kind>();
        for (const [i, {kind, day}] of days.entries()) {
            if (i > 0) await sleep(pauseMs);
            if (kind !== null && !begun.has(kind)) { begun.add(kind); markAttempt(path, kind, now); }
            markDayAttempt(path, day, new Date());
            let changed = 0, kept = 0;
            try {
                const {total, fetched} = await fetchOrcaHelloDay(day, log, rows => {
                    const r = upsertRows(path, rows);
                    changed += r.changed;
                    kept += r.kept;
                }, {pauseMs});
                console.log(`orcahello ${day}${kind ? ` (${kind})` : ''}: ${fetched} of ${total} fetched; `
                    + (changed === 0 ? 'unchanged' : `${changed} changed`)
                    + (kept > 0 ? `; ${kept} answered detections kept as they were, OrcaHello now says no one answered them` : ''));
                // The day is whole only when every detection OrcaHello counted came back.
                if (fetched < total) throw new Error(`orcahello ${day}: ${fetched} of ${total} detections came back; the day is not marked read`);
                markDay(path, day, fetched, new Date());
            } catch (error) {
                failure ??= error;
                if (isTransientUpstream(error)) break;
            } finally {
                changedInAll += changed;
            }
        }
        if (failure !== undefined) throw failure;
        return changedInAll;
    });
    if (!run.ok) {
        console.error(`orcahello: fetch failed; the mirror keeps what it had: ${String(run.error)}`);
        if (trigger === 'manual') throw run.error;
    }
    const receipt = process.env['STELIS_BOUNDARY_RECEIPT'];
    if (receipt) await writeFile(receipt, boundaryReceipt(run, days.map(d => d.day).sort()[0] ?? null));
}

if (import.meta.main) {
    await main();
}
