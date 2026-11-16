import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { landmarks, LANDMARK_COLUMNS, parseLandmarks, resolveLandmarks, type PlaceList } from './landmarks.ts';
import { waterRegions } from './water-regions.ts';

const square = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

// Two straits side by side, split at 123°W, as Haro Strait and Rosario Strait are split by islands.
const regions = waterRegions({features: [
    {properties: {name: 'West Strait'}, geometry: {type: 'Polygon', coordinates: [square(-123.2, 48, -123, 48.4)]}},
    {properties: {name: 'East Strait'}, geometry: {type: 'Polygon', coordinates: [square(-123, 48, -122.8, 48.4)]}},
]});

const tsv = (...rows: string[][]) => [LANDMARK_COLUMNS.join('\t'), ...rows.map(r => r.join('\t'))].join('\n') + '\n';

const osm: PlaceList = {columns: ['name', 'kind', 'lon', 'lat', 'zoom', 'other_names'], places: [
    ['Stuart Island', 'island', -123.1, 48.3, 12, []],
    ['Stuart Island', 'island', -125, 50, 12, []],
    ['Mukilteo Ferry Terminal', 'ferry_terminal', -122.98, 48.2, 15, []],
]};

describe('parseLandmarks', () => {
    test('reads the checked-in list', () => {
        const rows = parseLandmarks(readFileSync(new URL('../../data/reference/landmarks.tsv', import.meta.url), 'utf8'));
        expect(rows.length).toBeGreaterThan(50);
        expect(rows.filter(r => r.source === 'osm').every(r => r.lon === null)).toBe(true);
    });

    test('a gazetteer row has a position and an OpenStreetMap row has none', () => {
        expect(() => parseLandmarks(tsv(['Bush Point', 'point', 'gazetteers', '', '', '3', 'Bush Point']))).toThrow(/has a position/);
        expect(() => parseLandmarks(tsv(['Langley', 'town', 'osm', '-122.4', '48.04', '3', 'Langley']))).toThrow(/has a position/);
        // A small community from GNIS carries its position, as a gazetteer row does (decision 119).
        expect(() => parseLandmarks(tsv(['Eglon', 'community', 'gnis', '', '', '3', 'Eglon']))).toThrow(/has a position/);
        expect(parseLandmarks(tsv(['Eglon', 'community', 'gnis', '-122.51', '47.86', '3', 'Eglon']))[0]).toMatchObject({source: 'gnis', lon: -122.51});
    });
});

describe('landmarks', () => {
    const rows = parseLandmarks(tsv(
        ['Lime Kiln Point', 'point', 'gazetteers', '-123.08', '48.1', '9', 'Lime Kiln Point'],
        // in the East Strait, 2.2 km from the West Strait's edge
        ['Cattle Point', 'point', 'gazetteers', '-122.97', '48.1', '2', 'Cattle Point'],
        ['Stuart Island', 'island', 'osm', '', '', '4', 'Stuart Island'],
        ['Mukilteo Ferry Terminal', 'ferry_terminal', 'osm', '', '', '10', 'Mukilteo'],
        ['Skiou Point', 'point', 'gazetteers', '-123.19', '48.05', '1', ''],
        // a small community from GNIS, at its own position, 2.6 km from the West Strait's edge
        ['Eglon', 'community', 'gnis', '-123.24', '48.35', '3', 'Eglon'],
        // a community nearer Stuart Island's point than the island's is, which the island still wins
        ['Prevost', 'community', 'gnis', '-123.11', '48.29', '2', 'Prevost'],
    ));
    const {landmarks: list, unmatched} = resolveLandmarks(rows, osm);
    const near = landmarks(list, regions);

    test('names the nearest landmark within 5 km, as a card writes it', () => {
        expect(near.landmarkAt(-123.14, 48.1, 'West Strait')).toBe('Lime Kiln Point');
        expect(near.landmarkAt(-122.97, 48.2, 'East Strait')).toBe('Mukilteo');
    });

    test('a point on another region\'s shore is passed over for one on the sighting\'s own', () => {
        // Cattle Point is 3.7 km away and Lime Kiln 4.5, but Cattle Point is on the East Strait
        expect(near.landmarkAt(-123.02, 48.1, 'West Strait')).toBe('Lime Kiln Point');
        expect(near.landmarkAt(-122.99, 48.1, 'East Strait')).toBe('Cattle Point');
    });

    test('a town or island counts by distance alone, and distance chooses between namesakes', () => {
        expect(near.landmarkAt(-123.1, 48.28, 'East Strait')).toBe('Stuart Island');
        // so does a small community (decision 119), placed by its own position, where nothing else is near
        expect(near.landmarkAt(-123.19, 48.36, 'West Strait')).toBe('Eglon');
        expect(list.filter(l => l.says === 'Stuart Island')).toHaveLength(2);
    });

    test('a small community only fills a gap: a nearer one doesn\'t replace another landmark', () => {
        expect(near.landmarkAt(-123.115, 48.288, 'East Strait')).toBe('Stuart Island');
    });

    test('nothing within 5 km, or only a name the review struck out, is no landmark', () => {
        expect(near.landmarkAt(-122.85, 48.38, 'East Strait')).toBeNull();
        expect(near.landmarkAt(-123.19, 48.04, 'West Strait')).toBeNull();
        expect(list.some(l => l.says === 'Skiou Point')).toBe(false);
    });

    test('a park row is placed from the shore parks\' list, on its region\'s shore, and only fills a gap', () => {
        const parks: PlaceList = {columns: osm.columns, places: [
            ['Bluff Park', 'park', -123.16, 48.38, 15, []], // in the West Strait's reach, as a park on its shore is
            ['Kiln Park', 'park', -123.09, 48.11, 15, []], // 0.6 km from the test point, nearer than Lime Kiln Point's 1.6 km
            ['Far Shore Park', 'park', -122.97, 48.25, 15, []], // in the East Strait, 2.2 km from the West Strait's edge
        ]};
        const parkRows = parseLandmarks(tsv(
            ['Lime Kiln Point', 'point', 'gazetteers', '-123.08', '48.1', '9', 'Lime Kiln Point'],
            ['Bluff Park', 'park', 'parks', '', '', '3', 'Bluff Park'],
            ['Kiln Park', 'park', 'parks', '', '', '2', 'Kiln Park'],
            ['Far Shore Park', 'park', 'parks', '', '', '1', 'Far Shore Park'],
            ['Gone Park', 'park', 'parks', '', '', '1', 'Gone Park'],
        ));
        const resolved = resolveLandmarks(parkRows, osm, parks);
        expect(resolved.unmatched.map(r => r.name)).toEqual(['Gone Park']);
        expect(resolved.landmarks.find(l => l.says === 'Bluff Park')).toMatchObject({lon: -123.16, gapOnly: true});
        const parkNear = landmarks(resolved.landmarks, regions);
        expect(parkNear.landmarkAt(-123.17, 48.37, 'West Strait')).toBe('Bluff Park');
        // Kiln Park is nearer, but a park doesn't displace a point
        expect(parkNear.landmarkAt(-123.095, 48.115, 'West Strait')).toBe('Lime Kiln Point');
        // a park on another region's shore is no landmark there, though nothing else is near
        expect(parkNear.landmarkAt(-123.02, 48.25, 'West Strait')).toBeNull();
        expect(parkNear.landmarkAt(-122.99, 48.25, 'East Strait')).toBe('Far Shore Park');
        expect(() => parseLandmarks(tsv(['Bluff Park', 'park', 'parks', '-123.16', '48.38', '3', 'Bluff Park']))).toThrow(/has a position/);
        // half a position is refused either way
        expect(() => parseLandmarks(tsv(['Bluff Park', 'park', 'parks', '-123.16', '', '3', 'Bluff Park']))).toThrow(/has a position/);
        expect(() => parseLandmarks(tsv(['Eglon', 'community', 'gnis', '-122.51', '', '3', 'Eglon']))).toThrow(/has a position/);
        // a national park, which the list may come to hold, has the shore check too
        const national = landmarks(resolveLandmarks(parseLandmarks(tsv(['Far Shore Park', 'national_park', 'parks', '', '', '1', 'Far Shore Park'])), osm,
            {columns: osm.columns, places: [['Far Shore Park', 'national_park', -122.97, 48.25, 12, []]]}).landmarks, regions);
        expect(national.landmarkAt(-123.02, 48.25, 'West Strait')).toBeNull();
    });

    test('an OpenStreetMap row the list has no place for is reported, not guessed', () => {
        expect(unmatched).toEqual([]);
        const gone = resolveLandmarks(parseLandmarks(tsv(['Langley', 'town', 'osm', '', '', '3', 'Langley'])), osm);
        expect(gone.landmarks).toEqual([]);
        expect(gone.unmatched.map(r => r.name)).toEqual(['Langley']);
    });
});
