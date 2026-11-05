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
