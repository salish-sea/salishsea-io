/**
 * Orcasound's bouts, ingested by the read-path build itself (decision 061, salish-xv35.6):
 * the first source to stop depending on Postgres for what it says.
 *
 *   node scripts/read-path/ingest-orcasound.ts <orcasound.sqlite>
 *
 * Fetches orcasite's whole corpus with the same shell and pure core the Supabase function
 * uses (scripts/ingest/fetch-orcasound.ts, scripts/ingest/orcasound.ts), keeps what the
 * reconcile keeps, and writes the rows the shared mapping gives (boutRows) to a SQLite
 * mirror: `bouts` and `bout_entities`, as Postgres's public.acoustic_bouts and
 * acoustic_bout_entities hold them, without the provider and collection Postgres resolves
 * (the derivation resolves those).
 *
 * Decision 011's rule holds: a fetch that isn't provably complete throws, and nothing is
 * written. The mirror is replaced whole and atomically — written beside it and renamed over
 * it — so a reader never sees half of one corpus. It is derived, not authoritative: losing it
 * costs one fetch.
 *
 * Under Stelis it also writes the boundary receipt (STELIS_BOUNDARY_RECEIPT), saying whether
 * the corpus changed, so the build log can say "unchanged, N bouts" for the source itself.
 */

import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { fetchAllBouts } from '../ingest/fetch-orcasound.ts';
import { boutRows, reconcile, type BoutEntityRow, type BoutRow } from '../ingest/orcasound.ts';

export type MirrorRows = {bouts: BoutRow[], entities: BoutEntityRow[]};

const SCHEMA = `
    CREATE TABLE bouts (
        id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, feed_name TEXT NOT NULL,
        lon REAL NOT NULL, lat REAL NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT, title TEXT
    );
    CREATE TABLE bout_entities (
        bout_id TEXT NOT NULL REFERENCES bouts(id), entity_id TEXT NOT NULL, certainty TEXT,
        PRIMARY KEY (bout_id, entity_id)
    );`;

/** Replace the mirror at `path` with `rows`, atomically. */
export async function writeMirror(path: string, rows: MirrorRows): Promise<void> {
    const temp = `${path}.${process.pid}.tmp`;
    await mkdir(dirname(path), {recursive: true});
    await rm(temp, {force: true});
    const db = new DatabaseSync(temp);
    try {
        db.exec(SCHEMA);
        db.exec('BEGIN');
        const bout = db.prepare(
            'INSERT INTO bouts (id, feed_id, feed_name, lon, lat, started_at, ended_at, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const b of rows.bouts)
            bout.run(b.id, b.feed_id, b.feed_name, b.lon, b.lat, b.started_at, b.ended_at, b.title);
        const entity = db.prepare('INSERT INTO bout_entities (bout_id, entity_id, certainty) VALUES (?, ?, ?)');
        for (const e of rows.entities) entity.run(e.bout_id, e.entity_id, e.certainty);
        db.exec('COMMIT');
    } finally {
        db.close();
    }
    await rename(temp, path);
}

/** The mirror's rows, in a fixed order, or null when there is no mirror yet. */
export function readMirror(path: string): MirrorRows | null {
    if (!existsSync(path)) return null;
    const db = new DatabaseSync(path, {readOnly: true});
    try {
        return {
            bouts: db.prepare('SELECT * FROM bouts ORDER BY id').all() as unknown as BoutRow[],
            entities: db.prepare('SELECT * FROM bout_entities ORDER BY bout_id, entity_id').all() as unknown as BoutEntityRow[],
        };
    } finally {
        db.close();
    }
}

const sorted = (rows: MirrorRows): MirrorRows => ({
    bouts: [...rows.bouts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    entities: [...rows.entities].sort((a, b) =>
        a.bout_id !== b.bout_id ? (a.bout_id < b.bout_id ? -1 : 1) : a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0),
});

/** Whether two mirrors hold the same corpus. */
export function sameRows(a: MirrorRows, b: MirrorRows): boolean {
    return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

/**
 * How many bouts differ between two corpora: added, removed, or changed in any field or
 * claim. What the boundary receipt reports as the records that moved since the last fetch.
 */
export function changedBouts(before: MirrorRows | null, after: MirrorRows): number {
    const key = (rows: MirrorRows) => {
        const claims = new Map<string, BoutEntityRow[]>();
        for (const e of sorted(rows).entities) claims.set(e.bout_id, [...(claims.get(e.bout_id) ?? []), e]);
        return new Map(rows.bouts.map(b => [b.id, JSON.stringify([b, claims.get(b.id) ?? []])]));
    };
    const a = before === null ? new Map<string, string>() : key(before);
    const b = key(after);
    let n = 0;
    for (const [id, row] of b) if (a.get(id) !== row) n++;
    for (const id of a.keys()) if (!b.has(id)) n++;
    return n;
}

export async function main(): Promise<void> {
    const [path] = process.argv.slice(2);
    if (!path) {
        console.error('usage: ingest-orcasound.ts <orcasound.sqlite>');
        process.exit(2);
    }
    const log = (msg: string, extra?: Record<string, unknown>) =>
        console.log(extra ? `${msg} ${JSON.stringify(extra)}` : msg);
    const corpus = await fetchAllBouts(log);
    // The whole corpus every time, so nothing is "existing": the mirror is replaced.
    const rows = boutRows(reconcile(corpus.bouts, []).upsert);
    const before = readMirror(path);
    const unchanged = before !== null && sameRows(before, rows);
    if (!unchanged) await writeMirror(path, rows);
    console.log(`orcasound: ${corpus.bouts.length} bouts fetched in ${corpus.pages} pages; `
        + `${rows.bouts.length} kept, ${rows.entities.length} entity claims; ${unchanged ? 'unchanged' : 'written'}`);
    // `records` is what moved since the last fetch (Stelis's boundary receipt, st-8bj), not
    // the corpus's size.
    const receipt = process.env['STELIS_BOUNDARY_RECEIPT'];
    if (receipt) await writeFile(receipt, JSON.stringify({unchanged, records: changedBouts(before, rows), since: null}));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
