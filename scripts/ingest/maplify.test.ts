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
    isKillerWhale,
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

    test('keeps blank scientific_name verbatim (mirror column); nulls blank photo_url; 0/1 to boolean', () => {
        const r = parseMaplifyResponse(fixture);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const blankSci = r.sightings.find((s) => s.id === 252129);
        expect(blankSci?.scientificName).toBe(''); // verbatim, not null — column is NOT NULL
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

describe('isKillerWhale', () => {
    test('species, subspecies and the genus-only stub', () => {
        expect(isKillerWhale(norm({ scientificName: 'Orcinus orca' }))).toBe(true);
        expect(isKillerWhale(norm({ scientificName: 'Orcinus orca ater' }))).toBe(true);
        expect(isKillerWhale(norm({ scientificName: 'Orcinus orca rectipinnus' }))).toBe(true);
        expect(isKillerWhale(norm({ scientificName: 'Orcinus' }))).toBe(true);
        expect(isKillerWhale(norm({ scientificName: 'orcinus orca' }))).toBe(true);
    });

    test('an orca common name over a placeholder or blank scientific name', () => {
        expect(isKillerWhale(norm({ name: 'Killer Whale', scientificName: 'N/A' }))).toBe(true);
        expect(isKillerWhale(norm({ name: 'Southern Resident Killer Whale', scientificName: '' }))).toBe(true);
        expect(isKillerWhale(norm({ name: 'Orca (ballena asesina)', scientificName: '' }))).toBe(true);
    });

    test('an upstream correction in name wins over an orca scientific name, and vice versa', () => {
        expect(isKillerWhale(norm({ name: 'Humpback', scientificName: 'Orcinus orca' }))).toBe(false);
        expect(isKillerWhale(norm({ name: 'Orca', scientificName: 'Megaptera novaeangliae' }))).toBe(true);
    });

    test('not an orca: other taxa, no identification, or a genus that merely starts with orc', () => {
        expect(isKillerWhale(norm({ name: 'Humpback', scientificName: 'Megaptera novaeangliae' }))).toBe(false);
        expect(isKillerWhale(norm({ name: 'Unspecified', scientificName: 'N/A' }))).toBe(false);
        expect(isKillerWhale(norm({ name: '', scientificName: '' }))).toBe(false);
        expect(isKillerWhale(norm({ name: 'Unspecified', scientificName: 'Orcinusfake orca' }))).toBe(false);
    });
});

describe('isIngestable', () => {
    // Inside the Salish Sea box [-126, 47, -122, 50.5]; outside it (Monterey Bay).
    const inside = { lat: 48.5, lon: -123.0 };
    const outside = { lat: 36.8, lon: -121.9 };
    const humpback = { name: 'Humpback', scientificName: 'Megaptera novaeangliae' };

    test('excludes rwsas and wras regardless of place or taxon', () => {
        expect(isIngestable(norm({ source: 'rwsas', ...inside }))).toBe(false);
        expect(isIngestable(norm({ source: 'wras', ...inside }))).toBe(false);
    });

    test('inside the Salish Sea, every taxon is in scope', () => {
        expect(isIngestable(norm({ source: 'whale_alert', ...inside }))).toBe(true);
        expect(isIngestable(norm({ source: 'FARPB', ...inside, ...humpback }))).toBe(true);
        expect(isIngestable(norm({ ...inside, name: 'Unspecified', scientificName: 'N/A' }))).toBe(true);
    });

    test('outside the Salish Sea, only killer whales are in scope', () => {
        expect(isIngestable(norm({ ...outside }))).toBe(true); // rawRecord is an Orca
        expect(isIngestable(norm({ ...outside, scientificName: 'Orcinus orca ater' }))).toBe(true);
        expect(isIngestable(norm({ ...outside, ...humpback }))).toBe(false);
        expect(isIngestable(norm({ ...outside, name: 'Unspecified', scientificName: 'N/A' }))).toBe(false);
    });

    test('the Salish Sea box is inclusive of its edges', () => {
        expect(isIngestable(norm({ ...humpback, lon: -126, lat: 47 }))).toBe(true);
        expect(isIngestable(norm({ ...humpback, lon: -122, lat: 50.5 }))).toBe(true);
        expect(isIngestable(norm({ ...humpback, lon: -121.99, lat: 48 }))).toBe(false);
        expect(isIngestable(norm({ ...humpback, lon: -124, lat: 46.99 }))).toBe(false);
    });
});

describe('resolveScientificName', () => {
    test('prefers the record scientific name', () => {
        expect(resolveScientificName(norm({ scientificName: 'Orcinus orca', name: 'Orca' })))
            .toBe('Orcinus orca');
    });

    test('falls back to the common-name map when scientific name is blank', () => {
        expect(resolveScientificName(norm({ scientificName: '', name: 'California Sea Lion' })))
            .toBe('Zalophus californianus');
    });

    test('trims a whitespace-only scientific name before falling back', () => {
        expect(resolveScientificName(norm({ scientificName: '   ', name: 'California Sea Lion' })))
            .toBe('Zalophus californianus');
    });

    test('returns null when neither resolves', () => {
        expect(resolveScientificName(norm({ scientificName: '', name: 'Fictional Whale' }))).toBeNull();
        expect(resolveScientificName(norm({ scientificName: '', name: null }))).toBeNull();
    });

    // salish-7jl. Upstream moderators correct a species by editing `name` and the
    // comment; `scientific_name` keeps the superseded identification. Resolving toward
    // the stale field discards exactly the records a human took the trouble to fix.
    describe('a disagreement resolves toward the corrected name (salish-7jl)', () => {
        // Real records, by upstream id, with the comment that proves the direction.
        test.each([
            // 188375: "reported as humpback but was gray whale - Alisa"
            ['Gray Whale', 'Megaptera novaeangliae', 'Eschrichtius robustus'],
            // 158632: "Edit, reported as grays but were the two humpbacks."
            ['Humpback', 'Eschrichtius robustus', 'Megaptera novaeangliae'],
            // 195928: "[Orca Network] Humpback, low surfacing, northbound"
            ['Humpback', 'Orcinus orca', 'Megaptera novaeangliae'],
            // 144659: "Photo confirms minke, corrected species - alb"
            ['Minke Whale', 'Megaptera novaeangliae', 'Balaenoptera acutorostrata'],
            // 152658: "Edit to confirm these were orcas, J pod (Orca Network)"
            ['Southern Resident Killer Whale', 'Balaenoptera acutorostrata', 'Orcinus orca ater'],
        ])('%s reported as %s resolves to %s', (name, stale, corrected) => {
            expect(resolveScientificName(norm({ scientificName: stale, name }))).toBe(corrected);
        });

        test('agreement is left alone', () => {
            expect(resolveScientificName(norm({
                scientificName: 'Megaptera novaeangliae', name: 'Humpback',
            }))).toBe('Megaptera novaeangliae');
        });

        test('an unmapped name never overrides a scientific name', () => {
            expect(resolveScientificName(norm({
                scientificName: 'Orcinus orca', name: 'Something Nobody Has Mapped',
            }))).toBe('Orcinus orca');
        });
    });

    // 'N/A' is non-blank, so the old resolver returned it as if it were a name. It
    // joins nothing, so 128 records lost their taxon while `name` said what they were.
    describe("upstream placeholders are not scientific names", () => {
        test.each(['N/A', 'n/a', 'NA', 'unknown', 'Unspecified'])('%s is treated as absent', (placeholder) => {
            expect(resolveScientificName(norm({ scientificName: placeholder, name: 'Gray Whale' })))
                .toBe('Eschrichtius robustus');
        });

        test('a placeholder with no usable name resolves to null', () => {
            expect(resolveScientificName(norm({ scientificName: 'N/A', name: 'Unspecified' }))).toBeNull();
        });
    });

    // A name asserting no identification must not suppress a good scientific name:
    // 'Unspecified' with scientific_name 'Orcinus orca' is an orca.
    test('an unidentified name keeps a usable scientific name', () => {
        expect(resolveScientificName(norm({ scientificName: 'Orcinus orca', name: 'Unspecified' })))
            .toBe('Orcinus orca');
    });

    test("'Gray' resolves, not only 'Grey'", () => {
        // The map carried 'Grey' but not 'Gray', so 174 records went unresolved over
        // one letter.
        expect(resolveScientificName(norm({ scientificName: '', name: 'Gray' })))
            .toBe('Eschrichtius robustus');
        expect(resolveScientificName(norm({ scientificName: '', name: 'Grey' })))
            .toBe('Eschrichtius robustus');
    });

    test('retired genus names resolve to the name iNaturalist carries', () => {
        // Our taxa mirror holds the active Aethalodelphis row; Lagenorhynchus and
        // Sagmatias join nothing.
        expect(resolveScientificName(norm({
            scientificName: 'Lagenorhynchus obliquidens', name: 'Pacific White-sided Dolphin',
        }))).toBe('Aethalodelphis obliquidens');
        expect(resolveScientificName(norm({ scientificName: '', name: 'Pacific White-sided Dolphin' })))
            .toBe('Aethalodelphis obliquidens');
    });

    test('names are matched case- and spacing-insensitively', () => {
        expect(resolveScientificName(norm({ scientificName: '', name: 'pacific white-sided dolphin' })))
            .toBe('Aethalodelphis obliquidens');
        expect(resolveScientificName(norm({ scientificName: '', name: '  Gray   Whale ' })))
            .toBe('Eschrichtius robustus');
    });

    // A genus-level upstream category must stay at genus. Whale Alert offers no finer
    // term for these, so narrowing them would be our invention, not the reporter's.
    test.each([
        ['Common Dolphin', 'Delphinus'],
        ['Right Whale', 'Eubalaena'],
        ['Bottlenose Whale', 'Hyperoodon'],
    ])('%s stays at the genus upstream supplied', (name, genus) => {
        expect(resolveScientificName(norm({ scientificName: genus, name }))).toBe(genus);
    });

    test('non-English and mis-decoded names resolve', () => {
        expect(resolveScientificName(norm({ scientificName: '', name: 'Ballena jorobada' })))
            .toBe('Megaptera novaeangliae');
        expect(resolveScientificName(norm({ scientificName: '', name: 'Baleine grise' })))
            .toBe('Eschrichtius robustus');
        // Upstream sends UTF-8 decoded as Latin-1, so U+2019's three bytes arrive as
        // three characters. All three spellings of the apostrophe must land together.
        expect(resolveScientificName(norm({ scientificName: '', name: "Risso's dolphin" })))
            .toBe('Grampus griseus');
        expect(resolveScientificName(norm({ scientificName: '', name: 'Risso\u2019s dolphin' })))
            .toBe('Grampus griseus');
        expect(resolveScientificName(norm({ scientificName: '', name: 'Risso\u00e2\u0080\u0099s dolphin' })))
            .toBe('Grampus griseus');
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
