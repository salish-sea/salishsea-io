import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { boutRows, parseBoutsPage, reconcile, type NormalizedBout } from '../ingest/orcasound.ts';
import { persistOrcasound } from '../ingest/persist.ts';
import { changedBouts, readMirror, sameRows, writeMirror, type MirrorRows } from './ingest-orcasound.ts';

/**
 * The corpus orcasite returned on 2026-09-27 (scripts/ingest/fixtures/orcasound-bouts.json),
 * parsed and reconciled as both ingests do. Every id is prefixed so a database that mirrors
 * production can't collide with it, and one claim is made 'possible', since no moderator
 * had stated a certainty when it was recorded.
 */
function corpus(): NormalizedBout[] {
    const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, '../ingest/fixtures/orcasound-bouts.json'), 'utf8'));
    const parsed = parseBoutsPage(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const kept = reconcile(parsed.bouts, []).upsert.map(b => ({...b, id: b.id.replace(/^bout_/, 'bout_TEST')}));
    const withClaims = kept.findIndex(b => b.entities.length > 0);
    kept[withClaims] = {...kept[withClaims]!, entities: kept[withClaims]!.entities.map((e, i) => i === 0 ? {...e, certainty: 'possible'} : e)};
    return kept;
}

describe('the mirror', () => {
    let dir: string;
    beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'orcasound-mirror-')); });
    afterAll(async () => { await rm(dir, {recursive: true, force: true}); });

    test('holds exactly the rows written, and replaces them whole', async () => {
        const mirror = path.join(dir, 'orcasound.sqlite');
        const rows = boutRows(corpus());
        expect(readMirror(mirror)).toBeNull();
        await writeMirror(mirror, rows);
        expect(sameRows(readMirror(mirror)!, rows)).toBe(true);
        const fewer: MirrorRows = {bouts: rows.bouts.slice(1), entities: rows.entities.filter(e => e.bout_id !== rows.bouts[0]!.id)};
        await writeMirror(mirror, fewer);
        expect(sameRows(readMirror(mirror)!, fewer)).toBe(true);
        expect((await readdir(dir)).filter(f => f.endsWith('.tmp'))).toEqual([]);
    });

    test('changedBouts counts the bouts added, removed or changed, claims included', () => {
        const rows = boutRows(corpus());
        expect(changedBouts(rows, rows)).toBe(0);
        expect(changedBouts(null, rows)).toBe(rows.bouts.length);
        const claimed = rows.entities[0]!.bout_id;
        const edited: MirrorRows = {
            bouts: rows.bouts.slice(1).map(b => b.id === rows.bouts[1]!.id ? {...b, title: 'renamed'} : b),
            entities: rows.entities.map(e => e.bout_id === claimed && e === rows.entities[0] ? {...e, certainty: 'certain' as const} : e),
        };
        const removedHadClaim = rows.bouts[0]!.id === claimed || rows.bouts[1]!.id === claimed;
        expect(changedBouts(rows, edited)).toBe(removedHadClaim ? 2 : 3);
    });

    test('a write that fails leaves the mirror as it was and no temporary file', async () => {
        const mirror = path.join(dir, 'failing.sqlite');
        const rows = boutRows(corpus());
        await writeMirror(mirror, rows);
        // The same claim twice breaks bout_entities' primary key at insert.
        const broken: MirrorRows = {bouts: rows.bouts, entities: [...rows.entities, {bout_id: rows.entities[0]!.bout_id, entity_id: rows.entities[0]!.entity_id, certainty: null}]};
        await expect(writeMirror(mirror, broken)).rejects.toThrow();
        expect(sameRows(readMirror(mirror)!, rows)).toBe(true);
        expect((await readdir(dir)).filter(f => f.startsWith('failing.sqlite.'))).toEqual([]);
    });

    test('sameRows ignores order and sees one changed field', () => {
        const rows = boutRows(corpus());
        expect(sameRows(rows, {bouts: [...rows.bouts].reverse(), entities: [...rows.entities].reverse()})).toBe(true);
        const retitled = {...rows, bouts: rows.bouts.map((b, i) => i === 0 ? {...b, title: 'renamed'} : b)};
        expect(sameRows(rows, retitled)).toBe(false);
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

// The guarantee the live overlap report can't give (it races two fetches): for the same
// corpus, the build's mirror stores what Postgres's ingest stores.
describe.skipIf(!DSN)('the mirror stores what Postgres stores (local Supabase)', () => {
    let sql: ReturnType<typeof postgres>;
    let dir: string;
    beforeAll(async () => {
        sql = postgres(DSN as string, {max: 1});
        dir = await mkdtemp(path.join(tmpdir(), 'orcasound-equivalence-'));
    });
    afterAll(async () => {
        await sql`DELETE FROM public.acoustic_bouts WHERE id LIKE 'bout_TEST%'`;
        await sql.end();
        await rm(dir, {recursive: true, force: true});
    });

    test('for the recorded corpus', async () => {
        const bouts = corpus();
        await persistOrcasound(sql, {upsert: bouts, delete: []});
        // The database sends doubles as 15-digit text (extra_float_digits = 0), which parses
        // to a neighbouring double; ask for the exact one, which is what Postgres holds.
        await sql`SET extra_float_digits = 3`;
        const stored = await sql<{id: string, feed_id: string, feed_name: string, lon: number, lat: number,
                                  started_at: Date, ended_at: Date | null, title: string | null}[]>`
            SELECT id, feed_id, feed_name, gis.st_x(location::gis.geometry) AS lon, gis.st_y(location::gis.geometry) AS lat,
                   started_at, ended_at, title
            FROM public.acoustic_bouts WHERE id LIKE 'bout_TEST%' ORDER BY id`;
        const claims = await sql<{bout_id: string, entity_id: string, certainty: string | null}[]>`
            SELECT bout_id, entity_id, certainty::text AS certainty
            FROM public.acoustic_bout_entities WHERE bout_id LIKE 'bout_TEST%' ORDER BY bout_id, entity_id`;

        const mirrorPath = path.join(dir, 'orcasound.sqlite');
        await writeMirror(mirrorPath, boutRows(bouts));
        const mirror = readMirror(mirrorPath)!;
        expect(existsSync(mirrorPath)).toBe(true);

        // Timestamps as instants: Postgres hands back a Date, the mirror holds orcasite's text.
        // Rows in one order: Postgres sorts these mixed-case ids by its ICU collation, SQLite
        // by bytes.
        const instant = (t: string | Date | null) => t === null ? null : new Date(t).getTime();
        const byKey = <T>(key: (row: T) => string) => (a: T, b: T) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
        const asBouts = (rows: readonly {id: string, started_at: string | Date, ended_at: string | Date | null}[]) =>
            rows.map(b => ({...b, started_at: instant(b.started_at), ended_at: instant(b.ended_at)})).sort(byKey(b => b.id));
        const asClaims = (rows: readonly {bout_id: string, entity_id: string}[]) =>
            rows.map(c => ({...c})).sort(byKey(c => `${c.bout_id} ${c.entity_id}`));
        expect(asBouts(mirror.bouts)).toEqual(asBouts(stored));
        expect(asClaims(mirror.entities)).toEqual(asClaims(claims));
        expect(stored.length).toBe(bouts.length);
        expect(claims.some(c => c.certainty === 'possible')).toBe(true);
    });
});
