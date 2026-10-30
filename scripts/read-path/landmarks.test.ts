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
    });
});

describe('landmarks', () => {
    const rows = parseLandmarks(tsv(
        ['Lime Kiln Point', 'point', 'gazetteers', '-123.08', '48.1', '9', 'Lime Kiln'],
        // in the East Strait, 2.2 km from the West Strait's edge
        ['Cattle Point', 'point', 'gazetteers', '-122.97', '48.1', '2', 'Cattle Point'],
        ['Stuart Island', 'island', 'osm', '', '', '4', 'Stuart Island'],
        ['Mukilteo Ferry Terminal', 'ferry_terminal', 'osm', '', '', '10', 'Mukilteo'],
        ['Skiou Point', 'point', 'gazetteers', '-123.19', '48.05', '1', ''],
    ));
    const {landmarks: list, unmatched} = resolveLandmarks(rows, osm);
    const near = landmarks(list, regions);

    test('names the nearest landmark within 5 km, as a card writes it', () => {
        expect(near.landmarkAt(-123.14, 48.1, 'West Strait')).toBe('Lime Kiln');
        expect(near.landmarkAt(-122.97, 48.2, 'East Strait')).toBe('Mukilteo');
    });

    test('a point on another region\'s shore is passed over for one on the sighting\'s own', () => {
        // Cattle Point is 3.7 km away and Lime Kiln 4.5, but Cattle Point is on the East Strait
        expect(near.landmarkAt(-123.02, 48.1, 'West Strait')).toBe('Lime Kiln');
        expect(near.landmarkAt(-122.99, 48.1, 'East Strait')).toBe('Cattle Point');
    });

    test('a town or island counts by distance alone, and distance chooses between namesakes', () => {
        expect(near.landmarkAt(-123.1, 48.28, 'East Strait')).toBe('Stuart Island');
        expect(list.filter(l => l.says === 'Stuart Island')).toHaveLength(2);
    });

    test('nothing within 5 km, or only a name the review struck out, is no landmark', () => {
        expect(near.landmarkAt(-122.85, 48.38, 'East Strait')).toBeNull();
        expect(near.landmarkAt(-123.19, 48.04, 'West Strait')).toBeNull();
        expect(list.some(l => l.says === 'Skiou Point')).toBe(false);
    });

    test('an OpenStreetMap row the list has no place for is reported, not guessed', () => {
        expect(unmatched).toEqual([]);
        const gone = resolveLandmarks(parseLandmarks(tsv(['Langley', 'town', 'osm', '', '', '3', 'Langley'])), osm);
        expect(gone.landmarks).toEqual([]);
        expect(gone.unmatched.map(r => r.name)).toEqual(['Langley']);
    });
});
