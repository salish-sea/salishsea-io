/**
 * Vitest suite for the iNaturalist functional core (salishsea-io-89d.2 / decision 011).
 *
 * Pure unit tests — no DB, no network. `fixtures/inaturalist-observations.json`
 * is real records captured from the live v2 /observations endpoint on 2026-07-05
 * (covering: multiple photos, a photo with null license_code, null
 * public_positional_accuracy, a non-default record license, a record with NO
 * photos, and one crafted record with time_observed_at=null to exercise
 * skipping). `fixtures/inaturalist-taxa.json` is real /taxa records (incl.
 * "Life", parent_id=null).
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
    parseInatResponse,
    parseInatTaxa,
    normalizeTaxon,
    referencedTaxonIds,
    referencedTaxonIdsFromTaxa,
    missingTaxonIds,
    expectedPageCount,
    isPaginationComplete,
    reconcile,
    InatObservationSchema,
    InatTaxonSchema,
    type NormalizedObservation,
    type FetchedPage,
} from './inaturalist.ts';

const obsFixture = JSON.parse(
    readFileSync(path.resolve(__dirname, 'fixtures/inaturalist-observations.json'), 'utf8'),
);
const taxaFixture = JSON.parse(
    readFileSync(path.resolve(__dirname, 'fixtures/inaturalist-taxa.json'), 'utf8'),
);

/** A minimal valid upstream observation, for targeted mutation. */
const rawObs = {
    id: 100,
    description: 'a whale',
    geojson: { type: 'Point', coordinates: [-123.5, 48.2] },
    license_code: 'cc-by-nc',
    time_observed_at: '2026-07-04T13:08:00-07:00',
    uri: 'https://www.inaturalist.org/observations/100',
    public_positional_accuracy: 25,
    updated_at: '2026-07-05T20:08:06-07:00',
    observation_photos: [
        {
            id: 900,
            position: 0,
            photo: {
                id: 9000,
                attribution: '(c) someone',
                hidden: false,
                license_code: 'cc-by-nc',
                original_dimensions: { height: 1365, width: 2048 },
                url: 'https://example.com/photo.jpg',
            },
        },
    ],
    taxon: { id: 41553, ancestor_ids: [48460, 1, 2, 41553] },
    user: { id: 5, login: 'obs_user', name: '', orcid: null },
};

const obs = (over: Partial<NormalizedObservation> = {}): NormalizedObservation => ({
    id: 1, description: null, lon: -123, lat: 48, observedAt: '2026-07-04T13:08:00-07:00',
    licenseCode: 'cc-by-nc', uri: 'https://inat/1', login: 'u', orcid: null, taxonId: 41553,
    ancestorIds: [48460, 1, 41553], publicPositionalAccuracy: null,
    updatedAt: '2026-07-05T20:08:06-07:00', photos: [], ...over,
});

describe('parseInatResponse', () => {
    test('accepts the real fixture and skips the null-time record', () => {
        const r = parseInatResponse(obsFixture);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // fixture has 6 results; exactly one has time_observed_at=null and is skipped
        const skipped = obsFixture.results.filter((x: { time_observed_at: unknown }) => x.time_observed_at == null).length;
        expect(skipped).toBe(1);
        expect(r.observations).toHaveLength(obsFixture.results.length - 1);
        expect(r.recordCount).toBe(obsFixture.results.length); // raw count includes the skipped record
        expect(r.totalResults).toBe(obsFixture.total_results);
        expect(typeof r.totalResults).toBe('number'); // real int, not a string (unlike Maplify's count)
    });

    test('normalizes coordinates as lon/lat, carries the ancestor chain', () => {
        const r = parseInatResponse({ total_results: 1, results: [rawObs] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const o = r.observations[0]!;
        expect(o.lon).toBe(-123.5);
        expect(o.lat).toBe(48.2);
        expect(o.taxonId).toBe(41553);
        expect(o.ancestorIds).toEqual([48460, 1, 2, 41553]);
        expect(o.login).toBe('obs_user');
    });

    test('normalizes a record WITHOUT photos to an empty photo list', () => {
        const r = parseInatResponse({ total_results: 1, results: [{ ...rawObs, observation_photos: [] }] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.observations[0]!.photos).toEqual([]);
    });

    test('accepts an authoritative empty result set (total_results=0)', () => {
        const r = parseInatResponse({ total_results: 0, page: 1, per_page: 200, results: [] });
        expect(r).toMatchObject({ ok: true, observations: [], totalResults: 0, recordCount: 0 });
    });

    test('blank description → null; blank orcid → null; blank photo license → null', () => {
        const raw = {
            ...rawObs,
            description: '   ',
            user: { id: 5, login: 'u', name: '', orcid: '' },
            observation_photos: [{
                ...rawObs.observation_photos[0]!,
                photo: { ...rawObs.observation_photos[0]!.photo, license_code: '' },
            }],
        };
        const r = parseInatResponse({ total_results: 1, results: [raw] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const o = r.observations[0]!;
        expect(o.description).toBeNull();
        expect(o.orcid).toBeNull();
        expect(o.photos[0]!.license).toBeNull();
    });

    test('null public_positional_accuracy normalizes to null', () => {
        const r = parseInatResponse({ total_results: 1, results: [{ ...rawObs, public_positional_accuracy: null }] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.observations[0]!.publicPositionalAccuracy).toBeNull();
    });

    test('rejects a malformed envelope (results not an array)', () => {
        expect(parseInatResponse({ total_results: 0, results: 'nope' }).ok).toBe(false);
    });

    test('rejects the whole response when ANY record is malformed (no silent drop)', () => {
        const bad = { total_results: 2, results: [rawObs, { ...rawObs, id: 2, uri: undefined }] };
        expect(parseInatResponse(bad).ok).toBe(false);
    });

    test('rejects a record whose geojson lacks two coordinates', () => {
        const bad = { total_results: 1, results: [{ ...rawObs, geojson: { coordinates: [-123.5] } }] };
        expect(parseInatResponse(bad).ok).toBe(false);
    });

    test('rejects a record with an unknown license_code (fail-fast, not at persist cast)', () => {
        const bad = { total_results: 1, results: [{ ...rawObs, license_code: 'cc-wtf' }] };
        expect(parseInatResponse(bad).ok).toBe(false);
    });

    test('a null license_code IS allowed (→ null)', () => {
        const r = parseInatResponse({ total_results: 1, results: [{ ...rawObs, license_code: null }] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.observations[0]!.licenseCode).toBeNull();
    });

    test('non-object input does not throw', () => {
        expect(parseInatResponse(null).ok).toBe(false);
        expect(parseInatResponse('nonsense').ok).toBe(false);
    });
});

describe('InatObservationSchema', () => {
    test('accepts every real fixture record (shape validation)', () => {
        for (const r of obsFixture.results) {
            expect(InatObservationSchema.safeParse(r).success).toBe(true);
        }
    });
});

describe('parseInatTaxa / normalizeTaxon', () => {
    test('accepts the real taxa fixture', () => {
        const r = parseInatTaxa(taxaFixture);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.taxa).toHaveLength(taxaFixture.results.length);
    });

    test('maps name→scientificName, preferred_common_name→vernacularName, keeps rank', () => {
        const life = taxaFixture.results.find((t: { id: number }) => t.id === 48460);
        const parsed = InatTaxonSchema.parse(life);
        const n = normalizeTaxon(parsed);
        expect(n.scientificName).toBe('Life');
        expect(n.rank).toBe('stateofmatter');
        expect(n.parentId).toBeNull(); // "Life" has no parent
    });

    test('rejects a taxon with an unknown rank', () => {
        const bad = { total_results: 1, results: [{ id: 1, ancestor_ids: [1], parent_id: null, rank: 'genusoid', name: 'X' }] };
        expect(parseInatTaxa(bad).ok).toBe(false);
    });
});

describe('taxon closure diffs', () => {
    test('referencedTaxonIds unions taxon + ancestors, sorted & deduped', () => {
        const ids = referencedTaxonIds([
            obs({ taxonId: 5, ancestorIds: [1, 2, 5] }),
            obs({ taxonId: 9, ancestorIds: [1, 3, 9] }),
        ]);
        expect(ids).toEqual([1, 2, 3, 5, 9]);
    });

    test('referencedTaxonIdsFromTaxa unions id, parent, ancestors', () => {
        const r = parseInatTaxa(taxaFixture);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ids = referencedTaxonIdsFromTaxa(r.taxa);
        // includes a parent_id that is not itself in the fixture results
        expect(ids).toContain(41707); // parent of Phoca vitulina (41708)
        expect(ids).toContain(48460);
    });

    test('missingTaxonIds returns referenced-not-present, sorted', () => {
        expect(missingTaxonIds([3, 1, 2, 3], [2])).toEqual([1, 3]);
    });

    test('missingTaxonIds empty when everything present (closure resolved)', () => {
        expect(missingTaxonIds([1, 2, 3], [1, 2, 3, 4])).toEqual([]);
    });
});

describe('pagination completeness', () => {
    test('expectedPageCount: empty total needs the one reporting page', () => {
        expect(expectedPageCount(0, 200)).toBe(1);
    });
    test('expectedPageCount: ceil(total/perPage)', () => {
        expect(expectedPageCount(200, 200)).toBe(1);
        expect(expectedPageCount(201, 200)).toBe(2);
        expect(expectedPageCount(1826, 200)).toBe(10);
    });

    const page = (over: Partial<FetchedPage> & { page: number }): FetchedPage => ({
        totalResults: 0, recordCount: 0, ...over,
    });

    test('a single empty page (total=0) is complete and authoritative', () => {
        expect(isPaginationComplete([page({ page: 1, totalResults: 0, recordCount: 0 })], 200)).toBe(true);
    });

    test('all pages present with counts summing to total → complete', () => {
        const pages = [
            page({ page: 1, totalResults: 450, recordCount: 200 }),
            page({ page: 2, totalResults: 450, recordCount: 200 }),
            page({ page: 3, totalResults: 450, recordCount: 50 }),
        ];
        expect(isPaginationComplete(pages, 200)).toBe(true);
    });

    test('a missing final page → incomplete', () => {
        const pages = [
            page({ page: 1, totalResults: 450, recordCount: 200 }),
            page({ page: 2, totalResults: 450, recordCount: 200 }),
        ];
        expect(isPaginationComplete(pages, 200)).toBe(false);
    });

    test('a gap in page numbers → incomplete', () => {
        const pages = [
            page({ page: 1, totalResults: 450, recordCount: 200 }),
            page({ page: 3, totalResults: 450, recordCount: 250 }),
        ];
        expect(isPaginationComplete(pages, 200)).toBe(false);
    });

    test('a duplicated page number → incomplete', () => {
        const pages = [
            page({ page: 1, totalResults: 400, recordCount: 200 }),
            page({ page: 1, totalResults: 400, recordCount: 200 }),
        ];
        expect(isPaginationComplete(pages, 200)).toBe(false);
    });

    test('inconsistent total_results across pages → incomplete', () => {
        const pages = [
            page({ page: 1, totalResults: 400, recordCount: 200 }),
            page({ page: 2, totalResults: 401, recordCount: 200 }),
        ];
        expect(isPaginationComplete(pages, 200)).toBe(false);
    });

    test('record counts that do not sum to total → incomplete', () => {
        const pages = [
            page({ page: 1, totalResults: 450, recordCount: 200 }),
            page({ page: 2, totalResults: 450, recordCount: 200 }),
            page({ page: 3, totalResults: 450, recordCount: 40 }), // 440 != 450
        ];
        expect(isPaginationComplete(pages, 200)).toBe(false);
    });

    test('no pages fetched at all → incomplete', () => {
        expect(isPaginationComplete([], 200)).toBe(false);
    });
});

describe('reconcile', () => {
    test('upserts everything fetched', () => {
        const fetched = [obs({ id: 1 }), obs({ id: 2 })];
        expect(reconcile(fetched, [1, 2]).upsert).toEqual(fetched);
    });
    test('deletes stored ids absent from the fetch', () => {
        expect(reconcile([obs({ id: 1 }), obs({ id: 3 })], [1, 2, 3]).delete).toEqual([2]);
    });
    test('empty fetch over a populated window deletes all of it (caller must guard failure)', () => {
        expect(reconcile([], [10, 11, 12]).delete).toEqual([10, 11, 12]);
    });
    test('empty window yields no deletes', () => {
        expect(reconcile([obs({ id: 1 })], []).delete).toEqual([]);
    });
    test('new ids in the fetch are upserted, not treated as deletes', () => {
        const plan = reconcile([obs({ id: 1 }), obs({ id: 99 })], [1]);
        expect(plan.upsert.map((o) => o.id)).toEqual([1, 99]);
        expect(plan.delete).toEqual([]);
    });
});
