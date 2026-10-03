/**
 * iNaturalist's observations, ingested by the read-path build itself (decision 061,
 * salish-xv35.8): the third and last upstream source to stop depending on Postgres.
 *
 *   node scripts/read-path/ingest-inaturalist.ts <inaturalist.sqlite> [<start> <end>]
 *
 * The same fetch shell and pure core the Supabase function uses
 * (scripts/ingest/fetch-inaturalist.ts, scripts/ingest/inaturalist.ts) write a SQLite
 * mirror of observations, their photos, and every taxon they reach. Like Maplify's
 * (ingest-maplify.ts), the mirror keeps every observation in the fetch box, in the map's
 * scope or not: scope is the derivation's call (decision 061, amended). It keeps the
 * observer's login and ORCID on the observation; minting a contributor from them is a
 * Postgres write that does not move here.
 *
 * Given a curator's start and end (observer's dates, both inclusive), that one window.
 * Otherwise, each run:
 *
 *   - what iNaturalist changed since the last run (`updated_since`, from an hour before
 *     the newest `updated_at` the mirror has seen): new observations, edits, and the late uploads a
 *     window by observation date never sees. Of October 2025's 537 observations in scope,
 *     Postgres's ten-day ingest was missing 184 on 2026-10-03, 128 of them uploaded more
 *     than ten days after the sighting. About 200 a day; one page, usually.
 *   - the ten days ending today, reconciled: an observation deleted upstream leaves the
 *     mirror within a run, as it leaves Postgres within a tick.
 *   - one older calendar month, reconciled, for anti-entropy: deletions and anything else
 *     the first two miss, chosen at random weighted toward recent months
 *     (windows.ts's antiEntropyWindow, as the Maplify ingest does).
 *
 * A reconciled window is fetched a day wider than it is at each end, and only its own days
 * are reconciled: iNaturalist's `d1`/`d2` filter the observer's local date, the mirror
 * bounds by instant, and no time zone puts an observation of one of a window's days
 * outside the padded fetch (the straddle decision 041 found, closed the other way round).
 * An observation is rewritten when anything about it or its photos differs, unless the copy
 * fetched is older than the mirror's; its photos are replaced with it. (Postgres's persist
 * rewrites only when `updated_at` moved, which a photo's re-licensing doesn't do.) Taxa are
 * only ever added.
 *
 * Decision 011's rule holds: a sweep that isn't provably complete, or a taxon closure that
 * doesn't resolve, throws before anything is written, and each window or sweep is one
 * SQLite transaction. iNaturalist asks for at most 60 requests a minute (decision 041):
 * a run makes a handful, a second apart.
 *
 * Under Stelis it writes the boundary receipt (STELIS_BOUNDARY_RECEIPT).
 */

import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { fetchAllObservationPages, resolveTaxonClosure, type ObservationQuery } from '../ingest/fetch-inaturalist.ts';
import { reconcile, type NormalizedObservation, type NormalizedTaxon } from '../ingest/inaturalist.ts';
import type { IngestWindow } from '../ingest/persist.ts';
import { defaultWindow } from '../ingest/window.ts';
import { addDays, antiEntropyWindow, curatorWindow, firstCoveredDay, windowDays } from './windows.ts';

/** How far back the first `updated_since` reaches, before the mirror has seen anything. */
export const FIRST_UPDATED_DAYS = 30;

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY, description TEXT, lon REAL NOT NULL, lat REAL NOT NULL,
        observed_at TEXT NOT NULL, observed_ms INTEGER NOT NULL, license_code TEXT,
        uri TEXT NOT NULL, login TEXT NOT NULL, orcid TEXT, taxon_id INTEGER NOT NULL,
        ancestor_ids TEXT NOT NULL, public_positional_accuracy INTEGER, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS observations_observed_ms ON observations (observed_ms);
    CREATE TABLE IF NOT EXISTS observation_photos (
        id INTEGER PRIMARY KEY, observation_id INTEGER NOT NULL, seq INTEGER NOT NULL,
        attribution TEXT NOT NULL, hidden INTEGER NOT NULL, license TEXT, height INTEGER,
        width INTEGER, url TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS observation_photos_observation ON observation_photos (observation_id);
    CREATE TABLE IF NOT EXISTS taxa (
        id INTEGER PRIMARY KEY, parent_id INTEGER, scientific_name TEXT NOT NULL,
        vernacular_name TEXT, rank TEXT NOT NULL, is_active INTEGER NOT NULL, current_taxon_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS covered_days (day TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS sync (key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

/** An observation as the mirror stores it. */
export type ObservationRow = {
    id: number, description: string | null, lon: number, lat: number, observed_at: string,
    observed_ms: number, license_code: string | null, uri: string, login: string, orcid: string | null,
    taxon_id: number, ancestor_ids: string, public_positional_accuracy: number | null, updated_at: string,
};

/** A photo as the mirror stores it. */
export type PhotoRow = {
    id: number, observation_id: number, seq: number, attribution: string, hidden: number,
    license: string | null, height: number | null, width: number | null, url: string,
};

/** A taxon as the mirror stores it. */
export type TaxonRow = {
    id: number, parent_id: number | null, scientific_name: string, vernacular_name: string | null,
    rank: string, is_active: number, current_taxon_id: number | null,
};

export function observationRow(o: NormalizedObservation): ObservationRow {
    return {
        id: o.id, description: o.description, lon: o.lon, lat: o.lat, observed_at: o.observedAt,
        observed_ms: Date.parse(o.observedAt), license_code: o.licenseCode, uri: o.uri, login: o.login,
        orcid: o.orcid, taxon_id: o.taxonId, ancestor_ids: JSON.stringify(o.ancestorIds),
        public_positional_accuracy: o.publicPositionalAccuracy, updated_at: o.updatedAt,
    };
}

export function photoRows(o: NormalizedObservation): PhotoRow[] {
    return o.photos.map(p => ({
        id: p.id, observation_id: o.id, seq: p.seq, attribution: p.attribution, hidden: Number(p.hidden),
        license: p.license, height: p.height, width: p.width, url: p.url,
    }));
}

export function taxonRow(t: NormalizedTaxon): TaxonRow {
    return {
        id: t.id, parent_id: t.parentId, scientific_name: t.scientificName, vernacular_name: t.vernacularName,
        rank: t.rank, is_active: Number(t.isActive), current_taxon_id: t.currentTaxonId,
    };
}

const insert = (db: DatabaseSync, table: string, row: Record<string, unknown>, verb = 'INSERT OR REPLACE') => {
    const columns = Object.keys(row);
    db.prepare(`${verb} INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...(Object.values(row) as (string | number | null)[]));
};

/** Open (creating if need be) the mirror at `path`. */
export function openMirror(path: string): DatabaseSync {
    mkdirSync(dirname(path), {recursive: true});
    const db = new DatabaseSync(path);
    db.exec(SCHEMA);
    return db;
}

/** The taxon ids among `candidates` the mirror already holds. */
export function storedTaxonIds(db: DatabaseSync, candidates: readonly number[]): number[] {
    const have = new Set((db.prepare('SELECT id FROM taxa').all() as {id: number}[]).map(r => r.id));
    return candidates.filter(id => have.has(id));
}

export type ApplyResult = {written: number, deleted: number, taxa: number};

/**
 * Write a complete fetch into the mirror in one transaction: the taxa it reaches (added,
 * never changed), each observation whose `updated_at` is newer than the mirror's (with its
 * photos replaced), and, for a reconciled `window`, the deletion of every observation the
 * mirror holds on the window's days that the fetch didn't return. Records the window's
 * days as covered. `written + deleted` is what changed.
 */
export function applyFetch(
    db: DatabaseSync,
    fetched: readonly NormalizedObservation[],
    taxa: readonly NormalizedTaxon[],
    window: IngestWindow | null,
): ApplyResult {
    // What the mirror holds of each fetched observation, as its row and photos would be
    // written, to compare with what came back.
    const ids = JSON.stringify(fetched.map(o => o.id));
    const storedRows = new Map(
        (db.prepare('SELECT * FROM observations WHERE id IN (SELECT value FROM json_each(?))').all(ids) as unknown as ObservationRow[])
            .map(r => [r.id, r]));
    const storedPhotos = new Map<number, PhotoRow[]>();
    for (const p of db.prepare('SELECT * FROM observation_photos WHERE observation_id IN (SELECT value FROM json_each(?)) ORDER BY id')
        .all(ids) as unknown as PhotoRow[])
        storedPhotos.set(p.observation_id, [...(storedPhotos.get(p.observation_id) ?? []), p]);
    const asStored = (row: ObservationRow, photos: readonly PhotoRow[]) =>
        JSON.stringify([row, [...photos].sort((a, b) => a.id - b.id)]);
    // Written when anything differs, not only when iNaturalist's updated_at moved: a photo
    // re-licensed (CC0 to CC BY, seen) or an observer renamed leaves updated_at alone, and
    // Postgres's newer-only rule has kept 3,361 observations' photos stale that way. An
    // older copy than the mirror's is still never written over a newer one.
    const newer = fetched.filter(o => {
        const was = storedRows.get(o.id);
        if (was === undefined) return true;
        if (Date.parse(o.updatedAt) < Date.parse(was.updated_at)) return false;
        return asStored(observationRow(o), photoRows(o)) !== asStored(was, storedPhotos.get(o.id) ?? []);
    });
    let deleteIds: number[] = [];
    if (window) {
        const inWindow = (db.prepare('SELECT id FROM observations WHERE observed_ms >= ? AND observed_ms < ?')
            .all(Date.parse(`${window.start}T00:00:00Z`), Date.parse(`${addDays(window.end, 1)}T00:00:00Z`)) as {id: number}[])
            .map(r => r.id);
        deleteIds = [...reconcile(fetched, inWindow).delete];
    }
    db.exec('BEGIN');
    try {
        let added = 0;
        for (const t of taxa) {
            const before = (db.prepare('SELECT count(*) AS n FROM taxa WHERE id = ?').get(t.id) as {n: number}).n;
            if (before === 0) { insert(db, 'taxa', taxonRow(t), 'INSERT'); added++; }
        }
        const dropPhotos = db.prepare('DELETE FROM observation_photos WHERE observation_id = ?');
        for (const o of newer) {
            insert(db, 'observations', observationRow(o));
            dropPhotos.run(o.id);
            for (const p of photoRows(o)) insert(db, 'observation_photos', p);
        }
        const dropObservation = db.prepare('DELETE FROM observations WHERE id = ?');
        for (const id of deleteIds) {
            dropPhotos.run(id);
            dropObservation.run(id);
        }
        if (window) {
            const cover = db.prepare('INSERT OR IGNORE INTO covered_days (day) VALUES (?)');
            for (const day of windowDays(window)) cover.run(day);
        }
        db.exec('COMMIT');
        return {written: newer.length, deleted: deleteIds.length, taxa: added};
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

/** The `updated_since` the next sweep starts from, or null before the first. */
export function syncedThrough(db: DatabaseSync): string | null {
    const row = db.prepare("SELECT value FROM sync WHERE key = 'updated_since'").get() as {value: string} | undefined;
    return row?.value ?? null;
}

/** Remember the newest `updated_at` a sweep saw, so the next asks only for what came after. */
export function recordSynced(db: DatabaseSync, fetched: readonly NormalizedObservation[]): void {
    const newest = fetched.reduce<string | null>(
        (max, o) => max === null || Date.parse(o.updatedAt) > Date.parse(max) ? o.updatedAt : max, null);
    const was = syncedThrough(db);
    if (newest === null || (was !== null && Date.parse(newest) <= Date.parse(was))) return;
    db.prepare("INSERT OR REPLACE INTO sync (key, value) VALUES ('updated_since', ?)").run(newest);
}

/**
 * How far before its checkpoint a changes sweep starts. iNaturalist can commit a change
 * stamped slightly earlier than the newest `updated_at` a sweep already read, and a sweep
 * from exactly the checkpoint would never see it; the overlap's few records come back
 * again and are skipped as not newer.
 */
export const SYNC_OVERLAP_MS = 60 * 60 * 1000;

/** Where the changes sweep starts: an hour before the checkpoint, or 30 days back before the first. */
export function sweepFrom(synced: string | null, now: Date): string {
    return synced === null
        ? defaultWindow(now, FIRST_UPDATED_DAYS).start
        : new Date(Date.parse(synced) - SYNC_OVERLAP_MS).toISOString();
}

/** A window, a day wider at each end, for the fetch that reconciles it. */
export const padded = (w: IngestWindow): IngestWindow => ({start: addDays(w.start, -1), end: addDays(w.end, 1)});

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function main(): Promise<void> {
    const [path, start, end] = process.argv.slice(2);
    if (!path || (start === undefined) !== (end === undefined)) {
        console.error('usage: ingest-inaturalist.ts <inaturalist.sqlite> [<start> <end>]');
        process.exit(2);
    }
    const log = (msg: string, extra?: Record<string, unknown>) =>
        console.log(extra ? `${msg} ${JSON.stringify(extra)}` : msg);
    const quiet = () => {};
    const db = openMirror(path);
    let changed = 0;
    let since: string | null = null;
    try {
        const run = async (label: string, query: ObservationQuery, window: IngestWindow | null) => {
            const {observations, recordCount} = await fetchAllObservationPages(query, quiet, undefined, {scoped: false});
            const taxa = await resolveTaxonClosure(async ids => storedTaxonIds(db, ids), observations, quiet);
            const result = applyFetch(db, observations, taxa, window);
            if (!window) recordSynced(db, observations);
            changed += result.written + result.deleted;
            log(`inaturalist ${label}: ${recordCount} fetched; ${result.written} written, ${result.deleted} deleted, `
                + `${result.taxa} taxa added`);
            await sleep(1000);
        };
        if (start !== undefined && end !== undefined) {
            const window = curatorWindow(start, end);
            if (!window) {
                console.error(`not a window: ${start}..${end} (two days, 'YYYY-MM-DD', start first)`);
                process.exit(2);
            }
            await run(`${window.start}..${window.end}`, padded(window), window);
            since = window.start;
        } else {
            const now = new Date();
            const updatedSince = sweepFrom(syncedThrough(db), now);
            await run(`updated since ${updatedSince}`, {updatedSince}, null);
            const recent = defaultWindow(now, 10);
            await run(`${recent.start}..${recent.end}`, padded(recent), recent);
            const earliest = firstCoveredDay(path);
            const older = earliest === null ? null : antiEntropyWindow(earliest, recent.start, now, Math.random());
            if (older) await run(`${older.start}..${older.end}`, padded(older), older);
            since = older?.start ?? recent.start;
        }
    } finally {
        db.close();
    }
    const receipt = process.env['STELIS_BOUNDARY_RECEIPT'];
    if (receipt) await writeFile(receipt, JSON.stringify({unchanged: changed === 0, records: changed, since}));
}

if (import.meta.main) {
    await main();
}
