/**
 * Integration suite for the Maplify persist layer (salishsea-io-89d.1 / decision 011).
 *
 * Runs the REAL persist SQL against a local Supabase Postgres, gated on
 * SUPABASE_DB_URL (set by build.yml in CI; skips on a fresh checkout). Tests use
 * a reserved id band (900000..909999, source 'test') and afterEach removes it, so
 * the suite leaves the seeded database as it found it.
 *
 * Central assertion: the reconcile DELETE is window-bounded — an out-of-window id
 * passed in the delete list is NOT deleted. This is the regression lock on the
 * data-loss class (salishsea-io-t4v) expressed against the code that runs.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { persistMaplify, type IngestWindow } from './persist.ts';
import type { NormalizedSighting, ReconcilePlan } from './maplify.ts';

const DSN = process.env['SUPABASE_DB_URL'];
const WINDOW: IngestWindow = { start: '2026-07-01', end: '2026-07-05' };

const sighting = (over: Partial<NormalizedSighting> & { id: number }): NormalizedSighting => ({
    projectId: 7, tripId: 1, name: 'Orca', scientificName: 'Orcinus orca',
    lon: -123.0, lat: 48.5, numberSighted: 3, createdAt: '2026-07-03 10:00:00',
    photoUrl: null, comments: null, inOcean: true, moderated: 1, trusted: false,
    isTest: false, source: 'test', usernm: 'u', ...over,
});

const plan = (over: Partial<ReconcilePlan> = {}): ReconcilePlan => ({ upsert: [], delete: [], ...over });

describe.skipIf(!DSN)('persistMaplify (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });
    afterEach(async () => { await sql`delete from maplify.sightings where id >= 900000 and id < 910000`; });

    test('inserts new sightings and resolves collection + taxon at persist time', async () => {
        const res = await persistMaplify(sql, plan({
            upsert: [
                sighting({ id: 900101, comments: '[Orca Network] pod of 3' }),
                sighting({ id: 900102, comments: 'Submitted by a Whale Alert Global Trusted Observer' }),
            ],
        }), WINDOW);
        expect(res.upserted).toBe(2);

        const [orcaNet] = await sql`select collection_id, taxon_id from maplify.sightings where id = 900101`;
        expect(orcaNet?.['collection_id']).toBe(1);   // [Orca Network] bracket → collection 1
        expect(orcaNet?.['taxon_id']).toBe(41521);    // Orcinus orca → taxa 41521

        const [whaleAlert] = await sql`select collection_id from maplify.sightings where id = 900102`;
        expect(whaleAlert?.['collection_id']).toBe(6); // Whale Alert Global attribution → collection 6
    });

    test('is idempotent — upserting the same batch twice leaves one row, updated', async () => {
        await persistMaplify(sql, plan({ upsert: [sighting({ id: 900103, numberSighted: 2 })] }), WINDOW);
        await persistMaplify(sql, plan({ upsert: [sighting({ id: 900103, numberSighted: 9 })] }), WINDOW);
        const rows = await sql`select number_sighted from maplify.sightings where id = 900103`;
        expect(rows.count).toBe(1);
        expect(rows[0]?.['number_sighted']).toBe(9);
    });

    test('on re-ingest, refreshes upstream in_ocean but preserves resolved collection_id (D-07)', async () => {
        // first ingest: [Orca Network] bracket → collection 1, in_ocean true
        await persistMaplify(sql, plan({
            upsert: [sighting({ id: 900104, comments: '[Orca Network] pod', inOcean: true })],
        }), WINDOW);
        // re-ingest same id with a comment that would resolve to a DIFFERENT collection,
        // and a flipped in_ocean.
        await persistMaplify(sql, plan({
            upsert: [sighting({ id: 900104, comments: 'Submitted by a Whale Alert Global Trusted Observer', inOcean: false })],
        }), WINDOW);
        const [row] = await sql`select collection_id, in_ocean from maplify.sightings where id = 900104`;
        expect(row?.['collection_id']).toBe(1);    // preserved — NOT re-resolved to 6
        expect(row?.['in_ocean']).toBe(false);     // refreshed from the new fetch
    });

    test('reconcile DELETE is window-bounded — an out-of-window id is NOT deleted', async () => {
        // 900201 in window; 900202 a month before the window
        await sql`insert into maplify.sightings (id, project_id, trip_id, scientific_name, location, number_sighted, created_at, in_ocean, moderated, trusted, is_test, source)
                  values (900201, 7, 1, 'Orcinus orca', gis.ST_Point(-123,48)::gis.geography, 1, '2026-07-03 10:00', true, 0, false, false, 'test'),
                         (900202, 7, 1, 'Orcinus orca', gis.ST_Point(-123,48)::gis.geography, 1, '2026-06-01 10:00', true, 0, false, false, 'test')`;

        // caller passes BOTH ids to delete; the window guard must spare 900202
        const res = await persistMaplify(sql, plan({ delete: [900201, 900202] }), WINDOW);
        expect(res.deleted).toBe(1);

        const survivors = await sql`select id from maplify.sightings where id in (900201, 900202)`;
        expect(survivors.map((r) => r['id'])).toEqual([900202]);
    });

    test('dry run reports would-be counts but writes nothing', async () => {
        const res = await persistMaplify(sql, plan({ upsert: [sighting({ id: 900301 })] }), WINDOW, { dryRun: true });
        expect(res.upserted).toBe(1);
        const rows = await sql`select id from maplify.sightings where id = 900301`;
        expect(rows.count).toBe(0);
    });
});
