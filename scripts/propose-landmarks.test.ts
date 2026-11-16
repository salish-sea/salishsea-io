import { describe, expect, test } from 'vitest';

import { gnisCandidates, listedNames, named } from './propose-landmarks.ts';

// The shape of GNIS's DomesticNames file, cut to the columns the script reads.
const gnis = (...rows: [string, string, number, number][]) =>
    ['﻿feature_id|feature_name|feature_class|prim_lat_dec|prim_long_dec',
        ...rows.map(([name, cls, lat, lon], i) => `${i}|${name}|${cls}|${lat}|${lon}`)].join('\r\n');

describe('small communities from GNIS (decision 119)', () => {
    const taken = listedNames(['Camano Island', 'Saratoga Passage', 'Edmonds']);
    const found = gnisCandidates(gnis(
        ['Eglon', 'Populated Place', 47.86, -122.51],
        ['Richmond Beach', 'Populated Place', 47.77, -122.39],
        ['Camano', 'Populated Place', 48.17, -122.53], // the island's name without "Island"
        ['Saratoga', 'Populated Place', 48.07, -122.47],
        ['Edmonds', 'Populated Place', 47.81, -122.38], // listed already
        ['Beach', 'Populated Place', 48.0, -122.5], // only a word for a kind of place
        ['Eglon Creek', 'Stream', 47.86, -122.5],
        ['Tofino', 'Populated Place', 49.15, -125.9],
        ['Portland', 'Populated Place', 45.5, -122.7], // outside the region
    ), taken);

    test('proposes the populated places the lists lack, at their GNIS positions', () => {
        expect(found.map(c => [c.name, c.source, c.kind, c.lon])).toEqual([
            ['Eglon', 'gnis', 'community', -122.51],
            ['Richmond Beach', 'gnis', 'community', -122.39],
            ['Tofino', 'gnis', 'community', -125.9],
        ]);
    });

    test('a mention followed by a word that ends a place\'s name is that other place', () => {
        const eglon = found.filter(c => c.name === 'Eglon');
        expect(named('heading southwest toward Eglon', eglon)).toHaveLength(1);
        expect(named('off Eglon Creek', eglon)).toEqual([]);
        expect(named('behind Eglon island', eglon)).toEqual([]);
        expect(named('north of Eglonville', eglon)).toEqual([]);
    });
});

describe('shore parks (decision 119)', () => {
    test('a short form after a placing word in any case, and before a direction, counts', async () => {
        const {parkCandidates} = await import('./propose-landmarks.ts');
        const [stamm] = parkCandidates({columns: ['name', 'kind', 'lon', 'lat', 'zoom', 'other_names'],
            places: [['Stamm Overlook Park', 'park', -122.36, 47.83, 16, []]]}, new Set());
        expect(named('From Stamm we saw whales', [stamm!])).toHaveLength(1);
        expect(named('from Stamm SE bound', [stamm!])).toHaveLength(1);
        expect(named('from Stamm Hall', [stamm!])).toEqual([]);
        expect(named('Stamm said hello', [stamm!])).toEqual([]);
    });
});
