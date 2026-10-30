import { describe, expect, test } from 'vitest';

import { waterRegions, type RegionList } from './water-regions.ts';

const square = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

const list: RegionList = {features: [
    // a bay with an island in it
    {properties: {name: 'Mud Bay'}, geometry: {type: 'Polygon', coordinates: [square(-123, 48, -122.8, 48.2), square(-122.95, 48.05, -122.85, 48.15)]}},
    // a strait in two parts, sharing an edge with the bay
    {properties: {name: 'Haro Strait'}, geometry: {type: 'MultiPolygon', coordinates: [
        [square(-123.2, 48, -123, 48.2)], [square(-123.2, 48.3, -123, 48.5)]]}},
]};

describe('waterRegions', () => {
    const regions = waterRegions(list);

    test('names the region a point is in', () => {
        expect(regions.size).toBe(2);
        expect(regions.regionAt(-122.98, 48.1)).toBe('Mud Bay');
        expect(regions.regionAt(-123.1, 48.1)).toBe('Haro Strait');
        expect(regions.regionAt(-123.1, 48.4)).toBe('Haro Strait');
    });

    test('a hole is no part of its region', () => {
        expect(regions.regionAt(-122.9, 48.1)).toBeNull();
    });

    test('a point outside every region is in none', () => {
        expect(regions.regionAt(-123.1, 48.25)).toBeNull();
        expect(regions.regionAt(-110, 40)).toBeNull();
    });

    test('a place borders the region it is in, or one whose edge is close enough', () => {
        expect(regions.borders('Mud Bay', -122.98, 48.1, 0.5)).toBe(true);
        // on Mud Bay's eastern shore, about 0.37 km east of its edge at 48.1°N
        expect(regions.borders('Mud Bay', -122.795, 48.1, 0.5)).toBe(true);
        expect(regions.borders('Mud Bay', -122.795, 48.1, 0.3)).toBe(false);
        // on the island inside the bay, which the bay's water surrounds
        expect(regions.borders('Mud Bay', -122.9, 48.1, 0.5)).toBe(false);
        expect(regions.borders('Mud Bay', -122.851, 48.1, 0.5)).toBe(true);
        expect(regions.borders('Haro Strait', -122.98, 48.1, 0.5)).toBe(false);
        expect(regions.borders('No Such Water', -122.98, 48.1, 0.5)).toBe(false);
    });

    test('a region that spans many grid cells is found from each', () => {
        const wide = waterRegions({features: [
            {properties: {name: 'Strait of Georgia'}, geometry: {type: 'Polygon', coordinates: [square(-125, 49, -123, 50)]}}]});
        expect(wide.regionAt(-124.95, 49.05)).toBe('Strait of Georgia');
        expect(wide.regionAt(-123.05, 49.95)).toBe('Strait of Georgia');
    });
});
