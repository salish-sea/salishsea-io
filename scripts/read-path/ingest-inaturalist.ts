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
 * rewrites only when `updated_at` moved, which a photo's re-licensing doesn't do.) A fetch
 * only ever adds taxa; what changes one is the rolling refresh below (salish-xv35.9.3),
 * which also fetches every taxon the register names, so the derivation needs no copy of
 * Postgres's.
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

import { DuckDBInstance } from '@duckdb/node-api';

import { fetchAllObservationPages, fetchTaxa, resolveTaxonClosure, type ObservationQuery } from '../ingest/fetch-inaturalist.ts';
import { reconcile, type NormalizedObservation, type NormalizedTaxon } from '../ingest/inaturalist.ts';
import type { IngestWindow } from '../ingest/persist.ts';
import { defaultWindow } from '../ingest/window.ts';
import { budget } from './duckdb-budget.ts';
import { addDays, antiEntropyWindow, curatorWindow, firstCoveredDay, windowDays } from './windows.ts';
import { boundaryReceipt, recordedRun } from './ingest-runs.ts';

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
        vernacular_name TEXT, rank TEXT NOT NULL, is_active INTEGER NOT NULL, current_taxon_id INTEGER,
        checked_at TEXT
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
    // A mirror from before the rolling refresh (salish-xv35.9.3) has no checked_at; every
    // taxon in it is then due, and the refresh works through them a run at a time.
    if (db.prepare("SELECT 1 FROM pragma_table_info('taxa') WHERE name = 'checked_at'").get() === undefined)
        db.exec('ALTER TABLE taxa ADD COLUMN checked_at TEXT');
    return db;
}

/** The taxon ids among `candidates` the mirror already holds. */
export function storedTaxonIds(db: DatabaseSync, candidates: readonly number[]): number[] {
    const have = new Set((db.prepare('SELECT id FROM taxa').all() as {id: number}[]).map(r => r.id));
    return candidates.filter(id => have.has(id));
}

// --- The taxa the register names, and the rolling refresh (salish-xv35.9.3) ---------------
//
// A taxon row is written when first reached and, until now, never asked about again, so
// its name, rank, parent and whether it still exists froze at that day; Postgres's copy
// had a weekly job for this (taxa-refresh.yml, retired 2026-10-09). And the mirror held
// only the taxa its observations reached, while the register maps entities to taxa that
// a Happywhale or native sighting names and no observation ever carried — those came
// from Postgres until here. Both are the ingest's now: each run fetches every taxon the
// register names that the mirror lacks, and re-asks upstream about a handful of the
// longest-unchecked, so a week's worth is covered many times over in a day of builds.

/** How long a mirrored taxon's fields are trusted before upstream is asked again. */
export const REFRESH_AFTER_DAYS = 7;
/** How many taxa one run re-asks about: one request (fetch-inaturalist's chunk). */
export const REFRESH_PER_RUN = 30;

/**
 * Every iNaturalist taxon the register's mappings name (the same test as
 * derive/lookups.sql's inaturalist_mapping), read from the snapshot's copy of the register.
 */
export async function registerTaxonIds(snapshot: string): Promise<number[]> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        const reader = await conn.runAndReadAll(`
            SELECT DISTINCT CAST(split_part(object_id, ':', 2) AS INTEGER) AS id
            FROM store.register.mappings
            WHERE predicate_id IN ('skos:exactMatch', 'skos:closeMatch')
              AND regexp_full_match(object_id, 'inaturalist\\.taxon:[0-9]{1,9}')
            ORDER BY id`);
        return (reader.getRows() as [number][]).map(([id]) => Number(id));
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

/**
 * Taxa the mirror's rows point at (a parent, a replacement) that it does not hold. None,
 * normally: a fetch closes over what it reaches. But a refresh commits its rows before
 * the closure fetches what they newly reference, so an upstream failure in between leaves
 * a pointer at nothing; each run asks for these again rather than waiting a week.
 */
export function danglingTaxonIds(db: DatabaseSync): number[] {
    return (db.prepare(`
        SELECT DISTINCT r FROM (SELECT parent_id AS r FROM taxa UNION SELECT current_taxon_id AS r FROM taxa)
        WHERE r IS NOT NULL AND r NOT IN (SELECT id FROM taxa) ORDER BY r`).all() as {r: number}[]).map(x => x.r);
}

/** The taxa due a refresh: never checked, or not within REFRESH_AFTER_DAYS; oldest first. */
export function dueTaxa(db: DatabaseSync, now: Date): number[] {
    const before = new Date(now.getTime() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();
    return (db.prepare(`
        SELECT id FROM taxa WHERE checked_at IS NULL OR checked_at < ?
        ORDER BY checked_at IS NOT NULL, checked_at, id LIMIT ?`)
        .all(before, REFRESH_PER_RUN) as {id: number}[]).map(r => r.id);
}

const TAXON_FIELDS = ['id', 'parent_id', 'scientific_name', 'vernacular_name', 'rank', 'is_active', 'current_taxon_id'] as const;

/**
 * Apply what upstream now says about the taxa `asked`: a row is rewritten wherever a
 * mirrored field differs (a rename, a retirement and its replacement, a new parent), and
 * every taxon asked about is marked checked whether or not it came back — one upstream no
 * longer answers for stays as it was and is asked again in a week, not every run. Returns
 * the ids rewritten, and the ids the answers reference that the mirror lacks (a new
 * parent, a replacement), for the closure to fetch so the tree stays whole.
 */
export function refreshTaxa(
    db: DatabaseSync, asked: readonly number[], fetched: readonly NormalizedTaxon[], now: Date,
): {changed: number[], missing: number[]} {
    const stamp = now.toISOString();
    const changed: number[] = [];
    const referenced = new Set<number>();
    const stored = db.prepare(`SELECT ${TAXON_FIELDS.join(', ')} FROM taxa WHERE id = ?`);
    db.exec('BEGIN');
    try {
        for (const t of fetched) {
            const was = stored.get(t.id) as Record<string, unknown> | undefined;
            if (was === undefined) continue; // not one the mirror holds; the closure's business
            const row = taxonRow(t) as unknown as Record<string, unknown>;
            if (TAXON_FIELDS.some(f => row[f] !== was[f])) {
                insert(db, 'taxa', {...row, checked_at: stamp});
                changed.push(t.id);
            }
            for (const id of [t.parentId, t.currentTaxonId]) if (id !== null) referenced.add(id);
        }
        const mark = db.prepare('UPDATE taxa SET checked_at = ? WHERE id = ?');
        for (const id of asked) mark.run(stamp, id);
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    const have = new Set(storedTaxonIds(db, [...referenced]));
    return {changed, missing: [...referenced].filter(id => !have.has(id)).sort((a, b) => a - b)};
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
    now: Date = new Date(),
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
            // just fetched, so just checked
            if (before === 0) { insert(db, 'taxa', {...taxonRow(t), checked_at: now.toISOString()}, 'INSERT'); added++; }
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
    const args = process.argv.slice(2);
    // --register <snapshot.duckdb>: the register's copy to read the taxa it names from.
    // Without it a run fetches no register taxa and refreshes none (a backfill by hand).
    const at = args.indexOf('--register');
    const register = at >= 0 ? args[at + 1] : undefined;
    if (at >= 0) args.splice(at, 2);
    const [path, start, end] = args;
    if (!path || (start === undefined) !== (end === undefined) || (at >= 0 && !register)) {
        console.error('usage: ingest-inaturalist.ts <inaturalist.sqlite> [--register <snapshot.duckdb>] [<start> <end>]');
        process.exit(2);
    }
    const log = (msg: string, extra?: Record<string, unknown>) =>
        console.log(extra ? `${msg} ${JSON.stringify(extra)}` : msg);
    const quiet = () => {};
    const db = openMirror(path);
    let changed = 0;
    let since: string | null = null;
    const trigger = start !== undefined ? 'manual' : 'cron';
    // Checked before the run is recorded, so a mistyped backfill leaves no run unfinished.
    const manual = start !== undefined && end !== undefined ? curatorWindow(start, end) : null;
    if (trigger === 'manual' && !manual) {
        console.error(`not a window: ${start}..${end} (two days, 'YYYY-MM-DD', start first)`);
        process.exit(2);
    }
    try {
        const outcome = await recordedRun(path, 'inaturalist', trigger, async () => {
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
            if (manual) {
                await run(`${manual.start}..${manual.end}`, padded(manual), manual);
                since = manual.start;
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
                const stored = async (ids: readonly number[]) => storedTaxonIds(db, ids);
                // Pull `ids` and everything they reach into the mirror; how many were added.
                // Lenient where the observations' own closure is strict: these ids come from
                // the register, a refresh or a dangling pointer, never from an observation,
                // so one iNaturalist no longer answers for is logged and left — the pointer
                // stays, is asked for again next run, and never fails the run.
                const close = async (ids: readonly number[]) => {
                    if (ids.length === 0) return 0;
                    let reached: NormalizedTaxon[];
                    try {
                        reached = await resolveTaxonClosure(stored, [], quiet, ids);
                    } catch (error) {
                        if (!(error instanceof Error && error.message.startsWith('iNaturalist taxon closure unresolved'))) throw error;
                        log(`inaturalist taxa: ${error.message}; left as they are`);
                        return 0;
                    }
                    if (reached.length > 0) applyFetch(db, [], reached, null, now);
                    return reached.length;
                };
                if (register) {
                    // The taxa the register names that the mirror lacks. Asked for directly
                    // and leniently first: the register is curated, and a mapping to a taxon
                    // iNaturalist has deleted must not fail every run — it is logged, and
                    // the derivation treats it as it did (no taxon). The closure then runs
                    // over what came back, so ancestors and replacements follow.
                    const named = await registerTaxonIds(register);
                    const have = new Set(storedTaxonIds(db, named));
                    const wanted = named.filter(id => !have.has(id));
                    const answered = wanted.length > 0 ? await fetchTaxa(wanted, quiet) : [];
                    if (answered.length > 0) applyFetch(db, [], answered, null, now);
                    // seeded with what they reference, not with them: they are stored now,
                    // and the closure widens only through taxa it fetched itself
                    const closed = await close(answered.flatMap(t =>
                        [...t.ancestorIds, t.parentId, t.currentTaxonId].filter((id): id is number => id !== null)));
                    changed += answered.length + closed;
                    const unknown = wanted.filter(id => !answered.some(t => t.id === id));
                    log(`inaturalist register taxa: ${named.length} named, ${answered.length} fetched, ${closed} reached`
                        + (unknown.length > 0 ? `; iNaturalist does not know ${unknown.join(', ')}` : ''));
                    if (wanted.length > 0) await sleep(1000);
                }
                // a pointer left at nothing by an earlier run's failure is asked for again
                changed += await close(danglingTaxonIds(db));
                const due = dueTaxa(db, now);
                if (due.length > 0) {
                    const answered = await fetchTaxa(due, quiet);
                    const {changed: rewritten, missing} = refreshTaxa(db, due, answered, now);
                    const widened = await close(missing);
                    changed += rewritten.length + widened;
                    log(`inaturalist taxa refresh: ${due.length} asked, ${answered.length} answered, `
                        + `${rewritten.length} changed, ${widened} fetched`);
                }
            }
            return changed;
        });
        // A source that can't be reached leaves what it had applied, each window whole,
        // and the build goes on with it (ingest-runs.ts); a backfill run by hand fails loudly.
        if (!outcome.ok) {
            console.error(`inaturalist: fetch failed; the mirror keeps its last good copy: ${String(outcome.error)}`);
            if (trigger === 'manual') throw outcome.error;
        }
        const receipt = process.env['STELIS_BOUNDARY_RECEIPT'];
        if (receipt) await writeFile(receipt, boundaryReceipt(outcome, since));
    } finally {
        db.close();
    }
}

if (import.meta.main) {
    await main();
}
