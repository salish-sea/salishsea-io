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
 * forget. OrcaHello's API falls over under load, so the days to ask for come from a
 * schedule (orcahello.ts's `plan`) that reads its state from the mirror and never fetches
 * faster than it allows, however often the build runs this: today and yesterday every
 * 20 minutes, one of the last thirty days each run (the one fetched longest ago), one
 * older day at random each hour. A run with nothing due fetches nothing and succeeds.
 *
 * Given a curator's start and end (both inclusive 'YYYY-MM-DD', at most 31 days), those
 * days instead, in order, for a backfill by hand; it fails loudly. Run it a month at a time.
 *
 * On a 5xx, a 403, a 429 or a timeout a run stops and keeps what it has; the pages it had
 * are written, and the day is not marked fetched until all of it came back. A failed run
 * leaves the mirror as it was and the build goes on with it (ingest-runs.ts).
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
 * Upsert rows into the mirror: add the new, replace the altered, delete nothing. Returns
 * how many were added or altered.
 */
export function upsertRows(path: string, rows: readonly OrcaHelloRow[]): number {
    return withMirror(path, db => {
        const find = db.prepare('SELECT * FROM detections WHERE id = ?');
        const upsert = db.prepare(
            `INSERT OR REPLACE INTO detections (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`);
        let changed = 0;
        db.exec('BEGIN');
        try {
            for (const row of rows) {
                const stored = find.get(row.id) as Record<string, unknown> | undefined;
                if (stored !== undefined && COLUMNS.every(c => stored[c] === row[c])) continue;
                upsert.run(...COLUMNS.map(c => row[c]));
                changed++;
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        return changed;
    });
}

/** What the schedule reads: when each kind of fetch was last attempted, and when each day was last read whole. */
export function readSchedule(path: string): {state: ScheduleState, fetchedAt: Map<string, string>} {
    return withMirror(path, db => {
        const kv = new Map((db.prepare('SELECT key, value FROM state').all() as {key: string, value: string}[]).map(r => [r.key, r.value]));
        const fetchedAt = new Map((db.prepare('SELECT day, fetched_at FROM windows').all() as {day: string, fetched_at: string}[])
            .map(r => [r.day, r.fetched_at]));
        return {state: {recent: kv.get('recent') ?? null, cycle: kv.get('cycle') ?? null, old: kv.get('old') ?? null}, fetchedAt};
    });
}

/** Note that a kind of fetch is being attempted now, before it is, so a run that dies holds the next one back. */
export function markAttempt(path: string, kind: Kind, at: Date): void {
    withMirror(path, db => db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)').run(kind, at.toISOString()));
}

/** Record that a whole day was read. */
export function markDay(path: string, day: string, records: number, at: Date): void {
    withMirror(path, db => db.prepare('INSERT OR REPLACE INTO windows (day, fetched_at, records) VALUES (?, ?, ?)')
        .run(day, at.toISOString(), records));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function main(): Promise<void> {
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
            const chosen = plan(state, fetchedAt, now, Math.random());
            for (const kind of new Set(chosen.map(d => d.kind))) markAttempt(path, kind, now);
            return chosen;
        })();
    let changedInAll = 0;
    const run = await recordedRun(path, 'orcahello', trigger, async () => {
        for (const [i, {kind, day}] of days.entries()) {
            if (i > 0) await sleep(PAUSE_MS);
            let changed = 0;
            const {total, fetched} = await fetchOrcaHelloDay(day, log, rows => { changed += upsertRows(path, rows); });
            changedInAll += changed;
            // The day is whole only when every detection OrcaHello counted came back.
            if (fetched >= total) markDay(path, day, fetched, new Date());
            console.log(`orcahello ${day}${kind ? ` (${kind})` : ''}: ${fetched} of ${total} fetched; `
                + (changed === 0 ? 'unchanged' : `${changed} changed`));
        }
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
