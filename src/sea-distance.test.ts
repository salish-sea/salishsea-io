import { describe, expect, test } from 'vitest';

import { loadWaterGrid } from '../scripts/read-path/water-mask.ts';
import { erodedByOneCell, seaDistance, seaLegFor, seaReachFor, waterDistanceField, smoothRoute, straightLineInWater, WaterGrid, type LonLat, type SeaDistance } from './sea-distance.ts';
import { distance } from '@turf/distance';
import { UNREACHABLE, decodeValues, reachSteps } from './reach.ts';

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

/** The cells of a grid that are water, as the text it was drawn from. */
function shown(g: WaterGrid): string[] {
    return Array.from({length: g.height}, (_, row) => Array.from({length: g.width}, (_, col) => g.isWaterCell(col, row) ? '~' : '#').join(''));
}

describe('erodedByOneCell (salish-84y0)', () => {
    test('keeps a cell only when all eight neighbours are water, and the grid edge counts as land', () => {
        const g = drawn([
            '~~~~~~~~~~~',
            '~~~~~~~~~~~',
            '~~~~~#~~~~~',
            '~~~~~~~~~~~',
            '~~~~~~~~~~~',
        ]);
        expect(shown(erodedByOneCell(g))).toEqual([
            '###########',
            '#~~~###~~~#',
            '#~~~###~~~#',
            '#~~~###~~~#',
            '###########',
        ]);
    });

    test('closes a channel one or two cells wide, and keeps one three wide as a single line', () => {
        const wide = drawn(['#####', '~~~~~', '~~~~~', '#####']);
        expect(shown(erodedByOneCell(wide)).join('')).not.toContain('~');
        const three = drawn(['#######', '~~~~~~~', '~~~~~~~', '~~~~~~~', '#######']);
        expect(shown(erodedByOneCell(three))).toEqual(['#######', '#######', '#~~~~~#', '#######', '#######']);
    });

    test('does not read the bits past the last column as water', () => {
        // Nine columns: seven padding bits follow in the second byte, all set here.
        const bits = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
        const g = new WaterGrid(bits, {bbox: [-123, 48, -122.91, 48.03], width: 9, height: 3, cell: [0.01, 0.01]});
        expect(shown(erodedByOneCell(g))).toEqual(['#########', '#~~~~~~~#', '#########']);
    });

    test('is made once for a grid', () => {
        const g = drawn(['~~~', '~~~', '~~~']);
        expect(erodedByOneCell(g)).toBe(erodedByOneCell(g));
    });
});

describe('smoothRoute (salish-84y0)', () => {
    const headland = drawn([
        '~~~~~~~~~~~~~~~~~~~~',
        '~~~~~~~~~~~~~~~~~~~~',
        '~~~~~~~~~##~~~~~~~~~',
        '~~~~~~~~~##~~~~~~~~~',
        '~~~~~~~~~##~~~~~~~~~',
        '~~~~~~~~~~~~~~~~~~~~',
    ]);

    test('runs through every vertex, ends included, with more points than the route and all of them in water', () => {
        const route: LonLat[] = [centre(headland, 2, 4), centre(headland, 8, 1), centre(headland, 11, 1), centre(headland, 17, 4)];
        const line = smoothRoute(headland, route);
        expect(line[0]).toEqual(route[0]);
        expect(line.at(-1)).toEqual(route.at(-1));
        for (const vertex of route) expect(line).toContainEqual(vertex);
        expect(line.length).toBeGreaterThan(route.length * 5);
        expect(line.every(([lon, lat]) => headland.isWater(lon, lat))).toBe(true);
        for (let i = 1; i < line.length; i++) expect(straightLineInWater(headland, line[i - 1]!, line[i]!)).toBe(true);
    });

    test('is about 100 m between points', () => {
        const route: LonLat[] = [centre(headland, 2, 4), centre(headland, 8, 1), centre(headland, 17, 4)];
        const line = smoothRoute(headland, route);
        for (let i = 1; i < line.length; i++) expect(distance(line[i - 1]!, line[i]!) * 1000).toBeLessThan(130);
    });

    test('leaves a stretch straight between its two vertices where the curve would cross land', () => {
        // A one-cell channel with a right-angle bend: the spline cuts the inside corner.
        const side = 21;
        const bend = drawn(Array.from({length: side}, (_, row) => Array.from({length: side}, (_, col) => (col === 10 && row <= 10) || (row === 10 && col <= 10) ? '~' : '#').join('')));
        const route: LonLat[] = [centre(bend, 10, 0), centre(bend, 10, 10), centre(bend, 0, 10)];
        expect(straightLineInWater(bend, route[0]!, route[1]!)).toBe(true);
        expect(straightLineInWater(bend, route[1]!, route[2]!)).toBe(true);
        const line = smoothRoute(bend, route);
        // Only straight stretches survive here: no sampled point lies off the lines between the vertices.
        const onRoute = (p: LonLat) => Math.abs(p[0] - route[0]![0]) < 1e-9 || Math.abs(p[1] - route[1]![1]) < 1e-9;
        expect(line.every(onRoute)).toBe(true);
        expect(line.every(([lon, lat]) => bend.isWater(lon, lat))).toBe(true);
        for (let i = 1; i < line.length; i++) expect(straightLineInWater(bend, line[i - 1]!, line[i]!)).toBe(true);
    });

    test('a route of two points is returned as it is', () => {
        const route: LonLat[] = [centre(headland, 1, 1), centre(headland, 5, 1)];
        expect(smoothRoute(headland, route)).toEqual(route);
    });
});

describe('seaLegFor (salish-84y0)', () => {
    test('is null for a straight line in water, and for a pair with no route', () => {
        const open = drawn(['~~~~~~', '~~~~~~', '~~~~~~']);
        expect(seaLegFor(open)(centre(open, 0, 1), centre(open, 5, 1))).toBeNull();
        const wall = drawn(['~~#~~', '~~#~~', '~~#~~']);
        expect(seaLegFor(wall)(centre(wall, 0, 1), centre(wall, 4, 1))).toBeNull();
    });

    test('keeps a cell off the headland where the sea is wide, as the plain route does not', () => {
        const g = drawn([
            '~~~~~~~~~~~~~~~',
            '~~~~~~~~~~~~~~~',
            '~~~~~~~##~~~~~~',
            '~~~~~~~##~~~~~~',
            '~~~~~~~##~~~~~~',
            '~~~~~~~~~~~~~~~',
            '~~~~~~~~~~~~~~~',
            '~~~~~~~~~~~~~~~',
        ]);
        const a = centre(g, 1, 3), b = centre(g, 13, 3);
        const plain = routed(seaDistance(g, a, b, {limitM: 100_000})).path;
        const leg = seaLegFor(g)(a, b)!;
        const landDistance = (lon: number, lat: number) => {
            let least = Infinity;
            for (let row = 0; row < g.height; row++) for (let col = 0; col < g.width; col++) {
                if (!g.isWaterCell(col, row)) least = Math.min(least, Math.hypot(lon - g.lonOf(col), lat - g.latOf(row)));
            }
            return least;
        };
        // The plain route passes a corner of the headland; the leg stays at least a cell and a half (centre to centre) away.
        expect(Math.min(...plain.map(([lon, lat]) => landDistance(lon, lat)))).toBeLessThan(0.0125);
        expect(Math.min(...leg.map(([lon, lat]) => landDistance(lon, lat)))).toBeGreaterThanOrEqual(0.0145);
        expect(leg.every(([lon, lat]) => g.isWater(lon, lat))).toBe(true);
    });

    test('falls back to the plain mask through a pass a cell wide, which erosion closes', () => {
        const g = drawn([
            '~~~~~#~~~~~',
            '~~~~~#~~~~~',
            '~~~~~~~~~~~',
            '~~~~~#~~~~~',
            '~~~~~#~~~~~',
        ]);
        const a = centre(g, 1, 0), b = centre(g, 9, 0);
        expect(seaDistance(erodedByOneCell(g), a, b, {limitM: 22_000}).kind).not.toBe('routed'); // the gap does not survive erosion
        const leg = seaLegFor(g)(a, b)!;
        expect(leg).not.toBeNull();
        expect(leg.length).toBeGreaterThan(2);
        for (let i = 1; i < leg.length; i++) expect(straightLineInWater(g, leg[i - 1]!, leg[i]!)).toBe(true);
        // It goes through the gap in row 2.
        expect(leg.some(([lon, lat]) => Math.abs(lon - g.lonOf(5)) < 0.005 && Math.abs(lat - g.latOf(2)) < 0.005)).toBe(true);
    });

    test('draws the same line both ways, reversed, on a grid where the two searches would differ', () => {
        const g = drawn([
            '~~~~~~~~~~~~~~~~~~~~',
            '~~~~~~~~~#~~~~~~~~~~',
            '~~~~~~~~##~~~~~~~~~~',
            '~~~~~~~~###~~~~~~~~~',
            '~~~~~~~~##~~~~~~~~~~',
            '~~~~~~~~~#~~~~~~~~~~',
            '~~~~~~~~~~~~~~~~~~~~',
        ]);
        const legOf = seaLegFor(g);
        for (const [a, b] of [[centre(g, 1, 3), centre(g, 18, 2)], [centre(g, 2, 1), centre(g, 17, 5)], [centre(g, 3, 6), centre(g, 16, 0)]] as const) {
            const there = legOf(a, b)!, back = legOf(b, a)!;
            expect(there).not.toBeNull();
            expect(back).toEqual([...there].reverse());
        }
    });

    test('draws the same line both ways through Active Pass', () => {
        const legOf = seaLegFor(salishSea);
        const west: LonLat = [-123.35, 48.85], east: LonLat = [-123.27, 48.88];
        const there = legOf(west, east)!;
        expect(there).not.toBeNull();
        expect(there[0]).toEqual(west);
        expect(there.at(-1)).toEqual(east);
        expect(legOf(east, west)).toEqual([...there].reverse());
        for (let i = 1; i < there.length; i++) expect(straightLineInWater(salishSea, there[i - 1]!, there[i]!)).toBe(true);
    });
});

describe('the reach along water (salish-2adm, decision 115)', () => {
    /** A grid of 0.001 degree cells (about 75 m each way), all water except what `land` marks. */
    function sea(cols: number, rows: number, land: (col: number, row: number) => boolean = () => false): WaterGrid {
        const stride = Math.ceil(cols / 8);
        const bits = new Uint8Array(stride * rows);
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!land(x, y)) bits[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
        return new WaterGrid(bits, {bbox: [-123, 48, -123 + cols * 0.001, 48 + rows * 0.00068], width: cols, height: rows, cell: [0.001, 0.00068]});
    }

    test('behind a headland a point is farther by water than by air', () => {
        // A wall of land at column 200 from row 60 to row 140; the point is on its west side, the other behind it.
        const grid = sea(400, 400, (col, row) => col === 200 && row >= 60 && row <= 140);
        const field = waterDistanceField(grid, centre(grid, 190, 100), 30_000)!;
        const at = (col: number, row: number) => field.metres[(row - field.r0) * field.w + (col - field.c0)]!;
        const [mx] = grid.metresPerCell(100);
        expect(at(190, 100)).toBe(0);
        // on the same side, the distance is about the straight one
        expect(at(170, 100)).toBeGreaterThan(20 * mx * 0.98);
        expect(at(170, 100)).toBeLessThan(20 * mx * 1.03);
        // across the wall the air line is 20 cells (1.5 km); round its end it is at least twice the way to row 59 and back
        const air = 20 * mx;
        expect(at(210, 100)).toBeGreaterThan(3 * air);
        expect(at(210, 100)).toBeLessThan(12 * air);
        // land is not reached
        expect(at(200, 100)).toBe(Infinity);
    });

    test('in open water the distance is within 3% of the straight one in every direction', () => {
        const grid = sea(500, 400);
        const here: LonLat = centre(grid, 250, 200);
        const field = waterDistanceField(grid, here, 15_000)!;
        for (let degrees = 0; degrees < 360; degrees += 7) {
            const col = Math.round(250 + 120 * Math.sin(degrees * Math.PI / 180)), row = Math.round(200 - 80 * Math.cos(degrees * Math.PI / 180));
            const metres = field.metres[(row - field.r0) * field.w + (col - field.c0)]!;
            const air = distance(here, centre(grid, col, row)) * 1000;
            expect(metres).toBeGreaterThanOrEqual(air * 0.98);
            expect(metres).toBeLessThan(air * 1.03);
        }
    });

    test('nothing past the radius is reached, and a point on land is moved to water within 2 km', () => {
        const grid = sea(500, 400, (col) => col < 100);
        const far = waterDistanceField(grid, centre(grid, 250, 200), 5000)!;
        expect(far.metres.every(m => m === Infinity || m <= 5000)).toBe(true);
        expect(waterDistanceField(grid, centre(grid, 90, 200), 5000)).not.toBeNull();
        expect(waterDistanceField(grid, centre(grid, 10, 200), 5000)).toBeNull();
        expect(waterDistanceField(grid, [-130, 48.1], 5000)).toBeNull();
    });

    test('seaReachFor writes the header and one byte a sample, only for a recent report with a speed', () => {
        const grid = sea(700, 500, (col, row) => col >= 400 && col < 408 && row >= 100 && row <= 300);
        const now = Date.UTC(2026, 10, 5, 20);
        const reachOf = seaReachFor(grid, () => now);
        const at: LonLat = centre(grid, 390, 200);
        const seen = now - 2 * 3_600_000;
        const reach = reachOf(at, 3, seen)!;
        // 3 km/h for 6.5 h is 19.5 km: 39 samples of 500 m each side of the middle
        expect(reach).toMatchObject({cell: 500, width: 79, height: 79});
        const bytes = decodeValues(reach.values);
        expect(bytes).toHaveLength(79 * 79);
        const steps = reachSteps(reach);
        expect(reach.west + 39 * steps.lon).toBeCloseTo(at[0], 4);
        expect(reach.north - 39 * steps.lat).toBeCloseTo(at[1], 4);
        expect(bytes[39 * 79 + 39]).toBe(0);
        // a sample in the wall is land; a sample one step west of the middle is 500 m, or 2 units
        const col = (lon: number) => Math.round((lon - reach.west) / steps.lon);
        expect(bytes[39 * 79 + 38]).toBe(2);
        expect(bytes[39 * 79 + col(grid.lonOf(403))]).toBe(UNREACHABLE);
        // sample (i, j) of a corner is farther than 19.5 km: not reached
        expect(bytes[0]).toBe(UNREACHABLE);
        expect(reachOf(at, 3, now - 7 * 3_600_000)).toBeNull();
        expect(reachOf(at, 0, seen)).toBeNull();
        expect(reachOf([-130, 48.1], 3, seen)).toBeNull();
    });
});
