import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { isIngestable, parseMaplifyResponse, reconcile, type NormalizedSighting } from '../ingest/maplify.ts';
import { persistMaplify, type IngestWindow } from '../ingest/persist.ts';
import { buildNameIndex } from '../register/name-index.ts';
import { DELETE_FLOOR_MIN_STORED, mirrorRow, reconcileWindow, type MirrorRow } from './ingest-maplify.ts';
import { antiEntropyWindow, curatorWindow, firstCoveredDay, windowDays } from './windows.ts';
import { rolledBack } from './rolled-back.ts';

/**
 * What Maplify returned on 2026-07-05 (scripts/ingest/fixtures/maplify-sample.json), six
 * sightings, with wras's Salish Sea humpback relabelled as Whale Alert's so that both of
 * scope's rules keep one: an orca, and a humpback inside the Salish Sea. Out of scope stay
 * a blue and a humpback whale off California, and wras's killer whale (an excluded
 * source). Ids are moved into a range a database that mirrors production can't hold.
 */
function fetched(): NormalizedSighting[] {
    const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, '../ingest/fixtures/maplify-sample.json'), 'utf8'));
    const parsed = parseMaplifyResponse(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.sightings.map(s => ({
        ...s,
        id: s.id + 920_000_000,
        source: s.id === 238140 ? 'whale_alert' : s.source,
    }));
}

const WINDOW: IngestWindow = {start: '2026-06-26', end: '2026-07-05'};

/** A constructed register edition, as persist.test.ts has: CI loads none. */
const taxon = (entity_id: string, name: string, taxon_label: string) =>
    ({entity_id, name, kind: 'taxon', retired: false, taxon_label});
const INDEX = buildNameIndex([
    taxon('SSA:0000900', 'Orcinus orca', 'Orcinus orca'),
    taxon('SSA:0000900', 'Orca', 'Orcinus orca'),
    taxon('SSA:0000999', 'Balaenoptera musculus', 'Balaenoptera musculus'),
]);

const rowsOf = (file: string): MirrorRow[] => {
    const db = new DatabaseSync(file, {readOnly: true});
    try {
        return db.prepare('SELECT * FROM sightings ORDER BY id').all() as unknown as MirrorRow[];
    } finally {
        db.close();
    }
};

describe('the mirror', () => {
    let dir: string;
    beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'maplify-mirror-')); });
    afterAll(async () => { await rm(dir, {recursive: true, force: true}); });

    test('holds every sighting fetched, in scope or not', () => {
        const mirror = path.join(dir, 'all.sqlite');
        const sightings = fetched();
        expect(sightings.filter(s => isIngestable(s, INDEX))).toHaveLength(2);
        expect(reconcileWindow(mirror, WINDOW, sightings)).toEqual({upserted: 6, deleted: 0, changed: 6});
        expect(rowsOf(mirror)).toEqual(sightings.map(mirrorRow).sort((a, b) => a.id - b.id));
    });

    test('a window fetched again unchanged writes nothing', () => {
        const mirror = path.join(dir, 'again.sqlite');
        reconcileWindow(mirror, WINDOW, fetched());
        expect(reconcileWindow(mirror, WINDOW, fetched())).toEqual({upserted: 6, deleted: 0, changed: 0});
    });

    test('reconciles within the window: an edit is written, a sighting gone from the window deleted, others kept', () => {
        const mirror = path.join(dir, 'reconcile.sqlite');
        const [first, ...rest] = fetched();
        const before: NormalizedSighting = {...first!, id: 920_000_001, createdAt: '2026-06-01 12:00:00'};
        reconcileWindow(mirror, {start: '2026-06-01', end: '2026-06-01'}, [before]);
        reconcileWindow(mirror, WINDOW, [first!, ...rest]);
        const edited = {...rest[0]!, comments: 'edited upstream'};
        const result = reconcileWindow(mirror, WINDOW, [edited, ...rest.slice(1)]);
        expect(result).toEqual({upserted: 5, deleted: 1, changed: 2});
        const ids = rowsOf(mirror).map(r => r.id);
        expect(ids).not.toContain(first!.id);
        expect(ids).toContain(before.id);   // outside the window: not this fetch's to delete
        expect(rowsOf(mirror).find(r => r.id === edited.id)?.comments).toBe('edited upstream');
    });

    // The delete floor (salish-xv35.21): a response cut short must not read as a month of
    // retractions. Thirty sightings in the window; a fetch that returns twenty-six is a
    // retraction of four (13%), which a scheduled run refuses and a backfill applies.
    test('a scheduled run refuses to delete more than a tenth of a window, and writes nothing', () => {
        const mirror = path.join(dir, 'floor.sqlite');
        const base = fetched()[0]!;
        const thirty = Array.from({length: 30}, (_, i) => ({...base, id: 930_000_000 + i, createdAt: '2026-07-01T12:00:00Z'}));
        expect(thirty.length).toBeGreaterThanOrEqual(DELETE_FLOOR_MIN_STORED);
        reconcileWindow(mirror, WINDOW, thirty);
        const before = rowsOf(mirror);
        expect(() => reconcileWindow(mirror, WINDOW, thirty.slice(4))).toThrow(/lacks 4 of the 30 .* more than the 10%/);
        expect(rowsOf(mirror)).toEqual(before);
        // three of thirty is within the floor
        expect(reconcileWindow(mirror, WINDOW, thirty.slice(3))).toMatchObject({deleted: 3});
        // and a curator's backfill has no floor
        expect(reconcileWindow(mirror, WINDOW, thirty.slice(10), {maxDeleteShare: null})).toMatchObject({deleted: 7});
        expect(rowsOf(mirror)).toHaveLength(20);
    });

    test('a window too small for a share to mean anything has no floor', () => {
        const mirror = path.join(dir, 'small.sqlite');
        const base = fetched()[0]!;
        const five = Array.from({length: 5}, (_, i) => ({...base, id: 940_000_000 + i, createdAt: '2026-07-01T12:00:00Z'}));
        reconcileWindow(mirror, WINDOW, five);
        expect(reconcileWindow(mirror, WINDOW, [])).toMatchObject({deleted: 5});
    });

    test('records the days it covered', () => {
        const mirror = path.join(dir, 'days.sqlite');
        reconcileWindow(mirror, WINDOW, []);
        const db = new DatabaseSync(mirror, {readOnly: true});
        const days = (db.prepare('SELECT day FROM covered_days ORDER BY day').all() as {day: string}[]).map(r => r.day);
        db.close();
        expect(days).toEqual(windowDays(WINDOW));
        expect(days).toHaveLength(10);
    });

    test("a curator's window is two real days, start first", () => {
        expect(curatorWindow('2024-06-01', '2024-06-30')).toEqual({start: '2024-06-01', end: '2024-06-30'});
        expect(curatorWindow('2024-06-01', '2024-06-01')).not.toBeNull();
        expect(curatorWindow('2026-7-1', '2026-07-31')).toBeNull();
        expect(curatorWindow('2026-02-01', '2026-02-30')).toBeNull();
        expect(curatorWindow('2026-13-01', '2026-13-02')).toBeNull();
        expect(curatorWindow('2026-07-31', '2026-07-01')).toBeNull();
    });

    test('anti-entropy picks one whole calendar month before the regular window, the last one cut short', () => {
        const now = new Date('2026-10-02T12:00:00Z');
        // the regular window starts 2026-09-02, so the newest month is 2026-09-01..09-01
        expect(antiEntropyWindow('2014-04-17', '2026-09-02', now, 0)).toEqual({start: '2014-04-01', end: '2014-04-30'});
        expect(antiEntropyWindow('2014-04-17', '2026-09-02', now, 0.999999)).toEqual({start: '2026-09-01', end: '2026-09-01'});
        expect(antiEntropyWindow('2026-02-10', '2026-03-15', now, 0.5)?.start).toMatch(/^2026-0[23]-01$/);
        expect(antiEntropyWindow('2026-09-05', '2026-09-02', now, 0.5)).toBeNull();
    });

    test('anti-entropy favours recent months, as BeeAtlas weights its sample', () => {
        const now = new Date('2026-10-02T12:00:00Z');
        const picks = new Map<string, number>();
        for (let i = 0; i < 1000; i++) {
            const w = antiEntropyWindow('2014-04-01', '2026-09-02', now, i / 1000)!;
            picks.set(w.start.slice(0, 4), (picks.get(w.start.slice(0, 4)) ?? 0) + 1);
        }
        // a month a year old weighs half what this month does, twelve years old a thirteenth
        expect(picks.get('2026')!).toBeGreaterThan(picks.get('2015')! * 4);
        expect(picks.get('2015')!).toBeGreaterThan(0);
    });

    test('the anti-entropy sweep reaches back as far as the mirror covers', () => {
        const mirror = path.join(dir, 'first.sqlite');
        expect(firstCoveredDay(mirror)).toBeNull();
        reconcileWindow(mirror, {start: '2024-06-01', end: '2024-06-03'}, []);
        reconcileWindow(mirror, WINDOW, []);
        expect(firstCoveredDay(mirror)).toBe('2024-06-01');
    });

    test('a window is its days, both ends included, across a month', () => {
        expect(windowDays({start: '2026-06-29', end: '2026-07-02'})).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02']);
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

// The guarantee the live report can't give (it races two fetches): for the same response,
// the mirror's in-scope sightings are what Postgres's ingest stores, field for field.
//
// Written inside a transaction that is always rolled back (rolled-back.ts), so no other
// test file running beside this one ever sees these rows.
describe.skipIf(!DSN)('the mirror stores what Postgres stores (local Supabase)', () => {
    let sql: ReturnType<typeof postgres>;
    let dir: string;
    beforeAll(async () => {
        sql = postgres(DSN as string, {max: 1});
        dir = await mkdtemp(path.join(tmpdir(), 'maplify-equivalence-'));
    });
    afterAll(async () => {
        await sql.end();
        await rm(dir, {recursive: true, force: true});
    });

    test('for the recorded response', async () => {
        const sightings = fetched();
        const stored = await rolledBack(sql, async (nested, tx) => {
            // Postgres's ingest, as the Supabase function runs it: scope first, then reconcile.
            await persistMaplify(nested, reconcile(sightings.filter(s => isIngestable(s, INDEX)), []), WINDOW, INDEX);
            await tx`SET LOCAL extra_float_digits = 3`;
            return [...await tx<MirrorRow[]>`
                SELECT id, project_id, trip_id, name, scientific_name,
                       gis.st_x(location::gis.geometry) AS lon, gis.st_y(location::gis.geometry) AS lat,
                       number_sighted, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
                       photo_url, comments, in_ocean::int AS in_ocean, moderated, trusted::int AS trusted,
                       is_test::int AS is_test, source, usernm
                FROM maplify.sightings WHERE id >= 920000000 AND id < 930000000 ORDER BY id`];
        });

        const mirror = path.join(dir, 'maplify.sqlite');
        reconcileWindow(mirror, WINDOW, sightings);
        const inScope = rowsOf(mirror).filter(r => isIngestable(
            {name: r.name, scientificName: r.scientific_name, lon: r.lon, lat: r.lat, source: r.source} as NormalizedSighting, INDEX));
        expect(inScope).toEqual(stored.map(r => ({...r})));
        expect(stored).toHaveLength(2);
        const [left] = await sql<{n: number}[]>`SELECT count(*)::int AS n FROM maplify.sightings WHERE id >= 920000000 AND id < 930000000`;
        expect(left?.n, 'and nothing was left behind').toBe(0);
    });
});
