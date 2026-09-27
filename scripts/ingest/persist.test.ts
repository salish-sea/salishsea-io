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
    fetchNameIndex,
    persistInaturalist,
    persistOrcasound,
    fetchExistingTaxonIds,
    fetchObservationWindowIds,
    fetchAcousticBoutIds,
    type IngestWindow,
} from './persist.ts';
import type { NormalizedSighting, ReconcilePlan } from './maplify.ts';
import type { BoutEntity, NormalizedBout, ReconcilePlan as BoutReconcilePlan } from './orcasound.ts';
import { buildNameIndex } from '../register/name-index.ts';
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

/**
 * A constructed edition, so these tests do not depend on a register being loaded (CI loads
 * none). Resolution itself is maplify.test.ts's subject; here it only has to reach the row.
 */
const taxon = (entity_id: string, name: string, taxon_label: string) =>
    ({ entity_id, name, kind: 'taxon', retired: false, taxon_label });
const INDEX = buildNameIndex([
    taxon('SSA:0000900', 'Orcinus orca', 'Orcinus orca'),
    taxon('SSA:0000900', 'Orca', 'Orcinus orca'),
    taxon('SSA:0000999', 'Balaenoptera musculus', 'Balaenoptera musculus'),
    taxon('SSA:0000999', 'Blue whale', 'Balaenoptera musculus'),
]);

describe.skipIf(!DSN)('persistMaplify (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });
    afterEach(async () => { await sql`delete from maplify.sightings where id >= 900000 and id < 910000`; });

    test('inserts new sightings and resolves collection + entity at persist time', async () => {
        const res = await persistMaplify(sql, plan({
            upsert: [
                sighting({ id: 900101, comments: '[Orca Network] pod of 3' }),
                sighting({ id: 900102, comments: 'Submitted by a Whale Alert Global Trusted Observer' }),
            ],
        }), WINDOW, INDEX);
        expect(res.upserted).toBe(2);

        const [orcaNet] = await sql`select collection_id, entity_id from maplify.sightings where id = 900101`;
        expect(orcaNet?.['collection_id']).toBe(1);          // [Orca Network] bracket → collection 1
        expect(orcaNet?.['entity_id']).toBe('SSA:0000900');  // Orcinus orca → the register's entity

        const [whaleAlert] = await sql`select collection_id from maplify.sightings where id = 900102`;
        expect(whaleAlert?.['collection_id']).toBe(6); // Whale Alert Global attribution → collection 6
    });

    test('is idempotent — upserting the same batch twice leaves one row, updated', async () => {
        await persistMaplify(sql, plan({ upsert: [sighting({ id: 900103, numberSighted: 2 })] }), WINDOW, INDEX);
        await persistMaplify(sql, plan({ upsert: [sighting({ id: 900103, numberSighted: 9 })] }), WINDOW, INDEX);
        const rows = await sql`select number_sighted from maplify.sightings where id = 900103`;
        expect(rows.count).toBe(1);
        expect(rows[0]?.['number_sighted']).toBe(9);
    });

    test('an identical re-ingest writes nothing — and so broadcasts nothing (salish-xfo)', async () => {
        // Maplify returns the whole window every five minutes. Rewriting rows that
        // have not changed is what fired the occurrences_changed trigger on every
        // quiet tick; the guard on the upsert is what keeps it quiet.
        const batch = plan({ upsert: [sighting({ id: 900107, comments: 'same' }), sighting({ id: 900108 })] });
        const first = await persistMaplify(sql, batch, WINDOW, INDEX);
        expect(first.upserted).toBe(2);
        const before = await sql`select id, xmin::text as xmin from maplify.sightings where id in (900107, 900108) order by id`;

        const again = await persistMaplify(sql, batch, WINDOW, INDEX);
        expect(again.upserted).toBe(0);
        // xmin is the writing transaction's id: unchanged means no row was rewritten.
        const after = await sql`select id, xmin::text as xmin from maplify.sightings where id in (900107, 900108) order by id`;
        expect(after).toEqual(before);

        // A changed field still gets through, and only that row counts.
        const changed = await persistMaplify(sql, plan({ upsert: [sighting({ id: 900107, comments: 'different' }), sighting({ id: 900108 })] }), WINDOW, INDEX);
        expect(changed.upserted).toBe(1);
    });

    test('on re-ingest, refreshes upstream in_ocean but preserves resolved collection_id (D-07)', async () => {
        // first ingest: [Orca Network] bracket → collection 1, in_ocean true
        await persistMaplify(sql, plan({
            upsert: [sighting({ id: 900104, comments: '[Orca Network] pod', inOcean: true })],
        }), WINDOW, INDEX);
        // re-ingest same id with a comment that would resolve to a DIFFERENT collection,
        // and a flipped in_ocean.
        await persistMaplify(sql, plan({
            upsert: [sighting({ id: 900104, comments: 'Submitted by a Whale Alert Global Trusted Observer', inOcean: false })],
        }), WINDOW, INDEX);
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
        const res = await persistMaplify(sql, plan({ delete: [900201, 900202] }), WINDOW, INDEX);
        expect(res.deleted).toBe(1);

        const survivors = await sql`select id from maplify.sightings where id in (900201, 900202)`;
        expect(survivors.map((r) => r['id'])).toEqual([900202]);
    });

    test('persists a record with a blank scientific_name and resolves its entity from the name', async () => {
        // Real Maplify data includes records with scientific_name '' (e.g. "Blue Whale").
        // The blank must round-trip verbatim — the mirror column is NOT NULL — while the
        // entity still resolves from the common name (salish-7jl).
        const res = await persistMaplify(sql, plan({
            upsert: [sighting({ id: 900105, scientificName: '', name: 'Blue Whale' })],
        }), WINDOW, INDEX);
        expect(res.upserted).toBe(1);
        const [row] = await sql`select scientific_name, entity_id from maplify.sightings where id = 900105`;
        expect(row?.['scientific_name']).toBe(''); // stored verbatim, no NOT NULL violation
        expect(row?.['entity_id']).toBe('SSA:0000999');
    });

    test('leaves the entity null when the name asserts no identification', async () => {
        // The counterpart to the test above: 'Unspecified' is not a register name, so
        // nothing is guessed at.
        await persistMaplify(sql, plan({
            upsert: [sighting({ id: 900106, scientificName: 'N/A', name: 'Unspecified' })],
        }), WINDOW, INDEX);
        const [row] = await sql`select scientific_name, entity_id from maplify.sightings where id = 900106`;
        expect(row?.['scientific_name']).toBe('N/A'); // upstream placeholder, mirrored verbatim
        expect(row?.['entity_id']).toBeNull();
    });

    test('a tick with an empty register index does not un-name a record whose names are unchanged', async () => {
        await persistMaplify(sql, plan({ upsert: [sighting({ id: 900109 })] }), WINDOW, INDEX);
        const EMPTY = buildNameIndex([]);
        const again = await persistMaplify(sql, plan({ upsert: [sighting({ id: 900109 })] }), WINDOW, EMPTY);
        expect(again.upserted).toBe(0); // nothing changed, so nothing was rewritten
        const [kept] = await sql`select entity_id from maplify.sightings where id = 900109`;
        expect(kept?.['entity_id']).toBe('SSA:0000900');

        // The same when another field changes in the same tick, so the row IS rewritten.
        await persistMaplify(sql, plan({ upsert: [sighting({ id: 900109, numberSighted: 7 })] }), WINDOW, EMPTY);
        const [recounted] = await sql`select entity_id, number_sighted from maplify.sightings where id = 900109`;
        expect(recounted?.['number_sighted']).toBe(7);
        expect(recounted?.['entity_id']).toBe('SSA:0000900');

        // A changed name is a new claim: it takes the new answer, even an empty one.
        await persistMaplify(sql, plan({ upsert: [sighting({ id: 900109, name: 'Something else' , scientificName: '' })] }), WINDOW, EMPTY);
        const [changed] = await sql`select entity_id from maplify.sightings where id = 900109`;
        expect(changed?.['entity_id']).toBeNull();
    });

    test('dry run reports would-be counts but writes nothing', async () => {
        const res = await persistMaplify(sql, plan({ upsert: [sighting({ id: 900301 })] }), WINDOW, INDEX, { dryRun: true });
        expect(res.upserted).toBe(1);
        const rows = await sql`select id from maplify.sightings where id = 900301`;
        expect(rows.count).toBe(0);
    });
});

describe.skipIf(!DSN)('fetchNameIndex (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });

    class Rollback extends Error {}

    test('reads labels and every name type, skips retired entities and individuals, and knows each entity\'s taxon', async () => {
        // Its own register rows, rolled back: CI loads no edition. Ids far above anything
        // the register mints.
        let index: Awaited<ReturnType<typeof fetchNameIndex>> | undefined;
        await sql.begin(async (tx) => {
            await tx`INSERT INTO register.entities (entity_id, kind, rank, label) VALUES
                ('SSA:9900201', 'taxon', 'species', 'Testus maximus'),
                ('SSA:9900202', 'group', 'ecotype', 'Test ecotype'),
                ('SSA:9900203', 'taxon', 'species', 'Testus obsoletus'),
                ('SSA:9900204', 'individual', NULL, 'T999')`;
            await tx`INSERT INTO register.ancestor (entity_id, ancestor_id, depth, ancestor_kind)
                     VALUES ('SSA:9900202', 'SSA:9900201', 1, 'taxon')`;
            await tx`INSERT INTO register.names (entity_id, name, type, language) VALUES
                ('SSA:9900201', 'Test whale', 'common', 'en'),
                ('SSA:9900201', 'Testie', 'hidden', 'en'),
                ('SSA:9900201', 'Testus antiquus', 'historical', 'en'),
                ('SSA:9900204', 'Testie the whale', 'common', 'en')`;
            await tx`INSERT INTO register.deprecations (entity_id, replaced_by, reason)
                     VALUES ('SSA:9900203', 'SSA:9900201', 'merge')`;
            index = await fetchNameIndex(tx as unknown as Sql);
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });

        const at = (name: string) => [...(index!.byFold.get(name) ?? [])];
        expect(at('testus maximus')).toEqual(['SSA:9900201']);   // the label
        expect(at('test whale')).toEqual(['SSA:9900201']);       // common
        expect(at('testie')).toEqual(['SSA:9900201']);           // hidden
        expect(at('testus antiquus')).toEqual(['SSA:9900201']);  // historical
        expect(at('testus obsoletus')).toEqual([]);              // retired: never an answer
        expect(at('testie the whale')).toEqual([]);              // an individual is not a taxon name
        expect(index!.taxonLabel.get('SSA:9900202')).toBe('Testus maximus');
    });
});

describe.skipIf(!DSN)('the ingest role can do what the Maplify tick does (local Supabase)', () => {
    // The Edge Function connects as the least-privilege `ingest` role, not postgres. Every
    // other test here runs as postgres, which is how a tick that could not read the register
    // reached production (2026-09-22). NOINHERIT and no grants beyond its own: SET ROLE
    // inside a rolled-back transaction is exactly its view of the database.
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });

    class Rollback extends Error {}

    test('reads the register and writes entity_id', async () => {
        // persistMaplify opens its own transaction, which cannot nest inside this one, so
        // this does its two privileged steps directly: build the index, write the column.
        let names = -1;
        await sql.begin(async (tx) => {
            // postgres created `ingest`, so it may grant itself membership; the rollback undoes it.
            await tx`GRANT ingest TO postgres`;
            await tx`SET LOCAL ROLE ingest`;
            names = (await fetchNameIndex(tx as unknown as Sql)).byFold.size;
            await tx`INSERT INTO maplify.sightings (id, project_id, trip_id, scientific_name, location,
                         number_sighted, created_at, in_ocean, moderated, trusted, is_test, source, entity_id)
                     VALUES (900401, 7, 1, 'Orcinus orca', gis.ST_Point(-123, 48)::gis.geography, 1,
                             '2026-07-03 10:00', true, 0, false, false, 'test', 'SSA:0000900')`;
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
        expect(names).toBeGreaterThanOrEqual(0);
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
        { id: 2000000001, parentId: null, scientificName: 'Testessa radix', vernacularName: null, rank: 'stateofmatter', ancestorIds: [2000000001], isActive: true, currentTaxonId: null },
        { id: 2000000002, parentId: 2000000001, scientificName: 'Testus specificus', vernacularName: 'Test Whale', rank: 'species', ancestorIds: [2000000001, 2000000002], isActive: true, currentTaxonId: null },
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

    test('an identical re-ingest rewrites no photo (salish-xfo)', async () => {
        // Every fetch returns every photo of every observation in the window, and
        // until the guard on the photo upsert each one was rewritten each tick.
        const input = {
            taxa: testTaxa,
            plan: iplan({ upsert: [observation({ id: 9000000004, photos: [photo({ id: 9100000041 }), photo({ id: 9100000042, seq: 1 })] })] }),
            window: WINDOW,
        };
        await persistInaturalist(sql, input);
        const before = await sql`select id, xmin::text as xmin from inaturalist.observation_photos where observation_id = 9000000004 order by id`;

        const again = await persistInaturalist(sql, input);
        expect(again.photosUpserted).toBe(0);
        expect(again.photosDeleted).toBe(0);
        const after = await sql`select id, xmin::text as xmin from inaturalist.observation_photos where observation_id = 9000000004 order by id`;
        expect(after).toEqual(before);

        // A photo that did change is still written, and is the only one counted.
        const changed = await persistInaturalist(sql, {
            ...input,
            plan: iplan({ upsert: [observation({ id: 9000000004, photos: [photo({ id: 9100000041, hidden: true }), photo({ id: 9100000042, seq: 1 })] })] }),
        });
        expect(changed.photosUpserted).toBe(1);
    });

    // salish-5ds. A retired taxon and its replacement arrive in one batch, and
    // current_taxon_id's FK is NOT DEFERRABLE (unlike parent_id's) — so this also pins
    // that an immediate FK is satisfied by a row inserted in the SAME statement.
    test('records a retired taxon flagged and repointed, alongside its replacement', async () => {
        const replacement: NormalizedTaxon = {
            id: 2000000003, parentId: 2000000001, scientificName: 'Testus renamed',
            vernacularName: 'Test Whale', rank: 'species',
            ancestorIds: [2000000001, 2000000003], isActive: true, currentTaxonId: null,
        };
        const retired: NormalizedTaxon = { ...testTaxa[1]!, isActive: false, currentTaxonId: 2000000003 };

        const res = await persistInaturalist(sql, {
            taxa: [testTaxa[0]!, retired, replacement],
            plan: iplan({ upsert: [observation({ id: 9000000003 })] }),
            window: WINDOW,
        });
        expect(res.taxaUpserted).toBe(3);

        const [t] = await sql`select is_active, current_taxon_id from inaturalist.taxa where id = 2000000002`;
        expect(t?.['is_active']).toBe(false);
        expect(Number(t?.['current_taxon_id'])).toBe(2000000003);

        // The observation still sits on the retired taxon. The ingest records the
        // retirement; public.occurrences resolves it on read (decision 032).
        const [o] = await sql`select taxon_id from inaturalist.observations where id = 9000000003`;
        expect(Number(o?.['taxon_id'])).toBe(2000000002);
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

    // iNat dates an observation by the observer's local day; observed_at is the
    // UTC instant. 6 pm Pacific on June 30 is 01:00 UTC on July 1 — inside a
    // [start, end + 1) bound, outside a d1=2026-07-01 fetch, and so deleted by
    // the old reconcile (salish-34s). The window's first and last UTC days are
    // therefore never reconciled: only the interior is.
    test('a window never reconciles its edge days, so a local-date straddler survives', async () => {
        await persistInaturalist(sql, { taxa: testTaxa, plan: iplan({ upsert: [
            observation({ id: 9000000080, observedAt: '2026-06-30T18:00:00-07:00', photos: [photo({ id: 9100000080 })] }), // 2026-07-01T01:00Z
            observation({ id: 9000000081, observedAt: '2026-07-05T10:00:00-07:00' }), // the end day
            observation({ id: 9000000082, observedAt: '2026-07-02T00:30:00Z', photos: [photo({ id: 9100000082 })] }), // interior
        ] }), window: WINDOW });
        const ids = await fetchObservationWindowIds(sql, WINDOW);
        expect(ids).not.toContain(9000000080);
        expect(ids).not.toContain(9000000081);
        expect(ids).toContain(9000000082);

        const res = await persistInaturalist(sql, { taxa: [], plan: iplan({ delete: [9000000080, 9000000081, 9000000082] }), window: WINDOW });
        expect(res.observationsDeleted).toBe(1);
        expect(res.photosDeleted).toBe(1);
        const survivors = await sql`select id from inaturalist.observations where id in (9000000080, 9000000081, 9000000082) order by id`;
        expect(survivors.map((r) => Number(r['id']))).toEqual([9000000080, 9000000081]);
        // The straddler keeps its photo: the photo delete uses the same interior bound.
        const photos = await sql`select id from inaturalist.observation_photos where id in (9100000080, 9100000082) order by id`;
        expect(photos.map((r) => Number(r['id']))).toEqual([9100000080]);
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

// =========================================================================
// Orcasound (salish-8vr.26). Reserved id band: bout_TEST…, cleaned in afterEach.
// =========================================================================

const nbout = (over: Partial<NormalizedBout> & { id: string }): NormalizedBout => ({
    feedId: 'feed_TEST', feedName: 'Test Lab', lon: -123.17, lat: 48.56,
    startedAt: '2026-09-01T10:00:00.000000Z', endedAt: '2026-09-01T10:30:00.000000Z',
    title: 'a test bout', category: 'biophony', entities: [], ...over,
});
const bplan = (over: Partial<BoutReconcilePlan> = {}): BoutReconcilePlan => ({ upsert: [], delete: [], ...over });
const ent = (entityId: string, certainty: BoutEntity['certainty'] = null): BoutEntity => ({ entityId, certainty });

describe.skipIf(!DSN)('persistOrcasound (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });
    afterEach(async () => { await sql`DELETE FROM public.acoustic_bouts WHERE id LIKE 'bout_TEST%'`; });

    const stored = async () => sql<{ id: string; title: string | null; ended_at: Date | null }[]>`
        SELECT id, title, ended_at FROM public.acoustic_bouts WHERE id LIKE 'bout_TEST%' ORDER BY id`;
    const entities = async (id: string) => (await sql<{ entity_id: string }[]>`
        SELECT entity_id FROM public.acoustic_bout_entities WHERE bout_id = ${id} ORDER BY entity_id`).map((r) => r.entity_id);

    test('inserts bouts with their cited entities, under the Orcasound provider and collection', async () => {
        const r = await persistOrcasound(sql, bplan({ upsert: [
            nbout({ id: 'bout_TESTa', entities: [ent('SSA:9900001'), ent('SSA:9900020')] }),
            nbout({ id: 'bout_TESTb', endedAt: null, title: null }),
        ] }));
        expect(r).toEqual({ upserted: 2, deleted: 0, entitiesAdded: 2, entitiesRevised: 0, entitiesRemoved: 0 });
        const rows = await stored();
        expect(rows.map((x) => x.id)).toEqual(['bout_TESTa', 'bout_TESTb']);
        expect(rows[1]!.ended_at).toBeNull();
        expect(await entities('bout_TESTa')).toEqual(['SSA:9900001', 'SSA:9900020']);
        const [prov] = await sql<{ p: string; c: string }[]>`
            SELECT prov.slug AS p, col.slug AS c FROM public.acoustic_bouts b
            JOIN public.providers prov ON prov.id = b.provider_id
            JOIN public.collections col ON col.id = b.collection_id WHERE b.id = 'bout_TESTa'`;
        expect(prov).toEqual({ p: 'orcasound', c: 'orcasound' });
    });

    test('rewrites nothing when nothing changed, and only what changed otherwise', async () => {
        const same = bplan({ upsert: [nbout({ id: 'bout_TESTa' }), nbout({ id: 'bout_TESTb' })] });
        await persistOrcasound(sql, same);
        expect(await persistOrcasound(sql, same)).toEqual({ upserted: 0, deleted: 0, entitiesAdded: 0, entitiesRevised: 0, entitiesRemoved: 0 });
        const r = await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTa', title: 'renamed' }), nbout({ id: 'bout_TESTb' })] }));
        expect(r.upserted).toBe(1);
        expect((await stored())[0]!.title).toBe('renamed');
    });

    test('replaces a bout\'s entities with what its tags cite now — the path a tag gaining an iri takes', async () => {
        await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTa', entities: [ent('SSA:9900001')] })] }));
        const r = await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTa', entities: [ent('SSA:9900020'), ent('SSA:9900021')] })] }));
        expect(r).toEqual({ upserted: 0, deleted: 0, entitiesAdded: 2, entitiesRevised: 0, entitiesRemoved: 1 });
        expect(await entities('bout_TESTa')).toEqual(['SSA:9900020', 'SSA:9900021']);
    });

    test('a revised certainty updates the claim in place, and an unchanged one is left alone (054)', async () => {
        await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTa', entities: [ent('SSA:9900001'), ent('SSA:9900020', 'certain')] })] }));
        const r = await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTa', entities: [ent('SSA:9900001', 'possible'), ent('SSA:9900020', 'certain')] })] }));
        expect(r).toEqual({ upserted: 0, deleted: 0, entitiesAdded: 0, entitiesRevised: 1, entitiesRemoved: 0 });
        const rows = await sql<{ entity_id: string; certainty: string | null }[]>`
            SELECT entity_id, certainty FROM public.acoustic_bout_entities WHERE bout_id = 'bout_TESTa' ORDER BY entity_id`;
        expect(rows).toEqual([{ entity_id: 'SSA:9900001', certainty: 'possible' }, { entity_id: 'SSA:9900020', certainty: 'certain' }]);
    });

    test('deletes reconciled bouts, and their entities go with them', async () => {
        await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTa', entities: [ent('SSA:9900001')] }), nbout({ id: 'bout_TESTb' })] }));
        const r = await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTb' })], delete: ['bout_TESTa', 'bout_TESTnever'] }));
        expect(r.deleted).toBe(1);
        expect((await stored()).map((x) => x.id)).toEqual(['bout_TESTb']);
        expect(await entities('bout_TESTa')).toEqual([]);
    });

    test('dry run reports would-be counts and writes nothing', async () => {
        await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTa' })] }));
        const r = await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTc' })], delete: ['bout_TESTa'] }), { dryRun: true });
        expect(r).toEqual({ upserted: 1, deleted: 1, entitiesAdded: 0, entitiesRevised: 0, entitiesRemoved: 0 });
        expect((await stored()).map((x) => x.id)).toEqual(['bout_TESTa']);
    });

    test('fetchAcousticBoutIds is the whole corpus', async () => {
        await persistOrcasound(sql, bplan({ upsert: [nbout({ id: 'bout_TESTa' }), nbout({ id: 'bout_TESTb' })] }));
        const ids = await fetchAcousticBoutIds(sql);
        expect(ids).toEqual(expect.arrayContaining(['bout_TESTa', 'bout_TESTb']));
    });
});

describe.skipIf(!DSN)('the ingest role can do what the Orcasound tick does (local Supabase)', () => {
    // Same reason as the Maplify role test above: the tables have RLS on and the role is
    // NOINHERIT, so a missing grant or policy is invisible to every test that runs as postgres.
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });

    class Rollback extends Error {}

    test('reads the corpus, resolves the provider and collection, writes a bout and its entities', async () => {
        let seen: string[] = [];
        let provider: number | null = null;
        await sql.begin(async (tx) => {
            await tx`GRANT ingest TO postgres`;
            await tx`SET LOCAL ROLE ingest`;
            seen = await fetchAcousticBoutIds(tx as unknown as Sql);
            const [p] = await tx<{ id: number }[]>`SELECT id FROM public.providers WHERE slug = 'orcasound'`;
            provider = p?.id ?? null;
            await tx`INSERT INTO public.acoustic_bouts (id, feed_id, feed_name, location, started_at, ended_at, title, provider_id, collection_id)
                     VALUES ('bout_TESTrole', 'feed_TEST', 'Test Lab', gis.ST_Point(-123, 48)::gis.geography, '2026-09-01T10:00:00Z', NULL, NULL,
                             (SELECT id FROM public.providers WHERE slug = 'orcasound'),
                             (SELECT id FROM public.collections WHERE slug = 'orcasound'))`;
            await tx`INSERT INTO public.acoustic_bout_entities (bout_id, entity_id) VALUES ('bout_TESTrole', 'SSA:9900001')`;
            await tx`DELETE FROM public.acoustic_bout_entities WHERE bout_id = 'bout_TESTrole'`;
            await tx`DELETE FROM public.acoustic_bouts WHERE id = 'bout_TESTrole'`;
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
        expect(Array.isArray(seen)).toBe(true);
        expect(provider).not.toBeNull();
    });
});
