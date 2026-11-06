import { describe, expect, test } from 'vitest';

import { UNREACHABLE, UNIT_M, encodeValues, reachContours, reachSteps, loopArea, type Reach } from './reach.ts';
import { imputedPositions, type TravelLineProperties } from './segments.ts';
import type { Feature, LineString } from 'geojson';

/** A reach drawn from a function of the sample (column, row), centred on the middle of a 41 by 41 window of 500 m samples. */
const SIZE = 41;
function reachOf(value: (col: number, row: number) => number): Reach {
    const bytes = new Uint8Array(SIZE * SIZE);
    for (let row = 0; row < SIZE; row++)
        for (let col = 0; col < SIZE; col++) bytes[row * SIZE + col] = Math.min(UNREACHABLE, Math.round(value(col, row)));
    return {cell: 500, width: SIZE, height: SIZE, west: -123.2, north: 48.8, values: encodeValues(bytes)};
}
const MIDDLE = (SIZE - 1) / 2;
/** Samples are 500 m apart, so a distance of d samples is 2d units. */
const unitsAway = (col: number, row: number) => Math.hypot(col - MIDDLE, row - MIDDLE) * 500 / UNIT_M;

/** A contour point in samples east and south of the window's top-left corner. */
function inSamples(reach: Reach, [lon, lat]: [number, number] | number[]) {
    const steps = reachSteps(reach);
    return [(lon! - reach.west) / steps.lon, (reach.north - lat!) / steps.lat] as const;
}

describe('reachContours', () => {
    test('a disc of water gives one closed line at the radius asked for', () => {
        const reach = reachOf((c, r) => unitsAway(c, r) <= 16 ? unitsAway(c, r) : UNREACHABLE);
        const loops = reachContours(reach, 5 * 500);
        expect(loops).toHaveLength(1);
        const loop = loops[0]!;
        expect(loop[0]).toEqual(loop.at(-1));
        expect(loop.length).toBeGreaterThan(20);
        for (const point of loop) {
            const [x, y] = inSamples(reach, point);
            expect(Math.hypot(x - MIDDLE, y - MIDDLE)).toBeGreaterThan(4.85);
            expect(Math.hypot(x - MIDDLE, y - MIDDLE)).toBeLessThan(5.15);
        }
    });

    test('the same field gives a smaller line for a smaller radius, and each is placed between samples', () => {
        const reach = reachOf((c, r) => unitsAway(c, r) <= 16 ? unitsAway(c, r) : UNREACHABLE);
        const radius = (m: number) => {
            const [x, y] = inSamples(reach, reachContours(reach, m)[0]![0]!);
            return Math.hypot(x - MIDDLE, y - MIDDLE);
        };
        expect(radius(2750)).toBeGreaterThan(5.3);
        expect(radius(2750)).toBeLessThan(5.7);
        expect(radius(1000)).toBeLessThan(2.4);
    });

    test('an island inside the reach gives an inner line around it', () => {
        const reach = reachOf((c, r) => unitsAway(c, r) <= 16 && Math.hypot(c - MIDDLE, r - MIDDLE) > 1.5 ? unitsAway(c, r) : UNREACHABLE);
        const loops = reachContours(reach, 6 * 500);
        expect(loops).toHaveLength(2);
        const [outer, inner] = loops.toSorted((a, b) => loopArea(b) - loopArea(a));
        expect(loopArea(outer!)).toBeGreaterThan(loopArea(inner!) * 10);
        // the inner line is the shore, halfway between the last water sample and the island
        for (const point of inner!) {
            const [x, y] = inSamples(reach, point);
            expect(Math.hypot(x - MIDDLE, y - MIDDLE)).toBeLessThan(2.2);
            expect(Math.hypot(x - MIDDLE, y - MIDDLE)).toBeGreaterThan(1.2);
        }
    });

    test('a wall of land cuts the reach: water just beyond it that is far round it stays outside the line', () => {
        // The wall is column 22 from the top to row 30; below it the water is open, so the east side is reached by the long way.
        const wall = (c: number, r: number) => c === 22 && r <= 30;
        const distances = (c: number, r: number) => {
            if (wall(c, r)) return UNREACHABLE;
            // by water: straight on the west side, and round the wall's foot (22, 31) for the east side
            if (c < 22) return Math.hypot(c - MIDDLE, r - MIDDLE) * 2;
            return (Math.hypot(22 - MIDDLE, 31 - MIDDLE) + Math.hypot(c - 22, r - 31)) * 2;
        };
        const reach = reachOf(distances);
        const loops = reachContours(reach, 4 * 500);
        expect(loops).toHaveLength(1);
        // 2 samples east of the centre is the wall's column; the reach is cut there and nothing east of it is inside
        for (const point of loops[0]!) expect(inSamples(reach, point)[0]).toBeLessThanOrEqual(22);
        // a longer radius takes in the way round the foot: the line reaches east of the wall
        const farther = reachContours(reach, 22 * 500);
        expect(Math.max(...farther.flat().map(p => inSamples(reach, p)[0]))).toBeGreaterThan(23);
    });

    test('no sample within the radius gives no line; a reach of the wrong size gives none either', () => {
        expect(reachContours(reachOf(() => UNREACHABLE), 5000)).toEqual([]);
        expect(reachContours({...reachOf(() => 0), width: 3}, 5000)).toEqual([]);
    });
});

describe('imputedPositions with a reach', () => {
    const NOW = Date.UTC(2026, 10, 5, 20);
    const ring = (n: number) => ({type: 'LineString', coordinates: Array.from({length: n}, (_, i) => [-123 + i * 1e-3, 48.5])}) as LineString;
    const lineOf = (reach?: Reach, ageHours = 1): Feature<LineString, TravelLineProperties> => ({
        type: 'Feature', geometry: ring(2),
        properties: {expectedTravelSpeedKmph: 3, lastOccurrenceAt: NOW - ageHours * 3_600_000, ...(reach && {reach})},
    });
    const centred = (): Reach => ({...reachOf((c, r) => unitsAway(c, r) <= 30 ? unitsAway(c, r) : UNREACHABLE)});

    test('without a reach each ring is a circle of 65 points, as before', () => {
        const features = imputedPositions({...lineOf(), geometry: {type: 'LineString', coordinates: [[-123.1, 48.4], [-123.0, 48.5]]}}, NOW);
        expect(features.map(f => f.geometry.type)).toEqual(['LineString', 'Point', 'LineString', 'Point']);
        expect((features[0]!.geometry as LineString).coordinates).toHaveLength(65);
    });

    test('with a reach each ring is its contour, labelled at the top of the largest loop', () => {
        const reach = centred();
        const [lon, lat] = [reach.west + MIDDLE * reachSteps(reach).lon, reach.north - MIDDLE * reachSteps(reach).lat];
        const features = imputedPositions({...lineOf(reach), geometry: {type: 'LineString', coordinates: [[lon - 0.1, lat], [lon, lat]]}}, NOW);
        expect(features.map(f => f.geometry.type)).toEqual(['LineString', 'Point', 'LineString', 'Point']);
        const [now, label, later] = features as Feature<LineString | never>[];
        expect(now!.geometry.coordinates.length).not.toBe(65);
        // 3 km/h for 1 h is 3 km: the line stands about 3 km from the centre
        const [x, y] = inSamples(reach, now!.geometry.coordinates[0]!);
        expect(Math.hypot(x - MIDDLE, y - MIDDLE) * 500).toBeGreaterThan(2800);
        expect(Math.hypot(x - MIDDLE, y - MIDDLE) * 500).toBeLessThan(3200);
        expect(label!.properties).toEqual({label: 'now at 3km/h'});
        const top = Math.max(...now!.geometry.coordinates.map(p => p[1]!));
        expect((label!.geometry as unknown as {coordinates: number[]}).coordinates[1]).toBe(top);
        expect(later!.properties).toHaveProperty('opacity');
    });

    test('a reach whose own sample is land falls back to the circle', () => {
        const features = imputedPositions({...lineOf(reachOf(() => UNREACHABLE)), geometry: {type: 'LineString', coordinates: [[-123.1, 48.4], [-123.0, 48.5]]}}, NOW);
        expect((features[0]!.geometry as LineString).coordinates).toHaveLength(65);
    });

    test('nothing from six hours', () => {
        expect(imputedPositions(lineOf(centred(), 6), NOW)).toEqual([]);
    });
});
