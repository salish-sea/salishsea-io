import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { isIngestable, type NormalizedIdentification, type NormalizedObservation, type NormalizedPhoto, type NormalizedTaxon } from '../ingest/inaturalist.ts';
import type { IngestWindow } from '../ingest/window.ts';
import {
    applyFetch, backfillIds, commentRows, danglingTaxonIds, dueTaxa, identificationRows, observationRow, openMirror, padded, photoRows,
    recordBackfilled, recordSynced, refreshTaxa, REFRESH_PER_RUN, storedTaxonIds, sweepFrom, syncedThrough,
    type CommentRow, type IdentificationRow, type ObservationRow, type PhotoRow,
} from './ingest-inaturalist.ts';

/** Taxa and observations in ranges no production mirror holds, as Postgres's ingest tests used. */
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
const identification = (over: Partial<NormalizedIdentification> & {id: number}): NormalizedIdentification => ({
    userId: 7, login: 'test_identifier', orcid: null, taxonId: 2000000002, createdAt: '2026-07-04T09:00:00-07:00',
    current: true, ownObservation: false, disagreement: false, hidden: false, vision: false, body: null, ...over,
});
const observation = (over: Partial<NormalizedObservation> & {id: number}): NormalizedObservation => ({
    description: null, lon: -123, lat: 48.5, observedAt: '2026-07-03T10:00:00-07:00', licenseCode: 'cc-by-nc',
    uri: 'https://www.inaturalist.org/observations/x', login: 'test_inat_a', orcid: null, taxonId: 2000000002,
    ancestorIds: [2000000001, 2000000002], publicPositionalAccuracy: 10, updatedAt: '2026-07-05T10:00:00-07:00',
    photos: [], identifications: [], comments: [], qualityMetrics: [], annotations: [], ...over,
});
const WINDOW: IngestWindow = {start: '2026-07-01', end: '2026-07-05'};

const rows = (file: string) => {
    const db = openMirror(file);
    try {
        return {
            observations: db.prepare('SELECT * FROM observations ORDER BY id').all() as unknown as ObservationRow[],
            photos: db.prepare('SELECT * FROM observation_photos ORDER BY id').all() as unknown as PhotoRow[],
            identifications: db.prepare('SELECT * FROM identifications ORDER BY id').all() as unknown as IdentificationRow[],
            comments: db.prepare('SELECT * FROM comments ORDER BY id').all() as unknown as CommentRow[],
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

    test('rewrites an observation whose photo was re-licensed, though its updated_at stayed put', () => {
        const db = fresh('relicensed.sqlite');
        const before = observation({id: 9000000020, photos: [photo({id: 9100000020, license: 'cc0', attribution: 'no rights reserved'})]});
        applyFetch(db, [before], taxa, null);
        expect(applyFetch(db, [before], [], null).written).toBe(0);
        const after = {...before, photos: [photo({id: 9100000020, license: 'cc-by', attribution: '(c) tester, some rights reserved (CC BY)'})]};
        expect(applyFetch(db, [after], [], null).written).toBe(1);
        db.close();
        expect(rows(path.join(dir, 'relicensed.sqlite')).photos[0]!.license).toBe('cc-by');
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

    test('keeps who identified an observation as what, and replaces them when they change', () => {
        const db = fresh('identifications.sqlite');
        const own = identification({id: 9200000001, userId: 5, login: 'test_inat_a', ownObservation: true, disagreement: null});
        const first = observation({id: 9000000030, identifications: [own, identification({id: 9200000002})]});
        applyFetch(db, [first], taxa, null);
        expect(applyFetch(db, [first], [], null).written).toBe(0);
        // The second identifier withdraws theirs (no longer current) and a third disagrees,
        // naming a taxon the mirror doesn't hold; iNaturalist moves updated_at for both.
        const later = {...first, updatedAt: '2026-07-06T10:00:00-07:00', identifications: [own,
            identification({id: 9200000002, current: false}),
            identification({id: 9200000003, userId: 8, login: 'test_other', taxonId: 2000000099, disagreement: true, vision: true})]};
        expect(applyFetch(db, [later], [], null).written).toBe(1);
        db.close();
        const m = rows(path.join(dir, 'identifications.sqlite'));
        expect(m.identifications).toEqual(identificationRows(later));
        expect(m.identifications.map(i => [i.id, i.current, i.disagreement])).toEqual(
            [[9200000001, 1, null], [9200000002, 0, 0], [9200000003, 1, 1]]);
    });

    test('keeps the comments on an observation, and picks up a new one whenever the observation is fetched again', () => {
        const db = fresh('comments.sqlite');
        const comment = {id: 9300000001, userId: 9, login: 'test_commenter', orcid: null, body: 'Seen from the ferry too',
                         createdAt: '2026-07-04T15:00:00-07:00', hidden: false};
        const first = observation({id: 9000000032, comments: [comment]});
        applyFetch(db, [first], taxa, null);
        // a comment doesn't move iNaturalist's updated_at, so the copy that carries it looks no newer
        const later = {...first, comments: [comment, {...comment, id: 9300000002, body: 'T49As, I think'}]};
        expect(applyFetch(db, [later], [], null).written).toBe(1);
        db.close();
        expect(rows(path.join(dir, 'comments.sqlite')).comments).toEqual(commentRows(later));
    });

    test('an observation fetched again gains the identifications it was mirrored without', () => {
        const db = fresh('gains.sqlite');
        const bare = observation({id: 9000000031});
        applyFetch(db, [bare], taxa, null);
        // the same upstream copy, now asked with identifications: same updated_at
        expect(applyFetch(db, [{...bare, identifications: [identification({id: 9200000010})]}], [], null).written).toBe(1);
        db.close();
        expect(rows(path.join(dir, 'gains.sqlite')).identifications.map(i => i.id)).toEqual([9200000010]);
    });

    test('a mirror from before the votes were kept gains them when an observation is fetched again', () => {
        const file = path.join(dir, 'votes.sqlite');
        const old = openMirror(file);
        const bare = observation({id: 9000000035});
        applyFetch(old, [bare], taxa, null);
        // a mirror that old had no annotations either (salish-1y8)
        old.exec('ALTER TABLE observations DROP COLUMN annotations; ALTER TABLE observations DROP COLUMN quality_metrics');
        old.close();
        const db = openMirror(file);
        expect(rows(file).observations[0]!.quality_metrics).toBeNull();
        // the same upstream copy, same updated_at, now asked with its votes
        const captive = {...bare, qualityMetrics: [{id: 2, metric: 'wild', agree: false}, {id: 1, metric: 'wild', agree: true}]};
        expect(applyFetch(db, [captive], [], null).written).toBe(1);
        expect(applyFetch(db, [captive], [], null).written).toBe(0);
        db.close();
        expect(JSON.parse(rows(file).observations[0]!.quality_metrics!)).toEqual(
            [{id: 1, metric: 'wild', agree: true}, {id: 2, metric: 'wild', agree: false}]);
    });

    test('a mirror from before annotations were kept gains them when an observation is fetched again', () => {
        const file = path.join(dir, 'annotations.sqlite');
        const old = openMirror(file);
        const bare = observation({id: 9000000036});
        applyFetch(old, [bare], taxa, null);
        old.exec('ALTER TABLE observations DROP COLUMN annotations');
        old.close();
        const db = openMirror(file);
        expect(rows(file).observations[0]!.annotations).toBeNull();
        // the same upstream copy, same updated_at, now asked with its annotations
        const dead = {...bare, annotations: [
            {uuid: 'b', attribute: 22, value: 24, voteScore: 0}, {uuid: 'a', attribute: 17, value: 19, voteScore: 1}]};
        expect(applyFetch(db, [dead], [], null).written).toBe(1);
        expect(applyFetch(db, [dead], [], null).written).toBe(0);
        db.close();
        expect(JSON.parse(rows(file).observations[0]!.annotations!)).toEqual(
            [{uuid: 'a', attribute: 17, value: 19, voteScore: 1}, {uuid: 'b', attribute: 22, value: 24, voteScore: 0}]);
    });

    test('the backfill asks about observations without identifications, a page at a time, never the same twice', () => {
        const db = fresh('backfill.sqlite');
        const ided = observation({id: 9000000041, identifications: [identification({id: 9200000041})]});
        applyFetch(db, [observation({id: 9000000040}), ided, observation({id: 9000000042}), observation({id: 9000000043})], taxa, null);
        expect(backfillIds(db, 2)).toEqual([9000000040, 9000000042]);
        // 9000000040 came back with its identifications; 9000000042 didn't come back at all
        applyFetch(db, [observation({id: 9000000040, identifications: [identification({id: 9200000040})]})], [], null);
        recordBackfilled(db, [9000000040, 9000000042]);
        expect(backfillIds(db, 2)).toEqual([9000000043]);
        recordBackfilled(db, [9000000043]);
        expect(backfillIds(db, 2)).toEqual([]);
        db.close();
    });

    test('a window deletes what upstream no longer returns on its own days, and only those', () => {
        const db = fresh('window.sqlite');
        const inside = observation({id: 9000000005, observedAt: '2026-07-03T10:00:00-07:00', photos: [photo({id: 9100000005})],
                                    identifications: [identification({id: 9200000005})],
                                    comments: [{id: 9300000005, userId: 9, login: 'c', orcid: null, body: 'x',
                                                createdAt: '2026-07-03T11:00:00-07:00', hidden: false}]});
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
        expect(m.identifications).toEqual([]);
        expect(m.comments).toEqual([]);
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

    // The rolling refresh (salish-xv35.9.3): what Postgres's weekly job did, a few taxa a run.
    test('a taxon is asked about again after a week, the longest-unchecked first, a request\'s worth at a time', () => {
        const db = fresh('due.sqlite');
        const day = 86_400_000;
        const t0 = new Date('2026-10-04T12:00:00Z');
        applyFetch(db, [], taxa, null, new Date(t0.getTime() - 8 * day));          // checked eight days ago
        const many = Array.from({length: REFRESH_PER_RUN + 5}, (_, i) => ({
            ...taxa[1]!, id: 2000000100 + i, parentId: 2000000001, ancestorIds: [2000000001, 2000000100 + i]}));
        applyFetch(db, [], many, null, new Date(t0.getTime() - 10 * day));         // ten days ago
        db.prepare('UPDATE taxa SET checked_at = NULL WHERE id = ?').run(2000000002); // never
        expect(dueTaxa(db, new Date(t0.getTime() - 9 * day))).toEqual([2000000002],
        ); // a day before the others expire, only the never-checked one is due
        const due = dueTaxa(db, t0);
        expect(due).toHaveLength(REFRESH_PER_RUN);
        expect(due.slice(0, 2)).toEqual([2000000002, 2000000100]); // never-checked, then oldest
        expect(due).not.toContain(2000000001);                     // the eight-day-old one waits its turn
        db.close();
    });

    test('a refresh rewrites what upstream changed, marks every taxon asked, and names a new parent to fetch', () => {
        const db = fresh('refresh.sqlite');
        const t0 = new Date('2026-10-04T12:00:00Z');
        applyFetch(db, [], taxa, null, new Date(t0.getTime() - 8 * 86_400_000));
        const asked = [2000000001, 2000000002];
        // 2 was retired in favour of 3 (not held), 1 came back unchanged
        const answered = [
            taxa[0]!,
            {...taxa[1]!, isActive: false, currentTaxonId: 2000000003},
            {...taxa[1]!, id: 2000000999}, // not one we hold: the closure's business, ignored here
        ];
        const {changed, missing} = refreshTaxa(db, asked, answered, t0);
        expect(changed).toEqual([2000000002]);
        expect(missing).toEqual([2000000003]);
        const row = (id: number) => db.prepare('SELECT is_active, current_taxon_id, checked_at FROM taxa WHERE id = ?').get(id);
        expect(row(2000000002)).toEqual({is_active: 0, current_taxon_id: 2000000003, checked_at: t0.toISOString()});
        expect(row(2000000001)).toEqual({is_active: 1, current_taxon_id: null, checked_at: t0.toISOString()});
        expect(storedTaxonIds(db, [2000000999])).toEqual([]);
        expect(dueTaxa(db, t0)).toEqual([]);
        // until the closure fetches the replacement, the mirror points at nothing — and says so
        expect(danglingTaxonIds(db)).toEqual([2000000003]);
        applyFetch(db, [], [{...taxa[1]!, id: 2000000003, ancestorIds: [2000000001, 2000000003]}], null, t0);
        expect(danglingTaxonIds(db)).toEqual([]);
        db.close();
    });

    test("a taxon only someone's identification names is one to fetch, so its ancestry is known", () => {
        const db = fresh('identified.sqlite');
        applyFetch(db, [observation({id: 1, identifications: [identification({id: 11, taxonId: 2000000004})]})], taxa, null);
        expect(danglingTaxonIds(db)).toEqual([2000000004]);
        applyFetch(db, [], [{...taxa[1]!, id: 2000000004, ancestorIds: [2000000001, 2000000004]}], null);
        expect(danglingTaxonIds(db)).toEqual([]);
        db.close();
    });

    test('a mirror from before the refresh gains its checked_at column, with every taxon due', () => {
        const file = path.join(dir, 'old.sqlite');
        const old = new DatabaseSync(file);
        old.exec(`CREATE TABLE taxa (id INTEGER PRIMARY KEY, parent_id INTEGER, scientific_name TEXT NOT NULL,
                  vernacular_name TEXT, rank TEXT NOT NULL, is_active INTEGER NOT NULL, current_taxon_id INTEGER);
                  INSERT INTO taxa VALUES (2000000001, NULL, 'Testessa radix', NULL, 'stateofmatter', 1, NULL)`);
        old.close();
        const db = openMirror(file);
        expect(dueTaxa(db, new Date())).toEqual([2000000001]);
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

// The guarantee the live report can't give: for the same fetch, the mirror's in-scope
// observations and photos are what Postgres's ingest stored. What it stored for this fetch
// was captured before Postgres retired (salish-9uu.11): fixtures/twins/ingest-inaturalist.json.
describe('the mirror stores what Postgres stored', () => {
    let dir: string;
    beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'inaturalist-equivalence-')); });
    afterAll(async () => { await rm(dir, {recursive: true, force: true}); });

    test('for one fetch', async () => {
        const fetched = [
            observation({id: 9000000011, description: 'two photos', photos: [photo({id: 9100000011}), photo({id: 9100000012, seq: 1, license: null, height: null, width: null})]}),
            observation({id: 9000000012, lon: -122.4, lat: 37.8}),   // California, not an orca: out of scope
            observation({id: 9000000013, login: 'test_inat_b', orcid: 'https://orcid.org/0000-0002-1825-0097', publicPositionalAccuracy: null, licenseCode: null}),
        ];
        const stored = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/twins/ingest-inaturalist.json'), 'utf8')) as
            {observations: Record<string, unknown>[], photos: Record<string, unknown>[]};

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
