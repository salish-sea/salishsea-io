/**
 * Vitest suite for the Maplify functional core (salishsea-io-89d.1 / decision 011).
 *
 * Pure unit tests — no DB, no network. The `fixtures/maplify-sample.json` file is
 * six real records captured from the live search-all-sightings endpoint on
 * 2026-07-05 (covering blank scientific_name, blank photo_url, 0/1 int booleans,
 * and the excluded `wras` source).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
    parseMaplifyResponse,
    normalizeRecord,
    isIngestable,
    resolveScientificName,
    reconcile,
    MaplifyRecordSchema,
    type NormalizedSighting,
} from './maplify.ts';

const fixture = JSON.parse(
    readFileSync(path.resolve(__dirname, 'fixtures/maplify-sample.json'), 'utf8'),
);

/** A minimal valid upstream record, for targeted mutation in tests. */
const rawRecord = {
    id: 1,
    project_id: 7,
    trip_id: 100,
    name: 'Orca',
    scientific_name: 'Orcinus orca',
    latitude: 48.5,
    longitude: -123.0,
    number_sighted: 3,
    created: '2026-07-05 19:56:00',
    photo_url: '',
    comments: 'seen from shore',
    in_ocean: 1,
    moderated: 1,
    trusted: 0,
    is_test: 0,
    source: 'whale_alert',
    usernm: 'whaleAndroid',
};

const norm = (over: Partial<NormalizedSighting> = {}): NormalizedSighting => ({
    id: 1, projectId: 7, tripId: 100, name: 'Orca', scientificName: 'Orcinus orca',
    lon: -123.0, lat: 48.5, numberSighted: 3, createdAt: '2026-07-05 19:56:00',
    photoUrl: null, comments: 'seen from shore', inOcean: true, moderated: 1,
    trusted: false, isTest: false, source: 'whale_alert', usernm: 'whaleAndroid',
    ...over,
});

describe('parseMaplifyResponse', () => {
    test('accepts the real fixture and normalizes every record', () => {
        const r = parseMaplifyResponse(fixture);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.sightings).toHaveLength(fixture.results.length);
    });

    test('normalizes blank scientific_name and photo_url to null; 0/1 to boolean', () => {
        const r = parseMaplifyResponse(fixture);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const blankSci = r.sightings.find((s) => s.id === 252129);
        expect(blankSci?.scientificName).toBeNull();
        for (const s of r.sightings) {
            expect(typeof s.inOcean).toBe('boolean');
            expect(s.photoUrl === null || s.photoUrl.length > 0).toBe(true);
        }
    });

    test('accepts a successful-but-empty result set (authoritative empty)', () => {
        const r = parseMaplifyResponse({ count: '0', results: [] });
        expect(r).toEqual({ ok: true, sightings: [] });
    });

    test('tolerates the live API string-typed `count` field (regression)', () => {
        // Maplify returns count as a string, e.g. "99"; we ignore it and must not fail.
        const r = parseMaplifyResponse({ count: '99', results: [rawRecord] });
        expect(r.ok).toBe(true);
    });

    test('rejects a malformed envelope (results not an array)', () => {
        const r = parseMaplifyResponse({ results: 'nope' });
        expect(r.ok).toBe(false);
    });

    test('rejects the whole response when ANY record is malformed (no silent drop)', () => {
        const bad = { results: [rawRecord, { ...rawRecord, id: 2, latitude: undefined }] };
        const r = parseMaplifyResponse(bad);
        expect(r.ok).toBe(false);
    });

    test('rejects a record with a non-Maplify timestamp format', () => {
        const bad = { results: [{ ...rawRecord, created: '2026-07-05T19:56:00Z' }] };
        expect(parseMaplifyResponse(bad).ok).toBe(false);
    });

    test('rejects a well-shaped but non-existent calendar date (fail-fast, not at persist)', () => {
        for (const created of ['2026-13-99 25:99:99', '2026-02-30 10:00:00', '2026-00-10 10:00:00']) {
            expect(parseMaplifyResponse({ results: [{ ...rawRecord, created }] }).ok).toBe(false);
        }
        // a real leap-day date is accepted
        expect(parseMaplifyResponse({ results: [{ ...rawRecord, created: '2024-02-29 10:00:00' }] }).ok).toBe(true);
    });

    test('non-object input does not throw', () => {
        expect(parseMaplifyResponse(null).ok).toBe(false);
        expect(parseMaplifyResponse('nonsense').ok).toBe(false);
    });
});

describe('normalizeRecord', () => {
    test('maps upstream snake_case to our shape and coerces 0/1 booleans', () => {
        const parsed = MaplifyRecordSchema.parse(rawRecord);
        expect(normalizeRecord(parsed)).toEqual(norm());
    });

    test('trims whitespace-only strings to null', () => {
        const parsed = MaplifyRecordSchema.parse({ ...rawRecord, comments: '   ', usernm: '' });
        const n = normalizeRecord(parsed);
        expect(n.comments).toBeNull();
        expect(n.usernm).toBeNull();
    });
});

describe('isIngestable', () => {
    test('excludes rwsas and wras, includes everything else', () => {
        expect(isIngestable(norm({ source: 'rwsas' }))).toBe(false);
        expect(isIngestable(norm({ source: 'wras' }))).toBe(false);
        expect(isIngestable(norm({ source: 'whale_alert' }))).toBe(true);
        expect(isIngestable(norm({ source: 'FARPB' }))).toBe(true);
    });
});

describe('resolveScientificName', () => {
    test('prefers the record scientific name', () => {
        expect(resolveScientificName(norm({ scientificName: 'Orcinus orca', name: 'Orca' })))
            .toBe('Orcinus orca');
    });

    test('falls back to the common-name map when scientific name is blank', () => {
        expect(resolveScientificName(norm({ scientificName: null, name: 'California Sea Lion' })))
            .toBe('Zalophus californianus');
    });

    test('returns null when neither resolves', () => {
        expect(resolveScientificName(norm({ scientificName: null, name: 'Blue Whale' }))).toBeNull();
        expect(resolveScientificName(norm({ scientificName: null, name: null }))).toBeNull();
    });
});

describe('reconcile', () => {
    test('upserts everything fetched', () => {
        const fetched = [norm({ id: 1 }), norm({ id: 2 })];
        expect(reconcile(fetched, [1, 2]).upsert).toEqual(fetched);
    });

    test('deletes stored ids absent from the fetch', () => {
        const plan = reconcile([norm({ id: 1 }), norm({ id: 3 })], [1, 2, 3]);
        expect(plan.delete).toEqual([2]);
    });

    test('empty fetch over a populated window deletes all of it (caller must guard failure)', () => {
        expect(reconcile([], [10, 11, 12]).delete).toEqual([10, 11, 12]);
    });

    test('empty window yields no deletes', () => {
        expect(reconcile([norm({ id: 1 })], []).delete).toEqual([]);
    });

    test('new ids in the fetch are upserted, not treated as deletes', () => {
        const plan = reconcile([norm({ id: 1 }), norm({ id: 99 })], [1]);
        expect(plan.upsert.map((s) => s.id)).toEqual([1, 99]);
        expect(plan.delete).toEqual([]);
    });
});
