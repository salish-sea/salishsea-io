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
    resolveEntity,
    reconcile,
    MaplifyRecordSchema,
    type NormalizedSighting,
} from './maplify.ts';
import { buildNameIndex, matchName, type RegisterName } from '../register/name-index.ts';

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

/**
 * A constructed edition: the slice of the real register these rules touch, named as the
 * register names it (2026.09.5). Built by hand rather than loaded so the tests run without a
 * register and say exactly which names each rule depends on.
 */
const register = (() => {
    const rows: RegisterName[] = [];
    const entity = (entity_id: string, kind: string, taxon_label: string, names: string[], retired = false) => {
        for (const name of names) rows.push({ entity_id, name, kind, retired, taxon_label });
    };
    entity('SSA:0000900', 'taxon', 'Orcinus orca', ['Orcinus orca', 'Killer whale', 'orca', 'KW']);
    entity('SSA:0000948', 'taxon', 'Orcinus', ['Orcinus', 'Killer whale']); // monotypic genus
    entity('SSA:0000002', 'group', 'Orcinus orca', ["Bigg's", "Bigg's killer whale", 'Biggs']);
    entity('SSA:0000003', 'group', 'Orcinus orca', ['Resident', 'Resident killer whale']);
    entity('SSA:0000010', 'group', 'Orcinus orca', ['Southern Resident', 'Southern Resident killer whale', 'SRKW']);
    // The deprecated Southern Resident keeps its names upstream; it must never be an answer.
    entity('SSA:0000001', 'group', 'Orcinus orca', ['Southern Resident'], true);
    entity('SSA:0000901', 'taxon', 'Megaptera novaeangliae', ['Megaptera novaeangliae', 'Humpback whale', 'Humpback']);
    entity('SSA:0000946', 'taxon', 'Megaptera', ['Megaptera', 'Humpback whale']);
    entity('SSA:0000905', 'taxon', 'Eschrichtius robustus', ['Eschrichtius robustus', 'Gray whale', 'Grey whale', 'Gray', 'Grey']);
    entity('SSA:0000915', 'taxon', 'Balaenoptera acutorostrata', ['Balaenoptera acutorostrata', 'Minke whale']);
    entity('SSA:0000903', 'taxon', 'Zalophus californianus', ['Zalophus californianus', 'California sea lion']);
    entity('SSA:0000914', 'taxon', 'Sagmatias obliquidens', [
        'Sagmatias obliquidens', 'Pacific white-sided dolphin', 'Aethalodelphis obliquidens', 'Lagenorhynchus obliquidens']);
    entity('SSA:0000926', 'taxon', 'Grampus griseus', ['Grampus griseus', "Risso's dolphin"]);
    entity('SSA:0000928', 'taxon', 'Delphinus delphis', ['Delphinus delphis', 'Common dolphin', 'Delphinus capensis']);
    entity('SSA:0000942', 'taxon', 'Delphinus', ['Delphinus', 'Common dolphin']); // six species
    entity('SSA:0000954', 'taxon', 'Eubalaena', ['Eubalaena', 'Right whale']);
    entity('SSA:0000955', 'taxon', 'Hyperoodon', ['Hyperoodon', 'Bottlenose whale']);
    // An individual nicknamed like a taxon: a taxon name never names an animal.
    entity('SSA:0010001', 'individual', 'Megaptera novaeangliae', ['Big Mama', 'Gray']);
    return buildNameIndex(rows);
})();

const entityOf = (over: Partial<NormalizedSighting>) => resolveEntity(norm(over), register);
const killerWhale = (over: Partial<NormalizedSighting>) => isKillerWhale(norm(over), register);
const ingestable = (over: Partial<NormalizedSighting>) => isIngestable(norm(over), register);

describe('isKillerWhale', () => {
    test('the species, an ecotype and the genus', () => {
        expect(killerWhale({ scientificName: 'Orcinus orca' })).toBe(true);
        expect(killerWhale({ scientificName: 'orcinus orca' })).toBe(true);
        expect(killerWhale({ name: 'Southern Resident Killer Whale', scientificName: '' })).toBe(true);
        expect(killerWhale({ name: null, scientificName: 'Orcinus' })).toBe(true);
    });

    test('an orca common name over a placeholder or blank scientific name', () => {
        expect(killerWhale({ name: 'Orca', scientificName: 'N/A' })).toBe(true);
        expect(killerWhale({ name: 'Orca (ballena asesina)', scientificName: '' })).toBe(true);
        expect(killerWhale({ name: 'Killer Whale (Orca)', scientificName: '' })).toBe(true);
    });

    test('an orca-shaped common name the register does not hold, with nothing else to go on', () => {
        // The live fixture's shape (there under the excluded wras source).
        expect(killerWhale({ name: 'Killer whale (Ecotype Unknown)', scientificName: '' })).toBe(true);
        expect(killerWhale({ name: 'Transient Orca', scientificName: '' })).toBe(true);
        // "Killer Whale" alone is ambiguous in the register (species and genus), so it
        // resolves to nothing — and the name still reads as an orca.
        expect(killerWhale({ name: 'Killer Whale', scientificName: 'N/A' })).toBe(true);
        // ...but not over a scientific name that resolves to something else.
        expect(killerWhale({ name: 'Transient Orca', scientificName: 'Megaptera novaeangliae' })).toBe(false);
        expect(killerWhale({ name: null, scientificName: '' })).toBe(false);
    });

    test('an upstream correction in name wins over an orca scientific name, and vice versa', () => {
        expect(killerWhale({ name: 'Humpback', scientificName: 'Orcinus orca' })).toBe(false);
        expect(killerWhale({ name: 'Orca', scientificName: 'Megaptera novaeangliae' })).toBe(true);
    });

    test('not an orca: other taxa, no identification, or a genus that merely starts with orc', () => {
        expect(killerWhale({ name: 'Humpback', scientificName: 'Megaptera novaeangliae' })).toBe(false);
        expect(killerWhale({ name: 'Unspecified', scientificName: 'N/A' })).toBe(false);
        expect(killerWhale({ name: '', scientificName: '' })).toBe(false);
        expect(killerWhale({ name: 'Unspecified', scientificName: 'Orcinusfake orca' })).toBe(false);
    });
});

describe('isIngestable', () => {
    // Inside the Salish Sea box [-126, 47, -122, 50.5]; outside it (Monterey Bay).
    const inside = { lat: 48.5, lon: -123.0 };
    const outside = { lat: 36.8, lon: -121.9 };
    const humpback = { name: 'Humpback', scientificName: 'Megaptera novaeangliae' };

    test('excludes rwsas and wras regardless of place or taxon', () => {
        expect(ingestable({ source: 'rwsas', ...inside })).toBe(false);
        expect(ingestable({ source: 'wras', ...inside })).toBe(false);
    });

    test('inside the Salish Sea, every taxon is in scope', () => {
        expect(ingestable({ source: 'whale_alert', ...inside })).toBe(true);
        expect(ingestable({ source: 'FARPB', ...inside, ...humpback })).toBe(true);
        expect(ingestable({ ...inside, name: 'Unspecified', scientificName: 'N/A' })).toBe(true);
    });

    test('outside the Salish Sea, only killer whales are in scope', () => {
        expect(ingestable({ ...outside })).toBe(true); // norm() is an Orca
        expect(ingestable({ ...outside, name: 'Southern Resident Killer Whale', scientificName: '' })).toBe(true);
        expect(ingestable({ ...outside, ...humpback })).toBe(false);
        expect(ingestable({ ...outside, name: 'Unspecified', scientificName: 'N/A' })).toBe(false);
    });

    test('the Salish Sea box is inclusive of its edges', () => {
        expect(ingestable({ ...humpback, lon: -126, lat: 47 })).toBe(true);
        expect(ingestable({ ...humpback, lon: -122, lat: 50.5 })).toBe(true);
        expect(ingestable({ ...humpback, lon: -121.99, lat: 48 })).toBe(false);
        expect(ingestable({ ...humpback, lon: -124, lat: 46.99 })).toBe(false);
    });
});

describe('resolveEntity', () => {
    test('prefers the record scientific name', () => {
        expect(entityOf({ scientificName: 'Orcinus orca', name: 'Orca' })).toBe('SSA:0000900');
    });

    test('falls back to the common name when scientific name is blank or whitespace', () => {
        expect(entityOf({ scientificName: '', name: 'California Sea Lion' })).toBe('SSA:0000903');
        expect(entityOf({ scientificName: '   ', name: 'California Sea Lion' })).toBe('SSA:0000903');
    });

    test('returns null when neither resolves', () => {
        expect(entityOf({ scientificName: '', name: 'Fictional Whale' })).toBeNull();
        expect(entityOf({ scientificName: '', name: null })).toBeNull();
    });

    test('an ecotype named in the common name is the ecotype, not the species', () => {
        // 4,337 production records arrive exactly like this. Resident generally (the
        // subspecies ater) was the most iNaturalist could say; the report says more.
        expect(entityOf({ scientificName: '', name: 'Southern Resident Killer Whale' })).toBe('SSA:0000010');
        expect(entityOf({ scientificName: 'Orcinus orca', name: 'Southern Resident Killer Whale' })).toBe('SSA:0000010');
        expect(entityOf({ scientificName: 'N/A', name: "Bigg's Killer Whale" })).toBe('SSA:0000002');
    });

    // salish-7jl. Upstream moderators correct a species by editing `name` and the
    // comment; `scientific_name` keeps the superseded identification. Resolving toward
    // the stale field discards exactly the records a human took the trouble to fix.
    describe('a disagreement resolves toward the corrected name (salish-7jl)', () => {
        // Real records, by upstream id, with the comment that proves the direction.
        test.each([
            // 188375: "reported as humpback but was gray whale - Alisa"
            ['Gray Whale', 'Megaptera novaeangliae', 'SSA:0000905'],
            // 158632: "Edit, reported as grays but were the two humpbacks."
            ['Humpback', 'Eschrichtius robustus', 'SSA:0000901'],
            // 195928: "[Orca Network] Humpback, low surfacing, northbound"
            ['Humpback', 'Orcinus orca', 'SSA:0000901'],
            // 144659: "Photo confirms minke, corrected species - alb"
            ['Minke Whale', 'Megaptera novaeangliae', 'SSA:0000915'],
            // 152658: "Edit to confirm these were orcas, J pod (Orca Network)"
            ['Southern Resident Killer Whale', 'Balaenoptera acutorostrata', 'SSA:0000010'],
        ])('%s reported as %s resolves to %s', (name, stale, corrected) => {
            expect(entityOf({ scientificName: stale, name })).toBe(corrected);
        });

        test('agreement is left alone', () => {
            expect(entityOf({ scientificName: 'Megaptera novaeangliae', name: 'Humpback' })).toBe('SSA:0000901');
        });

        test('a name the register does not hold never overrides a scientific name', () => {
            expect(entityOf({ scientificName: 'Orcinus orca', name: 'Something Nobody Has Named' })).toBe('SSA:0000900');
        });

        test('nor does an ambiguous one', () => {
            // "Humpback whale" names the species and the monotypic genus alike.
            expect(entityOf({ scientificName: 'Orcinus orca', name: 'Humpback Whale' })).toBe('SSA:0000900');
        });
    });

    // 'N/A' is non-blank, so an early resolver returned it as if it were a name. It
    // matches nothing, so 128 records lost their identity while `name` said what they were.
    describe('upstream placeholders are not scientific names', () => {
        test.each(['N/A', 'n/a', 'NA', 'unknown', 'Unspecified'])('%s is treated as absent', (placeholder) => {
            expect(entityOf({ scientificName: placeholder, name: 'Gray Whale' })).toBe('SSA:0000905');
        });

        test('a placeholder with no usable name resolves to null', () => {
            expect(entityOf({ scientificName: 'N/A', name: 'Unspecified' })).toBeNull();
        });
    });

    // A name asserting no identification must not suppress a good scientific name:
    // 'Unspecified' with scientific_name 'Orcinus orca' is an orca.
    test('an unidentified name keeps a usable scientific name', () => {
        expect(entityOf({ scientificName: 'Orcinus orca', name: 'Unspecified' })).toBe('SSA:0000900');
    });

    test("Whale Alert's bare category labels resolve", () => {
        // 141 records; the register carries these as hidden names since 2026.09.5.
        expect(entityOf({ scientificName: '', name: 'Gray' })).toBe('SSA:0000905');
        expect(entityOf({ scientificName: '', name: 'Grey' })).toBe('SSA:0000905');
    });

    test('an individual is never the answer, even when its name matches', () => {
        // The fixture's individual also answers to "Gray"; the gray whale still wins alone.
        expect(entityOf({ scientificName: '', name: 'Big Mama' })).toBeNull();
    });

    test('a retired identifier is never the answer', () => {
        // SSA:0000001 still answers to "Southern Resident"; only SSA:0000010 is live.
        expect(entityOf({ scientificName: '', name: 'Southern Resident' })).toBe('SSA:0000010');
    });

    test('synonyms resolve through the register\'s historical and hidden names', () => {
        expect(entityOf({ scientificName: 'Lagenorhynchus obliquidens', name: 'Pacific White-sided Dolphin' }))
            .toBe('SSA:0000914');
        expect(entityOf({ scientificName: 'Aethalodelphis obliquidens', name: '' })).toBe('SSA:0000914');
        expect(entityOf({ scientificName: 'Delphinus capensis', name: 'Long-beaked Common Dolphin' }))
            .toBe('SSA:0000928');
    });

    test('names are matched case- and spacing-insensitively', () => {
        expect(entityOf({ scientificName: '', name: 'pacific white-sided dolphin' })).toBe('SSA:0000914');
        expect(entityOf({ scientificName: '', name: '  Gray   Whale ' })).toBe('SSA:0000905');
    });

    // A genus-level upstream category must stay at genus. Whale Alert offers no finer
    // term for these, so narrowing them would be our invention, not the reporter's.
    test.each([
        ['Common Dolphin', 'Delphinus', 'SSA:0000942'],
        ['Right Whale', 'Eubalaena', 'SSA:0000954'],
        ['Bottlenose Whale', 'Hyperoodon', 'SSA:0000955'],
    ])('%s stays at the genus upstream supplied', (name, genus, entity) => {
        expect(entityOf({ scientificName: genus, name })).toBe(entity);
    });

    test('mis-decoded and variant apostrophes resolve', () => {
        // Upstream sends UTF-8 decoded as Latin-1, so U+2019's three bytes arrive as
        // three characters. Every spelling of the apostrophe must land together.
        for (const name of ["Risso's dolphin", 'Risso\u2019s dolphin', 'Risso\u2018s dolphin',
                            'Risso\u02bcs dolphin', 'Risso`s dolphin', 'Risso\u00e2\u0080\u0099s dolphin'])
            expect(entityOf({ scientificName: '', name }), name).toBe('SSA:0000926');
    });
});

describe('matchName', () => {
    test('"X (Y)" resolves when the parts that match agree', () => {
        expect(matchName(register, 'Killer Whale (Orca)')).toEqual({ verdict: 'one', entityId: 'SSA:0000900' });
        expect(matchName(register, 'Orca (ballena asesina)')).toEqual({ verdict: 'one', entityId: 'SSA:0000900' });
    });

    test('"X (Y)" whose parts disagree stays unresolved', () => {
        expect(matchName(register, 'Humpback (Gray)').verdict).toBe('none');
    });

    test('an ambiguous name reports every candidate rather than choosing', () => {
        expect(matchName(register, 'Common dolphin'))
            .toEqual({ verdict: 'many', entityIds: ['SSA:0000928', 'SSA:0000942'] });
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
