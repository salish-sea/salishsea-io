/**
 * Vitest suite for the iNaturalist functional core (salishsea-io-89d.2 / decision 011).
 *
 * Pure unit tests — no DB, no network. `fixtures/inaturalist-observations.json`
 * is real records captured from the live v2 /observations endpoint on 2026-07-05
 * (covering: multiple photos, a photo with null license_code, null
 * public_positional_accuracy, a non-default record license, a record with NO
 * photos, and one crafted record with time_observed_at=null to exercise
 * skipping). `fixtures/inaturalist-taxa.json` is real /taxa records fetched by the
 * `/taxa/{ids}` path form on 2026-08-29 (incl. "Life", parent_id=null, and the
 * retired Sagmatias obliquidens 1368491 with its replacement 1664971 — salish-5ds).
 */

import { describe, test, expect } from 'vitest';
import { acartiaExtent } from '../../src/extents.ts';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
    parseInatResponse,
    parseInatTaxa,
    normalizeTaxon,
    referencedTaxonIds,
    referencedTaxonIdsFromTaxa,
    missingTaxonIds,
    FETCH_BBOX,
    isEpochZeroObservedAt,
    isIngestable,
    isKillerWhale,
    ORCINUS_TAXON_ID,
    isTerminalPage,
    isPaginationComplete,
    reconcile,
    InatObservationSchema,
    InatTaxonSchema,
    type NormalizedObservation,
    type NormalizedTaxon,
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

/** A minimal valid upstream taxon, for targeted mutation. */
const rawTaxon = (over: Record<string, unknown> = {}) => ({
    id: 1, ancestor_ids: [1], parent_id: null, rank: 'species', name: 'Testus specificus',
    preferred_common_name: 'Test Whale', is_active: true, current_synonymous_taxon_ids: null,
    ...over,
});

/** A minimal normalized taxon, for the closure diffs. */
const taxon = (over: Partial<NormalizedTaxon> = {}): NormalizedTaxon => ({
    id: 1, parentId: null, scientificName: 'Testus specificus', vernacularName: null,
    rank: 'species', ancestorIds: [1], isActive: true, currentTaxonId: null, ...over,
});

describe('isEpochZeroObservedAt', () => {
    test('every time zone\'s rendering of the zero instant is the same artifact', () => {
        expect(isEpochZeroObservedAt('1969-12-31T16:00:00-08:00')).toBe(true); // Pacific: reads 1969
        expect(isEpochZeroObservedAt('1970-01-01T00:00:00+00:00')).toBe(true);
        expect(isEpochZeroObservedAt('1970-01-01T09:00:00+09:00')).toBe(true); // Tokyo: reads 1970
    });

    test('a real date near the epoch is kept — the cut is equality, not a floor', () => {
        expect(isEpochZeroObservedAt('1970-01-01T00:00:01+00:00')).toBe(false);
        expect(isEpochZeroObservedAt('1969-12-31T23:59:59+00:00')).toBe(false);
        expect(isEpochZeroObservedAt('1965-06-23T12:00:00-08:00')).toBe(false); // Namu, hypothetically
        expect(isEpochZeroObservedAt('1976-02-01T00:00:00-08:00')).toBe(false); // the real earliest we hold
    });

    test('an unparseable string is not the artifact (NaN !== 0); the schema owns that', () => {
        expect(isEpochZeroObservedAt('not a date')).toBe(false);
    });
});

test('the fetch box is the Acartia box, by reference and not by literal', () => {
    // It was called SALISH_SEA_BBOX until decision 044, which is not what it is and
    // had already misled 036's first draft. The corners must keep matching the one
    // definition in src/extents.ts, which the Maplify fetch reads too.
    const [swLng, swLat, neLng, neLat] = acartiaExtent;
    expect(FETCH_BBOX).toEqual({ swLng, swLat, neLng, neLat });
    expect(FETCH_BBOX).toEqual({ swLng: -136, swLat: 36, neLng: -120, neLat: 54 });
});

describe('isKillerWhale / isIngestable (decision 044)', () => {
    const OUTSIDE = { lon: -122.411, lat: 37.811 };   // Pier 39, San Francisco
    const INSIDE = { lon: -123.0, lat: 48.5 };        // Haro Strait
    const NORTH = { lon: -126.8, lat: 50.55 };        // Telegraph Cove, Johnstone Strait

    test('the genus catches the species and every subspecies, without naming them', () => {
        // Ancestry is root->self, so a record filed AT the genus has Orcinus last
        // rather than interior. Both spellings are the same animal.
        expect(isKillerWhale(obs({ taxonId: 41521, ancestorIds: [48460, 41520, 41521] }))).toBe(true);
        expect(isKillerWhale(obs({ taxonId: 1602531, ancestorIds: [48460, 41520, 41521, 1602531] }))).toBe(true);
        expect(isKillerWhale(obs({ taxonId: 1602533, ancestorIds: [48460, 41520, 41521, 1602533] }))).toBe(true);
        expect(isKillerWhale(obs({ taxonId: ORCINUS_TAXON_ID, ancestorIds: [48460, ORCINUS_TAXON_ID] }))).toBe(true);
    });

    test('a blue whale is not a killer whale, and neither is a bare Delphinidae', () => {
        expect(isKillerWhale(obs({ taxonId: 41553, ancestorIds: [48460, 41546, 41547, 41553] }))).toBe(false);
        expect(isKillerWhale(obs({ taxonId: 41479, ancestorIds: [48460, 41479] }))).toBe(false); // the family above Orcinus
    });

    test('a genus record with an ancestry that omits self is still caught', () => {
        // ancestor_ids is self-inclusive in every record we have seen, so this
        // guard is belt to the includes check's braces — but it is the one shape
        // that would silently drop an orca.
        expect(isKillerWhale(obs({ taxonId: ORCINUS_TAXON_ID, ancestorIds: [] }))).toBe(true);
    });

    test('inside the Salish Sea, everything is in scope', () => {
        expect(isIngestable(obs({ ...INSIDE, taxonId: 41553 }))).toBe(true); // blue whale
        expect(isIngestable(obs({ ...INSIDE, taxonId: 41740 }))).toBe(true); // California sea lion
    });

    test('outside it, only killer whales are', () => {
        expect(isIngestable(obs({ ...OUTSIDE, taxonId: 41740 }))).toBe(false); // the Pier 39 sea lions
        expect(isIngestable(obs({ ...OUTSIDE, taxonId: 41521, ancestorIds: [41520, 41521] }))).toBe(true);
    });

    test('the northern edge is a real cost, and it falls where 036 put it', () => {
        // Johnstone Strait is outside salishSeaExtent on both bounds. Northern
        // Resident orcas there are kept; every other animal beside them is not.
        expect(isIngestable(obs({ ...NORTH, taxonId: 41521, ancestorIds: [41520, 41521] }))).toBe(true);
        expect(isIngestable(obs({ ...NORTH, taxonId: 41553 }))).toBe(false);
    });

    test('the box edges are inclusive, as extentContains is', () => {
        for (const [lon, lat] of [[-126, 47], [-122, 50.5], [-126, 50.5], [-122, 47]] as const) {
            expect(isIngestable(obs({ lon, lat, taxonId: 41740 })), `${lon},${lat}`).toBe(true);
        }
    });
});

describe('parseInatResponse', () => {
    test('the real fixture is entirely out of scope — every record is Californian', () => {
        // Not a contrived case. This fixture is one arbitrary page of the live feed,
        // captured 2026-07-05, and all six records are between 36.6N and 37.8N: two
        // at Pier 39 and the Bay, the rest down the San Mateo and Monterey coast.
        // Decision 044 is what that page looks like as a rule, so the whole page
        // drops and the counters still have to add up.
        const r = parseInatResponse(obsFixture);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.observations).toHaveLength(0);
        expect(r.recordCount).toBe(obsFixture.results.length); // every skip still counted
        expect(r.totalResults).toBe(obsFixture.total_results);
        expect(typeof r.totalResults).toBe('number'); // real int, not a string (unlike Maplify's count)
        expect(r.maxId).toBe(Math.max(...obsFixture.results.map((x: { id: number }) => x.id)));
    });

    test('the same fixture records inside the box parse normally', () => {
        // Same six records, moved into the Salish Sea: the scope rule is the only
        // thing keeping them out, so the null-time skip is all that remains.
        const moved = {
            ...obsFixture,
            results: obsFixture.results.map((x: { geojson: { coordinates: number[] } }) => ({
                ...x, geojson: { ...x.geojson, coordinates: [-123.5, 48.2] },
            })),
        };
        const r = parseInatResponse(moved);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const undated = obsFixture.results.filter((x: { time_observed_at: unknown }) => x.time_observed_at == null).length;
        expect(undated).toBe(1);
        expect(r.observations).toHaveLength(obsFixture.results.length - 1);
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

    // Observation 141262045 (2013), found by the decision 041 history walk: iNat
    // returns a photo whose original_dimensions are present but null. Strictness
    // here fails the WHOLE response, so this once stopped the backfill dead.
    test('accepts a photo whose original_dimensions are null', () => {
        const photo = rawObs.observation_photos[0]!;
        const raw = {
            ...rawObs,
            observation_photos: [{
                ...photo,
                photo: { ...photo.photo, original_dimensions: { height: null, width: null } },
            }],
        };
        const r = parseInatResponse({ total_results: 1, results: [raw] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.observations[0]!.photos[0]).toMatchObject({ height: null, width: null });
    });

    test('accepts an authoritative empty result set (total_results=0)', () => {
        const r = parseInatResponse({ total_results: 0, page: 1, per_page: 200, results: [] });
        expect(r).toMatchObject({ ok: true, observations: [], totalResults: 0, recordCount: 0, maxId: null });
    });

    test('skips the epoch-zero artifact: a missing date wearing a timestamp (salish-4bi)', () => {
        // Observation 386594579 verbatim: observed_on_string is new Date(0).toString()
        // in Pacific time, so time_observed_at is the epoch rendered at -08:00.
        const r = parseInatResponse({
            total_results: 2,
            results: [
                { ...rawObs, id: 386594579, time_observed_at: '1969-12-31T16:00:00-08:00' },
                { ...rawObs, id: 203014813, time_observed_at: '1976-02-01T00:00:00-08:00' },
            ],
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.observations.map((o) => o.id)).toEqual([203014813]);
        expect(r.recordCount).toBe(2); // counted, like the null-time skip: completeness must still add up
        expect(r.maxId).toBe(386594579); // and the cursor still advances past it
    });

    test('reports the max raw id as the keyset cursor (incl. a skipped null-time record)', () => {
        const r = parseInatResponse({
            total_results: 3,
            results: [
                { ...rawObs, id: 10 },
                { ...rawObs, id: 30, time_observed_at: null }, // out of scope: skipped but still the max id
                { ...rawObs, id: 20 },
            ],
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.observations.map((o) => o.id)).toEqual([10, 20]); // null-time record skipped
        expect(r.recordCount).toBe(3); // but counted (drives terminal detection)
        expect(r.maxId).toBe(30); // cursor advances past the skipped record
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
        expect(parseInatTaxa({ total_results: 1, results: [rawTaxon({ rank: 'genusoid' })] }).ok).toBe(false);
    });

    // salish-5ds. The `?id=` query form hid retirements entirely; now that the shell
    // asks by the path form, a retired taxon arrives and has to be recorded as one.
    test('flags a retired taxon and records its replacement', () => {
        const retired = taxaFixture.results.find((t: { id: number }) => t.id === 1368491);
        const n = normalizeTaxon(InatTaxonSchema.parse(retired));
        expect(n.isActive).toBe(false);
        expect(n.currentTaxonId).toBe(1664971);
    });

    test('an active taxon is active with no replacement', () => {
        const n = normalizeTaxon(InatTaxonSchema.parse(
            taxaFixture.results.find((t: { id: number }) => t.id === 1664971),
        ));
        expect(n.isActive).toBe(true);
        expect(n.currentTaxonId).toBeNull();
    });

    // A split names several successors; picking one would guess which animal was
    // seen. Same rule as scripts/backfill/inat-taxa-status.ts.
    test('a split taxon is inactive with NO replacement', () => {
        const n = normalizeTaxon(InatTaxonSchema.parse(
            rawTaxon({ is_active: false, current_synonymous_taxon_ids: [2, 3] }),
        ));
        expect(n.isActive).toBe(false);
        expect(n.currentTaxonId).toBeNull();
    });

    // taxa_replacement_implies_inactive would otherwise abort the persist.
    test('an active taxon naming a synonym still records no replacement', () => {
        const n = normalizeTaxon(InatTaxonSchema.parse(
            rawTaxon({ is_active: true, current_synonymous_taxon_ids: [2] }),
        ));
        expect(n.currentTaxonId).toBeNull();
    });

    // Defaulting a missing is_active to `true` would write "active" on no evidence.
    test('rejects a taxon with no is_active rather than assuming it is active', () => {
        const { is_active: _drop, ...noFlag } = rawTaxon();
        expect(parseInatTaxa({ total_results: 1, results: [noFlag] }).ok).toBe(false);
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

    // current_taxon_id is a NOT DEFERRABLE FK back into the mirror, so a retirement
    // cannot be stored without its replacement (salish-5ds).
    test('referencedTaxonIdsFromTaxa pulls in a retired taxon\'s replacement', () => {
        const ids = referencedTaxonIdsFromTaxa([
            taxon({ id: 10, isActive: false, currentTaxonId: 77 }),
        ]);
        expect(ids).toContain(77);
    });

    test('missingTaxonIds returns referenced-not-present, sorted', () => {
        expect(missingTaxonIds([3, 1, 2, 3], [2])).toEqual([1, 3]);
    });

    test('missingTaxonIds empty when everything present (closure resolved)', () => {
        expect(missingTaxonIds([1, 2, 3], [1, 2, 3, 4])).toEqual([]);
    });
});

describe('pagination completeness (id-keyset)', () => {
    test('isTerminalPage: a short (or empty) page ends the sweep; a full page does not', () => {
        expect(isTerminalPage(0, 200)).toBe(true);
        expect(isTerminalPage(50, 200)).toBe(true);
        expect(isTerminalPage(199, 200)).toBe(true);
        expect(isTerminalPage(200, 200)).toBe(false); // full page → more may follow
    });

    const page = (recordCount: number, maxId: number | null = recordCount): FetchedPage => ({
        recordCount, maxId,
    });

    test('a single empty page is complete and authoritative', () => {
        expect(isPaginationComplete([page(0, null)], 200)).toBe(true);
    });

    test('a single short first page is complete (fits in one page)', () => {
        expect(isPaginationComplete([page(50)], 200)).toBe(true);
    });

    test('full pages followed by a terminal short page → complete', () => {
        expect(isPaginationComplete([page(200), page(200), page(50)], 200)).toBe(true);
    });

    test('an exactly-full window then a terminal empty page → complete', () => {
        // total is a multiple of per_page: the last full page is followed by a 0-row page.
        expect(isPaginationComplete([page(200), page(200), page(0, null)], 200)).toBe(true);
    });

    test('a full last page (no terminal short page) → incomplete', () => {
        expect(isPaginationComplete([page(200), page(200)], 200)).toBe(false);
    });

    test('a short page BEFORE the last (mid-sweep truncation) → incomplete', () => {
        expect(isPaginationComplete([page(200), page(150), page(50)], 200)).toBe(false);
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
