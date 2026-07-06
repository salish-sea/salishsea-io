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
import {
    persistMaplify,
    persistInaturalist,
    fetchExistingTaxonIds,
    fetchObservationWindowIds,
    type IngestWindow,
} from './persist.ts';
import type { NormalizedSighting, ReconcilePlan } from './maplify.ts';
import type {
    NormalizedObservation,
    NormalizedPhoto,
    NormalizedTaxon,
    ObservationReconcilePlan,
} from './inaturalist.ts';

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

    test('persists a record with a blank scientific_name (NOT NULL mirror column, taxon null)', async () => {
        // Real Maplify data includes records with scientific_name '' (e.g. "Blue Whale").
        const res = await persistMaplify(sql, plan({
            upsert: [sighting({ id: 900105, scientificName: '', name: 'Blue Whale' })],
        }), WINDOW);
        expect(res.upserted).toBe(1);
        const [row] = await sql`select scientific_name, taxon_id from maplify.sightings where id = 900105`;
        expect(row?.['scientific_name']).toBe(''); // stored verbatim, no NOT NULL violation
        expect(row?.['taxon_id']).toBeNull();       // 'Blue Whale' not in the fallback map
    });

    test('dry run reports would-be counts but writes nothing', async () => {
        const res = await persistMaplify(sql, plan({ upsert: [sighting({ id: 900301 })] }), WINDOW, { dryRun: true });
        expect(res.upserted).toBe(1);
        const rows = await sql`select id from maplify.sightings where id = 900301`;
        expect(rows.count).toBe(0);
    });
});

/**
 * Integration suite for the iNaturalist persist layer (salishsea-io-89d.2 / 011).
 *
 * Reserved bands (all cleaned in afterEach): observations/photos 9_000_000_000+
 * (well above real iNat ids ~3.8e8), taxa 2_000_000_000+ (within int4), and
 * contributors with an inat_login prefixed 'test_inat'. Proves: taxa+observation+
 * photo upsert with contributor minting and provider/collection defaults; the
 * updated_at freshness guard; per-observation photo reconciliation bounded to the
 * fetched observations; and the window-bounded observation DELETE (the data-loss
 * regression lock, mirroring the Maplify assertion).
 */
describe.skipIf(!DSN)('persistInaturalist (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });
    afterEach(async () => {
        await sql`delete from inaturalist.observation_photos where observation_id >= 9000000000 and observation_id < 9000010000`;
        await sql`delete from inaturalist.observations where id >= 9000000000 and id < 9000010000`;
        await sql`delete from inaturalist.taxa where id >= 2000000000 and id < 2000001000`;
        await sql`delete from public.contributors where inat_login like 'test_inat%'`;
    });

    const testTaxa: NormalizedTaxon[] = [
        { id: 2000000001, parentId: null, scientificName: 'Testessa radix', vernacularName: null, rank: 'stateofmatter', ancestorIds: [2000000001] },
        { id: 2000000002, parentId: 2000000001, scientificName: 'Testus specificus', vernacularName: 'Test Whale', rank: 'species', ancestorIds: [2000000001, 2000000002] },
    ];

    const photo = (over: Partial<NormalizedPhoto> & { id: number }): NormalizedPhoto => ({
        seq: 0, attribution: '(c) tester', hidden: false, license: 'cc-by-nc',
        height: 100, width: 200, url: 'https://example.com/p.jpg', ...over,
    });
    const observation = (over: Partial<NormalizedObservation> & { id: number }): NormalizedObservation => ({
        description: null, lon: -123, lat: 48, observedAt: '2026-07-03T10:00:00-07:00',
        licenseCode: 'cc-by-nc', uri: 'https://www.inaturalist.org/observations/x',
        login: 'test_inat_a', orcid: null, taxonId: 2000000002,
        ancestorIds: [2000000001, 2000000002], publicPositionalAccuracy: 10,
        updatedAt: '2026-07-05T10:00:00-07:00', photos: [], ...over,
    });
    const iplan = (over: Partial<ObservationReconcilePlan> = {}): ObservationReconcilePlan =>
        ({ upsert: [], delete: [], ...over });

    test('upserts taxa + observation + photos, mints contributor, applies provider/collection defaults', async () => {
        const res = await persistInaturalist(sql, {
            taxa: testTaxa,
            plan: iplan({ upsert: [observation({ id: 9000000001, photos: [photo({ id: 9100000001, seq: 0 }), photo({ id: 9100000002, seq: 1 })] })] }),
            window: WINDOW,
        });
        expect(res.taxaUpserted).toBe(2);
        expect(res.observationsUpserted).toBe(1);
        expect(res.photosUpserted).toBe(2);

        const [o] = await sql`select provider_id, collection_id, contributor_id, taxon_id from inaturalist.observations where id = 9000000001`;
        expect(o?.['provider_id']).toBe(3);       // iNaturalist provider DEFAULT
        expect(o?.['collection_id']).toBe(8);     // iNaturalist collection DEFAULT
        expect(Number(o?.['taxon_id'])).toBe(2000000002);
        expect(o?.['contributor_id']).not.toBeNull();

        const [c] = await sql`select inat_login from public.contributors where id = ${o?.['contributor_id'] as number}`;
        expect(c?.['inat_login']).toBe('test_inat_a');

        const photos = await sql`select id from inaturalist.observation_photos where observation_id = 9000000001`;
        expect(photos.count).toBe(2);
    });

    test('is idempotent and honors the updated_at freshness guard', async () => {
        await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [observation({ id: 9000000002, description: 'first', updatedAt: '2026-07-05T10:00:00-07:00' })] }), window: WINDOW });
        // newer updated_at → overwrites
        await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [observation({ id: 9000000002, description: 'second', updatedAt: '2026-07-06T10:00:00-07:00' })] }), window: WINDOW });
        const rows = await sql`select description from inaturalist.observations where id = 9000000002`;
        expect(rows.count).toBe(1);
        expect(rows[0]?.['description']).toBe('second');
        // older updated_at → stale, must NOT overwrite
        await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [observation({ id: 9000000002, description: 'stale', updatedAt: '2026-07-04T10:00:00-07:00' })] }), window: WINDOW });
        const rows2 = await sql`select description from inaturalist.observations where id = 9000000002`;
        expect(rows2[0]?.['description']).toBe('second');
    });

    test('reconciles photos per-observation, bounded to the fetched observations', async () => {
        // obs A has photos p1,p2; obs B (separate) has photo p9 that must never be touched
        await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [
            observation({ id: 9000000010, photos: [photo({ id: 9100000010 }), photo({ id: 9100000011 })] }),
            observation({ id: 9000000020, photos: [photo({ id: 9100000090 })] }),
        ] }), window: WINDOW });

        // re-fetch obs A with p1 kept, p3 new (p2 gone). obs B is NOT in this batch.
        const res = await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [
            observation({ id: 9000000010, updatedAt: '2026-07-06T10:00:00-07:00', photos: [photo({ id: 9100000010 }), photo({ id: 9100000012 })] }),
        ] }), window: WINDOW });
        expect(res.photosDeleted).toBe(1); // only p2 (9100000011)

        const aPhotos = await sql`select id from inaturalist.observation_photos where observation_id = 9000000010 order by id`;
        expect(aPhotos.map((r) => Number(r['id']))).toEqual([9100000010, 9100000012]);

        // obs B's photo untouched — reconcile did not reach an observation absent from the batch
        const bPhotos = await sql`select id from inaturalist.observation_photos where observation_id = 9000000020`;
        expect(bPhotos.count).toBe(1);
    });

    test('collapses a photo id shared across two observations in one batch (last-wins, no ON CONFLICT crash)', async () => {
        // iNaturalist attaches the same photo id to more than one observation; a
        // single bulk upsert must dedupe or Postgres raises "ON CONFLICT DO UPDATE
        // command cannot affect row a second time" (found in a live 2026 run).
        const res = await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [
            observation({ id: 9000000070, photos: [photo({ id: 9100000070 })] }),
            observation({ id: 9000000071, photos: [photo({ id: 9100000070 })] }), // same photo id
        ] }), window: WINDOW });
        expect(res.photosUpserted).toBe(1); // collapsed to a single row

        const rows = await sql`select observation_id from inaturalist.observation_photos where id = 9100000070`;
        expect(rows.count).toBe(1);
        expect(Number(rows[0]?.['observation_id'])).toBe(9000000071); // last occurrence wins
    });

    test('reconcile observation DELETE is window-bounded — an out-of-window id is NOT deleted', async () => {
        await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [
            observation({ id: 9000000030, observedAt: '2026-07-03T10:00:00-07:00' }), // in window
            observation({ id: 9000000031, observedAt: '2026-06-01T10:00:00-07:00' }), // a month before
        ] }), window: WINDOW });

        // caller passes BOTH ids to delete; the window guard must spare 9000000031
        const res = await persistInaturalist(sql, { taxa: [], plan: iplan({ delete: [9000000030, 9000000031] }), window: WINDOW });
        expect(res.observationsDeleted).toBe(1);

        const survivors = await sql`select id from inaturalist.observations where id in (9000000030, 9000000031)`;
        expect(survivors.map((r) => Number(r['id']))).toEqual([9000000031]);
    });

    test('deletes an observation together with its photos (FK-safe order)', async () => {
        await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [
            observation({ id: 9000000060, photos: [photo({ id: 9100000060 }), photo({ id: 9100000061 })] }),
        ] }), window: WINDOW });
        const res = await persistInaturalist(sql, { taxa: [], plan: iplan({ delete: [9000000060] }), window: WINDOW });
        expect(res.observationsDeleted).toBe(1);
        expect(res.photosDeleted).toBe(2);
        const left = await sql`select id from inaturalist.observation_photos where observation_id = 9000000060`;
        expect(left.count).toBe(0);
    });

    test('fetchExistingTaxonIds returns only the ids already present', async () => {
        await persistInaturalist(sql, { taxa: testTaxa, plan: iplan(), window: WINDOW });
        const present = await fetchExistingTaxonIds(sql, [2000000001, 2000000002, 2000000999]);
        expect([...present].sort((a, b) => a - b)).toEqual([2000000001, 2000000002]);
    });

    test('fetchObservationWindowIds returns in-window ids and excludes out-of-window ones', async () => {
        await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [
            observation({ id: 9000000050, observedAt: '2026-07-03T10:00:00-07:00' }),
            observation({ id: 9000000051, observedAt: '2026-06-01T10:00:00-07:00' }),
        ] }), window: WINDOW });
        const ids = await fetchObservationWindowIds(sql, WINDOW);
        expect(ids).toContain(9000000050);
        expect(ids).not.toContain(9000000051);
    });

    test('dry run exercises constraints, reports would-be counts, writes nothing', async () => {
        const res = await persistInaturalist(sql, {
            taxa: testTaxa,
            plan: iplan({ upsert: [observation({ id: 9000000040, photos: [photo({ id: 9100000040 })] })] }),
            window: WINDOW,
        }, { dryRun: true });
        expect(res.taxaUpserted).toBe(2);
        expect(res.observationsUpserted).toBe(1);
        expect(res.photosUpserted).toBe(1);

        const obsRows = await sql`select id from inaturalist.observations where id = 9000000040`;
        expect(obsRows.count).toBe(0);
        const taxaRows = await sql`select id from inaturalist.taxa where id = 2000000001`;
        expect(taxaRows.count).toBe(0);
    });
});
