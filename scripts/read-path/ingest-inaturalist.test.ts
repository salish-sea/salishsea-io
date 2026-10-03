import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { isIngestable, reconcile, type NormalizedObservation, type NormalizedPhoto, type NormalizedTaxon } from '../ingest/inaturalist.ts';
import { persistInaturalist, type IngestWindow } from '../ingest/persist.ts';
import {
    applyFetch, observationRow, openMirror, padded, photoRows, recordSynced, storedTaxonIds, sweepFrom, syncedThrough,
    type ObservationRow, type PhotoRow,
} from './ingest-inaturalist.ts';
import { rolledBack } from './rolled-back.ts';

/** Taxa and observations in ranges no database that mirrors production holds, as persist.test.ts does. */
const taxa: NormalizedTaxon[] = [
    {id: 2000000001, parentId: null, scientificName: 'Testessa radix', vernacularName: null, rank: 'stateofmatter',
     ancestorIds: [2000000001], isActive: true, currentTaxonId: null},
    {id: 2000000002, parentId: 2000000001, scientificName: 'Testus specificus', vernacularName: 'Test Whale', rank: 'species',
     ancestorIds: [2000000001, 2000000002], isActive: true, currentTaxonId: null},
];
const photo = (over: Partial<NormalizedPhoto> & {id: number}): NormalizedPhoto => ({
    seq: 0, attribution: '(c) tester', hidden: false, license: 'cc-by-nc', height: 100, width: 200,
    url: 'https://example.com/p.jpg', ...over,
});
const observation = (over: Partial<NormalizedObservation> & {id: number}): NormalizedObservation => ({
    description: null, lon: -123, lat: 48.5, observedAt: '2026-07-03T10:00:00-07:00', licenseCode: 'cc-by-nc',
    uri: 'https://www.inaturalist.org/observations/x', login: 'test_inat_a', orcid: null, taxonId: 2000000002,
    ancestorIds: [2000000001, 2000000002], publicPositionalAccuracy: 10, updatedAt: '2026-07-05T10:00:00-07:00',
    photos: [], ...over,
});
const WINDOW: IngestWindow = {start: '2026-07-01', end: '2026-07-05'};

const rows = (file: string) => {
    const db = openMirror(file);
    try {
        return {
            observations: db.prepare('SELECT * FROM observations ORDER BY id').all() as unknown as ObservationRow[],
            photos: db.prepare('SELECT * FROM observation_photos ORDER BY id').all() as unknown as PhotoRow[],
            taxa: (db.prepare('SELECT id FROM taxa ORDER BY id').all() as {id: number}[]).map(r => r.id),
            days: (db.prepare('SELECT day FROM covered_days ORDER BY day').all() as {day: string}[]).map(r => r.day),
        };
    } finally {
        db.close();
    }
};

describe('the mirror', () => {
    let dir: string;
    beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'inaturalist-mirror-')); });
    afterAll(async () => { await rm(dir, {recursive: true, force: true}); });
    const fresh = (name: string) => openMirror(path.join(dir, name));

    test('keeps every observation fetched, in scope or not, with its photos and taxa', () => {
        const db = fresh('all.sqlite');
        const californian = observation({id: 9000000001, lon: -122.4, lat: 37.8, photos: [photo({id: 9100000001})]});
        const salish = observation({id: 9000000002});
        expect(isIngestable(californian)).toBe(false);
        expect(applyFetch(db, [californian, salish], taxa, null)).toEqual({written: 2, deleted: 0, taxa: 2});
        db.close();
        const m = rows(path.join(dir, 'all.sqlite'));
        expect(m.observations).toEqual([californian, salish].map(observationRow));
        expect(m.photos).toEqual(photoRows(californian));
        expect(m.taxa).toEqual([2000000001, 2000000002]);
    });

    test('rewrites an observation only when upstream changed it since, and replaces its photos', () => {
        const db = fresh('newer.sqlite');
        applyFetch(db, [observation({id: 9000000003, photos: [photo({id: 9100000003}), photo({id: 9100000004, seq: 1})]})], taxa, null);
        const stale = observation({id: 9000000003, description: 'an older copy', updatedAt: '2026-07-04T10:00:00-07:00'});
        expect(applyFetch(db, [stale], [], null).written).toBe(0);
        const edited = observation({id: 9000000003, description: 'edited', updatedAt: '2026-07-06T10:00:00-07:00',
                                    photos: [photo({id: 9100000004})]});
        expect(applyFetch(db, [edited], [], null).written).toBe(1);
        db.close();
        const m = rows(path.join(dir, 'newer.sqlite'));
        expect(m.observations[0]!.description).toBe('edited');
        expect(m.photos.map(p => p.id)).toEqual([9100000004]);
    });

    test('a window deletes what upstream no longer returns on its own days, and only those', () => {
        const db = fresh('window.sqlite');
        const inside = observation({id: 9000000005, observedAt: '2026-07-03T10:00:00-07:00', photos: [photo({id: 9100000005})]});
        const lastEvening = observation({id: 9000000006, observedAt: '2026-07-05T23:30:00Z'});
        const dayAfter = observation({id: 9000000007, observedAt: '2026-07-06T00:30:00Z'});
        applyFetch(db, [inside, lastEvening, dayAfter], taxa, null);
        // The window's fetch (a day wider each end) returned none of them.
        expect(padded(WINDOW)).toEqual({start: '2026-06-30', end: '2026-07-06'});
        expect(applyFetch(db, [], [], WINDOW)).toEqual({written: 0, deleted: 2, taxa: 0});
        db.close();
        const m = rows(path.join(dir, 'window.sqlite'));
        expect(m.observations.map(o => o.id)).toEqual([9000000007]);
        expect(m.photos).toEqual([]);
        expect(m.days).toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']);
    });

    test('taxa are only ever added', () => {
        const db = fresh('taxa.sqlite');
        applyFetch(db, [], taxa, null);
        const renamed = {...taxa[1]!, vernacularName: 'Renamed'};
        expect(applyFetch(db, [], [renamed], null).taxa).toBe(0);
        expect(storedTaxonIds(db, [2000000002, 2000000099])).toEqual([2000000002]);
        db.close();
    });

    test('remembers the newest change it has seen, and never goes back', () => {
        const db = fresh('sync.sqlite');
        expect(syncedThrough(db)).toBeNull();
        recordSynced(db, [observation({id: 1, updatedAt: '2026-07-05T10:00:00-07:00'}),
                          observation({id: 2, updatedAt: '2026-07-05T18:00:00Z'})]);
        expect(syncedThrough(db)).toBe('2026-07-05T18:00:00Z');
        recordSynced(db, [observation({id: 3, updatedAt: '2026-07-01T00:00:00Z'})]);
        recordSynced(db, []);
        expect(syncedThrough(db)).toBe('2026-07-05T18:00:00Z');
        db.close();
    });

    test('a sweep starts an hour before its checkpoint, so a change committed late is still found', () => {
        expect(sweepFrom('2026-07-05T18:00:00Z', new Date('2026-07-06T00:00:00Z'))).toBe('2026-07-05T17:00:00.000Z');
        expect(sweepFrom('2026-07-05T10:00:00-07:00', new Date())).toBe('2026-07-05T16:00:00.000Z');
        expect(sweepFrom(null, new Date('2026-07-31T12:00:00Z'))).toBe('2026-07-01');
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

// The guarantee the live report can't give: for the same fetch, the mirror's in-scope
// observations and photos are what Postgres's ingest stores. Written inside a transaction
// that is always rolled back (rolled-back.ts), so no other test file sees them.
describe.skipIf(!DSN)('the mirror stores what Postgres stores (local Supabase)', () => {
    let sql: ReturnType<typeof postgres>;
    let dir: string;
    beforeAll(async () => {
        sql = postgres(DSN as string, {max: 1});
        dir = await mkdtemp(path.join(tmpdir(), 'inaturalist-equivalence-'));
    });
    afterAll(async () => {
        await sql.end();
        await rm(dir, {recursive: true, force: true});
    });

    test('for one fetch', async () => {
        const fetched = [
            observation({id: 9000000011, description: 'two photos', photos: [photo({id: 9100000011}), photo({id: 9100000012, seq: 1, license: null, height: null, width: null})]}),
            observation({id: 9000000012, lon: -122.4, lat: 37.8}),   // California, not an orca: out of scope
            observation({id: 9000000013, login: 'test_inat_b', orcid: 'https://orcid.org/0000-0002-1825-0097', publicPositionalAccuracy: null, licenseCode: null}),
        ];
        const stored = await rolledBack(sql, async (nested, tx) => {
            // Postgres's ingest, as the Supabase function runs it: the parse drops what is out of scope.
            await persistInaturalist(nested, {taxa, plan: reconcile(fetched.filter(isIngestable), []), window: WINDOW});
            await tx`SET LOCAL extra_float_digits = 3`;
            return {
                observations: [...await tx`
                    SELECT CAST(o.id AS bigint)::float8 AS id, o.description,
                           gis.st_x(o.location::gis.geometry) AS lon, gis.st_y(o.location::gis.geometry) AS lat,
                           extract(epoch from o.observed_at)::float8 * 1000 AS observed_ms, o.license_code::text AS license_code,
                           o.uri, o.username AS login, c.orcid, o.taxon_id, o.public_positional_accuracy
                    FROM inaturalist.observations o LEFT JOIN public.contributors c ON c.id = o.contributor_id
                    WHERE o.id >= 9000000000 AND o.id < 9000010000 ORDER BY o.id`],
                photos: [...await tx`
                    SELECT CAST(id AS bigint)::float8 AS id, CAST(observation_id AS bigint)::float8 AS observation_id, seq,
                           attribution, hidden::int AS hidden, license::text AS license,
                           (original_dimensions).height AS height, (original_dimensions).width AS width, url
                    FROM inaturalist.observation_photos WHERE observation_id >= 9000000000 AND observation_id < 9000010000
                    ORDER BY id`],
            };
        });

        const file = path.join(dir, 'inaturalist.sqlite');
        const db = openMirror(file);
        applyFetch(db, fetched, taxa, null);
        db.close();
        const m = rows(file);
        const inScope = m.observations.filter(o => isIngestable(
            {lon: o.lon, lat: o.lat, taxonId: o.taxon_id, ancestorIds: JSON.parse(o.ancestor_ids)} as unknown as NormalizedObservation));
        expect(inScope.map(o => ({
            id: o.id, description: o.description, lon: o.lon, lat: o.lat, observed_ms: o.observed_ms,
            license_code: o.license_code, uri: o.uri, login: o.login, orcid: o.orcid, taxon_id: o.taxon_id,
            public_positional_accuracy: o.public_positional_accuracy,
        }))).toEqual(stored.observations.map(r => ({...r})));
        expect(m.photos.filter(p => inScope.some(o => o.id === p.observation_id))).toEqual(stored.photos.map(r => ({...r})));
        expect(stored.observations).toHaveLength(2);
    });
});
