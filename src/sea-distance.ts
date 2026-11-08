/**
 * Distance by sea between two points, and the path a swimmer would take (salish-20u7.2),
 * from the basemap's water mask: the sea as a grid of about 90 m cells, each water or land
 * (basemap decision 028, scripts/read-path/water-mask.ts reads it). Pure TypeScript with
 * no Node APIs, so the browser could load the mask and use it too.
 *
 * When the straight line between the points stays in water, that is the distance, as
 * before. Otherwise the search is A* over the cells with eight-way moves (Dodd Narrows is
 * joined only corner to corner), stopping once every route would cost more than the limit
 * (decision 063's 20 km), so each search covers only the patch of sea that could hold a
 * route within it. The path comes back as cell centres, then straightened: from each
 * vertex it skips to the farthest later vertex that can still be seen across water, so a
 * drawn leg bends at headlands rather than stepping along the grid.
 */
import { distance } from '@turf/distance';
import { FAR, UNIT_M, UNREACHABLE, encodeValues, reachSteps, type Reach } from './reach.ts';

export type LonLat = [lon: number, lat: number];

/** How the mask is laid over the earth, as the JSON beside the picture gives it. */
export type WaterGridSpec = {
    /** West, south, east, north, in degrees. */
    bbox: [number, number, number, number],
    width: number,
    height: number,
    /** A cell's width and height, in degrees of longitude and latitude. */
    cell: [number, number],
};

const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LON_AT_EQUATOR = 111_320;
const rad = (degrees: number) => degrees * Math.PI / 180;

/**
 * The mask, one bit a cell (8 MB for the whole Salish Sea rather than 64): rows run north
 * to south, columns west to east, and each row is padded to a whole byte, the first cell
 * in the byte's high bit, which is how a 1-bit PNG lays its rows out.
 */
export class WaterGrid {
    readonly bits: Uint8Array;
    readonly spec: WaterGridSpec;
    readonly stride: number;
    constructor(bits: Uint8Array, spec: WaterGridSpec) {
        this.bits = bits;
        this.spec = spec;
        this.stride = Math.ceil(spec.width / 8);
        if (bits.length !== this.stride * spec.height) {
            throw new Error(`a ${spec.width} by ${spec.height} mask takes ${this.stride * spec.height} bytes, not ${bits.length}`);
        }
    }

    get width() { return this.spec.width; }
    get height() { return this.spec.height; }

    /** Whether the cell is water; a cell outside the grid is not. */
    isWaterCell(col: number, row: number): boolean {
        if (col < 0 || row < 0 || col >= this.spec.width || row >= this.spec.height) return false;
        return (this.bits[row * this.stride + (col >> 3)]! >> (7 - (col & 7)) & 1) === 1;
    }

    /** The column holding the longitude, fractional: 2.5 is the middle of column 2. */
    colAt(lon: number): number { return (lon - this.spec.bbox[0]) / this.spec.cell[0]; }
    rowAt(lat: number): number { return (this.spec.bbox[3] - lat) / this.spec.cell[1]; }
    /** The longitude and latitude of a cell's centre. */
    lonOf(col: number): number { return this.spec.bbox[0] + (col + 0.5) * this.spec.cell[0]; }
    latOf(row: number): number { return this.spec.bbox[3] - (row + 0.5) * this.spec.cell[1]; }

    contains(lon: number, lat: number): boolean {
        const col = this.colAt(lon), row = this.rowAt(lat);
        return col >= 0 && row >= 0 && col < this.spec.width && row < this.spec.height;
    }

    isWater(lon: number, lat: number): boolean {
        return this.isWaterCell(Math.floor(this.colAt(lon)), Math.floor(this.rowAt(lat)));
    }

    /** How many metres a cell spans east to west and north to south in the row; longitude cells narrow toward the pole. */
    metresPerCell(row: number): [number, number] {
        return [
            this.spec.cell[0] * METRES_PER_DEGREE_LON_AT_EQUATOR * Math.cos(rad(this.latOf(row))),
            this.spec.cell[1] * METRES_PER_DEGREE_LAT,
        ];
    }
}

/**
 * Whether the line between two points, in fractional column and row, stays in water: it
 * visits each cell the line crosses, and passes from one cell to the next across a shared
 * corner without testing the two cells beside it, which is how the search moves.
 */
function seesAcross(grid: WaterGrid, c0: number, r0: number, c1: number, r1: number): boolean {
    let col = Math.floor(c0), row = Math.floor(r0);
    const endCol = Math.floor(c1), endRow = Math.floor(r1);
    if (!grid.isWaterCell(col, row)) return false;
    const dc = c1 - c0, dr = r1 - r0;
    const stepC = dc > 0 ? 1 : -1, stepR = dr > 0 ? 1 : -1;
    // How far along the line (0 to 1) the next vertical and horizontal cell edges are.
    let tC = dc === 0 ? Infinity : ((dc > 0 ? col + 1 : col) - c0) / dc;
    let tR = dr === 0 ? Infinity : ((dr > 0 ? row + 1 : row) - r0) / dr;
    const deltaC = dc === 0 ? Infinity : Math.abs(1 / dc), deltaR = dr === 0 ? Infinity : Math.abs(1 / dr);
    for (let guard = Math.abs(endCol - col) + Math.abs(endRow - row) + 2; (col !== endCol || row !== endRow) && guard > 0; guard--) {
        if (Math.abs(tC - tR) < 1e-12) { col += stepC; row += stepR; tC += deltaC; tR += deltaR; }
        else if (tC < tR) { col += stepC; tC += deltaC; }
        else { row += stepR; tR += deltaR; }
        if (!grid.isWaterCell(col, row)) return false;
    }
    return true;
}

/** Whether the straight line between two points stays in water. */
export function straightLineInWater(grid: WaterGrid, a: LonLat, b: LonLat): boolean {
    return seesAcross(grid, grid.colAt(a[0]), grid.rowAt(a[1]), grid.colAt(b[0]), grid.rowAt(b[1]));
}

/** How far from the grid's water a point on land may be and still be moved to it. */
export const SNAP_RADIUS_M = 2000;

/** The nearest water cell within the radius, by metres from the point, or null. */
function nearestWaterCell(grid: WaterGrid, lon: number, lat: number, radiusM: number): [col: number, row: number] | null {
    const col0 = grid.colAt(lon), row0 = grid.rowAt(lat);
    const [mx, my] = grid.metresPerCell(Math.floor(row0));
    const reachC = Math.ceil(radiusM / mx), reachR = Math.ceil(radiusM / my);
    let best: [number, number] | null = null, bestM = radiusM;
    for (let row = Math.floor(row0) - reachR; row <= Math.floor(row0) + reachR; row++) {
        for (let col = Math.floor(col0) - reachC; col <= Math.floor(col0) + reachC; col++) {
            if (!grid.isWaterCell(col, row)) continue;
            // The cell's nearest point to the position, so a point at a cell's edge is next to the cell beyond it.
            const nearC = Math.min(Math.max(col0, col), col + 1), nearR = Math.min(Math.max(row0, row), row + 1);
            const metres = Math.hypot((nearC - col0) * mx, (nearR - row0) * my);
            if (metres <= bestM) { bestM = metres; best = [col, row]; }
        }
    }
    return best;
}

export type SeaDistance =
    /** The straight line stays in water: its length, and the two points. */
    | {kind: 'straight', distanceM: number, path: [LonLat, LonLat]}
    /** Around land: the length of the path, which starts and ends at the two points. */
    | {kind: 'routed', distanceM: number, path: LonLat[]}
    /** Every route by sea is longer than the limit (or the points are farther apart than it). */
    | {kind: 'beyond-limit'}
    /** A point is outside the mask's box. */
    | {kind: 'out-of-range', which: 'a' | 'b'}
    /** A point is on land with no water within SNAP_RADIUS_M, or in water the sea doesn't reach. */
    | {kind: 'no-water', which: 'a' | 'b'};

type Heap = {f: number[], id: number[]};
function push(h: Heap, f: number, id: number) {
    let i = h.f.length;
    h.f.push(f); h.id.push(id);
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (h.f[p]! <= f) break;
        h.f[i] = h.f[p]!; h.id[i] = h.id[p]!; i = p;
    }
    h.f[i] = f; h.id[i] = id;
}
function pop(h: Heap): number {
    const top = h.id[0]!;
    const f = h.f.pop()!, id = h.id.pop()!;
    const n = h.f.length;
    if (n > 0) {
        let i = 0;
        for (;;) {
            let c = 2 * i + 1;
            if (c >= n) break;
            if (c + 1 < n && h.f[c + 1]! < h.f[c]!) c++;
            if (h.f[c]! >= f) break;
            h.f[i] = h.f[c]!; h.id[i] = h.id[c]!; i = c;
        }
        h.f[i] = f; h.id[i] = id;
    }
    return top;
}

const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

/**
 * A* from one cell to another, over the window of cells that could be on a route no longer
 * than the limit: a cell on one is no farther from both points together than the limit, so
 * along each axis the window reaches (limit - the points' own separation) / 2 beyond them.
 * Returns the cells from start to goal, or null when none is reachable within the limit.
 */
function searchCells(grid: WaterGrid, start: [number, number], goal: [number, number], limitM: number): [number, number][] | null {
    const [mxStart, myM] = grid.metresPerCell(start[1]);
    const mxMin = Math.min(mxStart, grid.metresPerCell(goal[1])[0]);
    const reachC = Math.max(1, Math.ceil((limitM - Math.abs(goal[0] - start[0]) * mxMin) / 2 / mxMin) + 1);
    const reachR = Math.max(1, Math.ceil((limitM - Math.abs(goal[1] - start[1]) * myM) / 2 / myM) + 1);
    const c0 = Math.max(0, Math.min(start[0], goal[0]) - reachC), c1 = Math.min(grid.width - 1, Math.max(start[0], goal[0]) + reachC);
    const r0 = Math.max(0, Math.min(start[1], goal[1]) - reachR), r1 = Math.min(grid.height - 1, Math.max(start[1], goal[1]) + reachR);
    const w = c1 - c0 + 1, h = r1 - r0 + 1;

    // Metres east to west a column step costs, row by row; the heuristic uses the smallest, so it never overestimates.
    const mx = new Float64Array(h);
    let mxSmallest = Infinity;
    for (let r = 0; r < h; r++) { mx[r] = grid.metresPerCell(r0 + r)[0]; mxSmallest = Math.min(mxSmallest, mx[r]!); }
    const my = grid.metresPerCell(r0)[1];

    const cost = new Float64Array(w * h).fill(Infinity);
    const from = new Int32Array(w * h).fill(-1);
    const idOf = (c: number, r: number) => (r - r0) * w + (c - c0);
    const heuristic = (c: number, r: number) => Math.hypot((c - goal[0]) * mxSmallest, (r - goal[1]) * my);

    const open: Heap = {f: [], id: []};
    const startId = idOf(start[0], start[1]), goalId = idOf(goal[0], goal[1]);
    cost[startId] = 0;
    push(open, heuristic(start[0], start[1]), startId);
    while (open.f.length > 0) {
        const f = open.f[0]!;
        const id = pop(open);
        const c = c0 + id % w, r = r0 + Math.floor(id / w);
        const g = cost[id]!;
        if (f > g + heuristic(c, r) + 1e-3) continue; // a stale entry: a cheaper way to this cell was found since
        if (id === goalId) {
            const cells: [number, number][] = [];
            for (let at = id; at !== -1; at = from[at]!) cells.push([c0 + at % w, r0 + Math.floor(at / w)]);
            return cells.reverse();
        }
        for (const [dc, dr] of NEIGHBOURS) {
            const nc = c + dc, nr = r + dr;
            if (nc < c0 || nc > c1 || nr < r0 || nr > r1 || !grid.isWaterCell(nc, nr)) continue;
            const step = Math.hypot(dc * (mx[r - r0]! + mx[nr - r0]!) / 2, dr * my);
            const ng = g + step;
            const nid = idOf(nc, nr);
            if (ng >= cost[nid]!) continue;
            const nf = ng + heuristic(nc, nr);
            if (nf > limitM) continue;
            cost[nid] = ng;
            from[nid] = id;
            push(open, nf, nid);
        }
    }
    return null;
}

/** Skips each run of vertices the next one can be seen across water from, keeping the farthest that can. */
function straighten(grid: WaterGrid, points: LonLat[]): LonLat[] {
    const cr = points.map(([lon, lat]) => [grid.colAt(lon), grid.rowAt(lat)] as const);
    const kept: LonLat[] = [points[0]!];
    let i = 0;
    while (i < points.length - 1) {
        let j = points.length - 1;
        while (j > i + 1 && !seesAcross(grid, cr[i]![0], cr[i]![1], cr[j]![0], cr[j]![1])) j--;
        kept.push(points[j]!);
        i = j;
    }
    return kept;
}

const lengthM = (path: readonly LonLat[]) => {
    let km = 0;
    for (let i = 1; i < path.length; i++) km += distance(path[i - 1]!, path[i]!);
    return km * 1000;
};

/**
 * The distance by sea from a to b, no longer than limitM unless the straight line is
 * clear (which is returned however long it is: nothing is searched). A point on land,
 * as an observer on shore is, is first moved to the nearest water within SNAP_RADIUS_M,
 * and the path then begins or ends at the point as given.
 */
export function seaDistance(grid: WaterGrid, a: LonLat, b: LonLat, options: {limitM: number}): SeaDistance {
    const {limitM} = options;
    if (!grid.contains(a[0], a[1])) return {kind: 'out-of-range', which: 'a'};
    if (!grid.contains(b[0], b[1])) return {kind: 'out-of-range', which: 'b'};

    const cellA = grid.isWater(a[0], a[1]) ? [Math.floor(grid.colAt(a[0])), Math.floor(grid.rowAt(a[1]))] as [number, number] : nearestWaterCell(grid, a[0], a[1], SNAP_RADIUS_M);
    if (!cellA) return {kind: 'no-water', which: 'a'};
    const cellB = grid.isWater(b[0], b[1]) ? [Math.floor(grid.colAt(b[0])), Math.floor(grid.rowAt(b[1]))] as [number, number] : nearestWaterCell(grid, b[0], b[1], SNAP_RADIUS_M);
    if (!cellB) return {kind: 'no-water', which: 'b'};

    // Where each point stands in water: itself, or the centre of the cell it was moved to.
    const onWaterA: LonLat = grid.isWater(a[0], a[1]) ? a : [grid.lonOf(cellA[0]), grid.latOf(cellA[1])];
    const onWaterB: LonLat = grid.isWater(b[0], b[1]) ? b : [grid.lonOf(cellB[0]), grid.latOf(cellB[1])];

    const straightM = distance(a, b) * 1000;
    if (straightLineInWater(grid, onWaterA, onWaterB)) return {kind: 'straight', distanceM: straightM, path: [a, b]};
    if (straightM > limitM) return {kind: 'beyond-limit'};

    const cells = searchCells(grid, cellA, cellB, limitM);
    if (!cells) return {kind: 'beyond-limit'};

    const centres = cells.slice(1, -1).map(([col, row]): LonLat => [grid.lonOf(col), grid.latOf(row)]);
    const path = straighten(grid, [onWaterA, ...centres, onWaterB]);
    if (onWaterA !== a) path.unshift(a);
    if (onWaterB !== b) path.push(b);
    return {kind: 'routed', distanceM: lengthM(path), path};
}

/** The join rule's limit (decision 063). */
const JOIN_LIMIT_M = 20_000;
/**
 * How far the search looks: the search measures the route along grid cells, which runs up
 * to about 8% longer than the same route once straightened, so a search stopped at exactly
 * 20 km refuses a route that is 19.6 km straightened. It looks a little farther and the
 * straightened length is held to the limit.
 */
const JOIN_SEARCH_M = 22_000;

/**
 * The mask with the land grown by one cell: a cell stays water only if all eight of its
 * neighbours are water too (a cell off the grid is land). A route found in it keeps a cell,
 * about 90 m, off the shore, and a pass only one or two cells wide closes. Done a byte at a
 * time, and only once for a grid.
 */
const erodedGrids = new WeakMap<WaterGrid, WaterGrid>();
export function erodedByOneCell(grid: WaterGrid): WaterGrid {
    const cached = erodedGrids.get(grid);
    if (cached) return cached;
    const {stride, height, width, bits} = grid;
    const out = new Uint8Array(bits.length);
    // The bits past the last column of a row are not cells: they must not count as water.
    const padMask = width % 8 === 0 ? 0xff : (0xff << (8 - width % 8)) & 0xff;
    const v = new Uint8Array(stride);
    for (let row = 0; row < height; row++) {
        for (let x = 0; x < stride; x++) {
            const up = row > 0 ? bits[(row - 1) * stride + x]! : 0;
            const down = row < height - 1 ? bits[(row + 1) * stride + x]! : 0;
            v[x] = bits[row * stride + x]! & up & down & (x === stride - 1 ? padMask : 0xff);
        }
        for (let x = 0; x < stride; x++) {
            const b = v[x]!, before = x > 0 ? v[x - 1]! : 0, after = x < stride - 1 ? v[x + 1]! : 0;
            // The cell to the east of each bit is the next lower bit; to the west, the next higher.
            const east = ((b << 1) | (after >> 7)) & 0xff, west = ((b >> 1) | (before << 7)) & 0xff;
            out[row * stride + x] = b & east & west;
        }
    }
    const eroded = new WaterGrid(out, grid.spec);
    erodedGrids.set(grid, eroded);
    return eroded;
}

/** About how far apart the smoothed route's points are, in metres. */
const SAMPLE_M = 100;

/**
 * A smooth line through the route's vertices (salish-84y0): a centripetal Catmull-Rom
 * spline (alpha 0.5, which does not loop at a sharp bend), sampled about every SAMPLE_M
 * metres. The curve can swing toward land at a headland, so each stretch between two
 * vertices is checked, piece by piece, against the plain mask, and a stretch with a piece
 * in land is left as the straight line between its two vertices, which the straightening
 * saw across water. Both ends are included.
 */
export function smoothRoute(grid: WaterGrid, route: readonly LonLat[]): LonLat[] {
    if (route.length < 3) return [...route];
    const lat0 = route[0]![1], lon0 = route[0]![0];
    const kx = METRES_PER_DEGREE_LON_AT_EQUATOR * Math.cos(rad(lat0));
    const plane = route.map(([lon, lat]): [number, number] => [(lon - lon0) * kx, (lat - lat0) * METRES_PER_DEGREE_LAT]);
    const back = ([x, y]: readonly [number, number]): LonLat => [lon0 + x / kx, lat0 + y / METRES_PER_DEGREE_LAT];
    const reflect = (p: readonly [number, number], q: readonly [number, number]): [number, number] => [2 * p[0] - q[0], 2 * p[1] - q[1]];
    const out: LonLat[] = [route[0]!];
    for (let i = 0; i < route.length - 1; i++) {
        const p1 = plane[i]!, p2 = plane[i + 1]!;
        const p0 = i > 0 ? plane[i - 1]! : reflect(p1, p2);
        const p3 = i + 2 < plane.length ? plane[i + 2]! : reflect(p2, p1);
        const knot = (a: readonly [number, number], b: readonly [number, number]) => Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-6);
        const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
        const mix = (a: readonly [number, number], b: readonly [number, number], ta: number, tb: number, t: number): [number, number] => {
            const wa = (tb - t) / (tb - ta), wb = (t - ta) / (tb - ta);
            return [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1]];
        };
        const pieces = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / SAMPLE_M));
        const sampled: LonLat[] = [];
        for (let k = 1; k < pieces; k++) {
            const t = t1 + (t2 - t1) * k / pieces;
            const a1 = mix(p0, p1, t0, t1, t), a2 = mix(p1, p2, t1, t2, t), a3 = mix(p2, p3, t2, t3, t);
            const b1 = mix(a1, a2, t0, t2, t), b2 = mix(a2, a3, t1, t3, t);
            sampled.push(back(mix(b1, b2, t1, t2, t)));
        }
        const chain = [route[i]!, ...sampled, route[i + 1]!];
        let clear = true;
        for (let k = 1; clear && k < chain.length; k++) clear = straightLineInWater(grid, chain[k - 1]!, chain[k]!);
        if (clear) out.push(...sampled);
        out.push(route[i + 1]!);
    }
    return out;
}

/** Whether a goes before b, by longitude and then latitude: a pair is routed from its smaller end. */
const comesFirst = (a: LonLat, b: LonLat) => a[0] !== b[0] ? a[0] < b[0] : a[1] <= b[1];

/**
 * Whether every hop of a route is clear across water in the plain mask. A hop to a given
 * point that is itself on land (an observer on shore) is let through, as the plain route's is.
 */
function hopsClear(grid: WaterGrid, path: readonly LonLat[], from: LonLat, to: LonLat): boolean {
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!, b = path[i]!;
        const onShore = (a === from && !grid.isWater(a[0], a[1])) || (b === to && !grid.isWater(b[0], b[1]));
        if (!onShore && !straightLineInWater(grid, a, b)) return false;
    }
    return true;
}

/**
 * The path a leg is drawn along (decision 113): the coordinates from `a` to `b`, rounded to
 * 5 decimals (about a metre), when the straight line between them crosses land and a route
 * by sea within the join's search limit goes around; null when the straight line is in
 * water already, or no route is found, or a point is outside the mask or beyond reach of
 * water, so the leg is drawn straight as before.
 *
 * Since salish-84y0 the path is drawn smooth and off the shore, not only around it: the
 * route is searched in the mask with the land grown by a cell (and in the plain mask when
 * that finds none within the limit, as at a pass a cell or two wide), then run through
 * `smoothRoute`. The pair is routed from its smaller end, so a track going out and back
 * along one route draws the one line twice. The join's own distance is unchanged.
 */
export type LegOf = (a: LonLat, b: LonLat) => LonLat[] | null;

export function seaLegFor(grid: WaterGrid): LegOf {
    return (a, b) => {
        const forward = comesFirst(a, b);
        const [from, to] = forward ? [a, b] : [b, a];
        const found = seaDistance(grid, from, to, {limitM: JOIN_SEARCH_M});
        if (found.kind !== 'routed' || found.distanceM > JOIN_LIMIT_M) return null;
        let route = found.path;
        const margin = seaDistance(erodedByOneCell(grid), from, to, {limitM: JOIN_SEARCH_M});
        if (margin.kind === 'routed' && margin.distanceM <= JOIN_LIMIT_M && hopsClear(grid, margin.path, from, to)) route = margin.path;
        const smooth = smoothRoute(grid, route).map(([lon, lat]): LonLat => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
        const leg = smooth.filter((p, i) => i === 0 || p[0] !== smooth[i - 1]![0] || p[1] !== smooth[i - 1]![1]);
        return forward ? leg : leg.reverse();
    };
}

/**
 * The join rule's distance (decision 063, amended): metres by sea, or null when no route is
 * within the 20 km limit. A report outside the mask, or on land with no water within reach,
 * has no sea to measure in, so it is measured in a straight line as before and can still join.
 */
export function seaDistanceFor(grid: WaterGrid): (a: LonLat, b: LonLat) => number | null {
    return (a, b) => {
        const found = seaDistance(grid, a, b, {limitM: JOIN_SEARCH_M});
        switch (found.kind) {
            case 'straight':
            case 'routed': return found.distanceM > JOIN_LIMIT_M ? null : found.distanceM;
            case 'beyond-limit': return null;
            case 'out-of-range':
            case 'no-water': return distance(a, b) * 1000;
        }
    };
}

/** Moves of the reach search: the eight neighbours, and the eight knight's moves, which cut the error of a ring in open water from about 8% to about 2%. */
const REACH_MOVES: readonly (readonly [number, number])[] = [
    ...NEIGHBOURS,
    [-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2],
];

/**
 * How far it is by water from a point to every cell of the mask within `radiusM` of it
 * (decision 115): Dijkstra over the cells, with the neighbours' and the knight's moves
 * and each move's length in metres. A knight's move needs the two cells it passes between
 * to be water, so it never cuts a corner of land. A point on land is first moved to the
 * nearest water within SNAP_RADIUS_M, as `seaDistance` does. Returns the distances in
 * metres over the window of cells that was searched, Infinity where not reached; null when
 * the point is outside the mask or no water is near it.
 */
export function waterDistanceField(grid: WaterGrid, at: LonLat, radiusM: number):
    {c0: number, r0: number, w: number, h: number, metres: Float64Array} | null {
    if (!grid.contains(at[0], at[1])) return null;
    const start = grid.isWater(at[0], at[1]) ? [Math.floor(grid.colAt(at[0])), Math.floor(grid.rowAt(at[1]))] as [number, number] : nearestWaterCell(grid, at[0], at[1], SNAP_RADIUS_M);
    if (!start) return null;
    const [mxHere, my] = grid.metresPerCell(start[1]);
    const reachR = Math.ceil(radiusM / my) + 1;
    const reachC = Math.ceil(radiusM / mxHere) + 1;
    const c0 = Math.max(0, start[0] - reachC), c1 = Math.min(grid.width - 1, start[0] + reachC);
    const r0 = Math.max(0, start[1] - reachR), r1 = Math.min(grid.height - 1, start[1] + reachR);
    const w = c1 - c0 + 1, h = r1 - r0 + 1;
    const mx = new Float64Array(h);
    for (let r = 0; r < h; r++) mx[r] = grid.metresPerCell(r0 + r)[0];

    const metres = new Float64Array(w * h).fill(Infinity);
    const open: Heap = {f: [], id: []};
    const startId = (start[1] - r0) * w + (start[0] - c0);
    metres[startId] = 0;
    push(open, 0, startId);
    while (open.f.length > 0) {
        const f = open.f[0]!;
        const id = pop(open);
        if (f > metres[id]!) continue; // a stale entry
        const c = c0 + id % w, r = r0 + Math.floor(id / w);
        for (const [dc, dr] of REACH_MOVES) {
            const nc = c + dc, nr = r + dr;
            if (nc < c0 || nc > c1 || nr < r0 || nr > r1 || !grid.isWaterCell(nc, nr)) continue;
            if (Math.abs(dc) === 2 && !(grid.isWaterCell(c + dc / 2, r) && grid.isWaterCell(c + dc / 2, nr))) continue;
            if (Math.abs(dr) === 2 && !(grid.isWaterCell(c, r + dr / 2) && grid.isWaterCell(nc, r + dr / 2))) continue;
            const g = f + Math.hypot(dc * (mx[r - r0]! + mx[nr - r0]!) / 2, dr * my);
            const nid = (nr - r0) * w + (nc - c0);
            if (g >= metres[nid]! || g > radiusM) continue;
            metres[nid] = g;
            push(open, g, nid);
        }
    }
    return {c0, r0, w, h, metres};
}

export type ReachOf = (at: LonLat, speedKmph: number, observedAtMs: number) => Reach | null;

/** How long a ring is drawn for (segments.ts: nothing from six hours), and half an hour more, which the farther ring reaches. */
const REACH_HOURS = 6.5;
/** Metres between a reach's samples. */
const REACH_CELL_M = 500;

/**
 * The reach of a track's last report (decision 115): written for a report seen in the last
 * REACH_HOURS before `now()` that has a travel speed, as a square of samples centred on
 * the report and reaching speed × REACH_HOURS in every direction. Each sample is the
 * distance by water to the 90 m cell it falls in, in units of UNIT_M, UNREACHABLE for land
 * and for water beyond the radius. Null for an older report, a report outside the mask or
 * far from water.
 */
export function seaReachFor(grid: WaterGrid, now: () => number = Date.now): ReachOf {
    return (at, speedKmph, observedAtMs) => {
        const ageHours = (now() - observedAtMs) / 3_600_000;
        if (!(speedKmph > 0) || ageHours > REACH_HOURS) return null;
        const radiusM = speedKmph * 1000 * REACH_HOURS;
        const field = waterDistanceField(grid, at, radiusM);
        if (!field) return null;
        const half = Math.ceil(radiusM / REACH_CELL_M);
        const size = 2 * half + 1;
        const round5 = (x: number) => Math.round(x * 1e5) / 1e5;
        const lat = reachSteps({cell: REACH_CELL_M, height: size, north: 0}).lat;
        const north = round5(at[1] + half * lat);
        const steps = reachSteps({cell: REACH_CELL_M, height: size, north});
        const west = round5(at[0] - half * steps.lon);
        const bytes = new Uint8Array(size * size).fill(UNREACHABLE);
        for (let j = 0; j < size; j++) {
            for (let i = 0; i < size; i++) {
                const col = Math.floor(grid.colAt(west + i * steps.lon)), row = Math.floor(grid.rowAt(north - j * steps.lat));
                if (col < field.c0 || col >= field.c0 + field.w || row < field.r0 || row >= field.r0 + field.h) continue;
                const metres = field.metres[(row - field.r0) * field.w + (col - field.c0)]!;
                if (metres === Infinity) continue;
                bytes[j * size + i] = Math.min(FAR, Math.round(metres / UNIT_M));
            }
        }
        return {cell: REACH_CELL_M, width: size, height: size, west, north, values: encodeValues(bytes)};
    };
}
