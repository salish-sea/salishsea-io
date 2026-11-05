import { describe, expect, test } from 'vitest';

import { loadWaterGrid } from '../scripts/read-path/water-mask.ts';
import { seaDistance, straightLineInWater, WaterGrid, type LonLat, type SeaDistance } from './sea-distance.ts';
import { distance } from '@turf/distance';

const fixture = (name: string) => new URL(`../scripts/read-path/fixtures/water-mask/${name}`, import.meta.url).pathname;
const salishSea = loadWaterGrid(fixture('water-mask.png'), fixture('water-mask.json'));
const LIMIT_M = 20_000;

/** A grid drawn in text, one character a cell: ~ is water. A cell is 0.01 degrees of longitude and latitude. */
function drawn(rows: string[]): WaterGrid {
    const width = rows[0]!.length, stride = Math.ceil(width / 8);
    const bits = new Uint8Array(stride * rows.length);
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '~') bits[y * stride + (x >> 3)]! |= 0x80 >> (x & 7); }));
    return new WaterGrid(bits, {bbox: [-123, 48, -123 + width * 0.01, 48 + rows.length * 0.01], width, height: rows.length, cell: [0.01, 0.01]});
}
const centre = (g: WaterGrid, col: number, row: number): LonLat => [g.lonOf(col), g.latOf(row)];

function routed(result: SeaDistance) {
    if (result.kind !== 'routed') throw new Error(`expected a route, got ${result.kind}`);
    return result;
}
/** Every vertex in water and every leg between them in water, ignoring the hops from and to a point on shore. */
function pathStaysInWater(path: LonLat[], skipEnds = false) {
    const inner = skipEnds ? path.slice(1, -1) : path;
    expect(inner.every(([lon, lat]) => salishSea.isWater(lon, lat))).toBe(true);
    for (let i = 1; i < inner.length; i++) expect(straightLineInWater(salishSea, inner[i - 1]!, inner[i]!)).toBe(true);
}

describe('seaDistance on the Salish Sea', () => {
    const offGaliano: LonLat = [-123.46, 48.88], mapleBay: LonLat = [-123.60, 48.80];

    test('the Saltspring leg of 2025-07-14 is about 13 km as the crow flies and beyond the 20 km limit by sea', () => {
        expect(distance(offGaliano, mapleBay)).toBeGreaterThan(12);
        expect(distance(offGaliano, mapleBay)).toBeLessThan(15);
        expect(seaDistance(salishSea, offGaliano, mapleBay, {limitM: LIMIT_M})).toEqual({kind: 'beyond-limit'});
    });

    test('with room to search it goes round Saltspring by water (about 29 km, never the 13 km across it)', () => {
        const result = routed(seaDistance(salishSea, offGaliano, mapleBay, {limitM: 60_000}));
        expect(result.distanceM).toBeGreaterThan(25_000);
        expect(result.distanceM).toBeLessThan(45_000);
        expect(result.path[0]).toEqual(offGaliano);
        expect(result.path.at(-1)).toEqual(mapleBay);
        pathStaysInWater(result.path);
    });

    test('goes through Active Pass end to end', () => {
        const result = routed(seaDistance(salishSea, [-123.35, 48.85], [-123.27, 48.88], {limitM: LIMIT_M}));
        expect(result.distanceM).toBeGreaterThan(distance([-123.35, 48.85], [-123.27, 48.88]) * 1000);
        expect(result.distanceM).toBeLessThan(LIMIT_M);
        pathStaysInWater(result.path);
    });

    test('across open water in the Strait of Georgia is the straight line', () => {
        const a: LonLat = [-123.3, 49.2], b: LonLat = [-123.5, 49.1];
        const result = seaDistance(salishSea, a, b, {limitM: LIMIT_M});
        expect(result).toEqual({kind: 'straight', distanceM: distance(a, b) * 1000, path: [a, b]});
    });

    test('a point on the shore is moved to the nearest water, and the path still starts at the point', () => {
        const onLand: LonLat = [-123.58, 48.80]; // between Maple Bay and Sansum Narrows
        expect(salishSea.isWater(...onLand)).toBe(false);
        const result = routed(seaDistance(salishSea, onLand, offGaliano, {limitM: 60_000}));
        expect(result.path[0]).toEqual(onLand);
        expect(result.path.at(-1)).toEqual(offGaliano);
        pathStaysInWater(result.path, true);
    });

    test('a point with no water within 2 km has no water', () => {
        expect(seaDistance(salishSea, [-123.50, 48.82], mapleBay, {limitM: 60_000})).toEqual({kind: 'no-water', which: 'a'}); // the middle of Saltspring
        expect(seaDistance(salishSea, mapleBay, [-122.3, 47.6], {limitM: 60_000})).toEqual({kind: 'no-water', which: 'b'}); // Lake Washington
    });

    test('a point outside the mask is out of range', () => {
        expect(seaDistance(salishSea, [-126, 49], mapleBay, {limitM: LIMIT_M})).toEqual({kind: 'out-of-range', which: 'a'});
        expect(seaDistance(salishSea, mapleBay, [-123, 51], {limitM: LIMIT_M})).toEqual({kind: 'out-of-range', which: 'b'});
    });

    test('is the same going the other way', () => {
        const there = routed(seaDistance(salishSea, offGaliano, mapleBay, {limitM: 60_000}));
        const back = routed(seaDistance(salishSea, mapleBay, offGaliano, {limitM: 60_000}));
        // The straightening is greedy from each end, so the two can differ a little.
        expect(Math.abs(back.distanceM - there.distanceM) / there.distanceM).toBeLessThan(0.03);
    });
});

describe('seaDistance on drawn grids', () => {
    test('goes round a wall, bending at its end', () => {
        const g = drawn([
            '~~~~~~~~~~',
            '~~~~#~~~~~',
            '~~~~#~~~~~',
            '~~~~#~~~~~',
            '~~~~~~~~~~',
        ]);
        const result = routed(seaDistance(g, centre(g, 1, 2), centre(g, 8, 2), {limitM: 100_000}));
        expect(result.path).toHaveLength(3);
        expect(result.distanceM).toBeGreaterThan(distance(centre(g, 1, 2), centre(g, 8, 2)) * 1000);
    });

    test('squeezes through a gap joined only corner to corner, as Dodd Narrows is', () => {
        const g = drawn([
            '~~~~#~~~~',
            '~~~~#~~~~',
            '~~~~~#~~~',
            '~~~~~#~~~',
        ]);
        // Land at (4,0),(4,1),(5,2),(5,3): the water at (4,2) and (5,1) touches only at a corner.
        const result = seaDistance(g, centre(g, 1, 0), centre(g, 7, 3), {limitM: 100_000});
        expect(result.kind).toBe('routed');
    });

    test('says beyond-limit when the only way round is longer, and when the water is split', () => {
        const wall = drawn(['~~#~~', '~~#~~', '~~#~~']);
        expect(seaDistance(wall, centre(wall, 0, 1), centre(wall, 4, 1), {limitM: 100_000})).toEqual({kind: 'beyond-limit'});
        const around = drawn(['~~~~~~~~~~~~~~~', '~~~~~~#~~~~~~~~', '~~~~~~#~~~~~~~~']);
        expect(seaDistance(around, centre(around, 0, 2), centre(around, 12, 2), {limitM: 5_000})).toEqual({kind: 'beyond-limit'});
        expect(seaDistance(around, centre(around, 0, 2), centre(around, 12, 2), {limitM: 100_000}).kind).toBe('routed');
    });

    test('a cell is narrower toward the pole', () => {
        const g = salishSea;
        expect(g.metresPerCell(g.rowAt(50.4))[0]).toBeLessThan(g.metresPerCell(g.rowAt(47.1))[0]);
        expect(g.metresPerCell(0)[1]).toBeCloseTo(0.000833 * 110_574, 3);
    });
});
