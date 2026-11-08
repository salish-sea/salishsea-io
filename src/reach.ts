/**
 * The reach along water around a track's last report (salish-2adm, decision 115): a small
 * raster of how far it is by water from the report to each point of a square window, which
 * the build writes on the report and the browser reads to draw the ring for whatever radius
 * the time of drawing asks. Pure TypeScript with no Node APIs: the build writes it and the
 * browser reads it.
 */
import type { LonLat } from './sea-distance.ts';

/** What a report carries as `reach`. */
export type Reach = {
    /** Metres between neighbouring samples, east to west and north to south. */
    cell: number;
    width: number;
    height: number;
    /** The top-left sample's longitude and latitude, in degrees (5 decimals). */
    west: number;
    north: number;
    /** Base64 of width × height bytes, row by row from the north: see `UNIT_M`, `FAR`, `UNREACHABLE`. */
    values: string;
};

/** A sample byte counts this many metres of distance by water. */
export const UNIT_M = 250;
/** A sample byte of 254 means farther than 254 units (63.5 km). */
export const FAR = 254;
/** A sample byte of 255 means not reachable: land, or beyond the radius the build searched. */
export const UNREACHABLE = 255;

const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LON_AT_EQUATOR = 111_320;

/**
 * Degrees between neighbouring samples. The window is centred on a latitude derived from
 * its own top edge, so the build and the browser agree on the longitude step without it
 * being written.
 */
export function reachSteps({cell, height, north}: Pick<Reach, 'cell' | 'height' | 'north'>): {lon: number, lat: number} {
    const lat = cell / METRES_PER_DEGREE_LAT;
    const centre = north - (height - 1) / 2 * lat;
    return {lon: cell / (METRES_PER_DEGREE_LON_AT_EQUATOR * Math.cos(centre * Math.PI / 180)), lat};
}

export function decodeValues(values: string): Uint8Array {
    const text = atob(values);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
}

export function encodeValues(bytes: Uint8Array): string {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}

/**
 * The closed lines (marching squares) that enclose the samples within `radiusM` of the
 * report by water: one for the outer edge of the reach, and one around each island or
 * stretch of land the reach goes round. Between two reachable samples the line is placed
 * by linear interpolation of their distances; between a reachable sample and land (or the
 * edge of what was searched) it is placed halfway, which is where the shore lies to within
 * half a sample. The window is padded with unreachable samples so every line closes.
 * Empty when no sample is within the radius (a report whose own sample is land).
 */
export function reachContours(reach: Reach, radiusM: number): LonLat[][] {
    const {width, height} = reach;
    const bytes = decodeValues(reach.values);
    if (bytes.length !== width * height) return [];
    const limit = radiusM / UNIT_M;
    // Padded by one sample all round: sample (i, j) of the window is (i + 1, j + 1) here.
    const w = width + 2, h = height + 2;
    const at = (i: number, j: number) => i < 1 || j < 1 || i > width || j > height ? UNREACHABLE : bytes[(j - 1) * width + (i - 1)]!;
    const inside = (i: number, j: number) => at(i, j) <= limit && at(i, j) < UNREACHABLE;

    const steps = reachSteps(reach);
    const lonLat = (i: number, j: number): LonLat => [reach.west + (i - 1) * steps.lon, reach.north - (j - 1) * steps.lat];

    // Where the line crosses the edge between two neighbouring samples, one inside and one not.
    const points = new Map<number, LonLat>();
    const crossing = (i0: number, j0: number, i1: number, j1: number): number => {
        const key = (j0 + j1) * 2 * w + (i0 + i1); // unique per edge: the doubled midpoint
        if (!points.has(key)) {
            const [a, b] = inside(i0, j0) ? [[i0, j0], [i1, j1]] as const : [[i1, j1], [i0, j0]] as const;
            const va = at(a[0], a[1]), vb = at(b[0], b[1]);
            const t = vb >= UNREACHABLE ? 0.5 : Math.min(1, Math.max(0, (limit - va) / (vb - va)));
            const [x0, y0] = lonLat(a[0], a[1]), [x1, y1] = lonLat(b[0], b[1]);
            points.set(key, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
        }
        return key;
    };

    const links = new Map<number, number[]>();
    const link = (a: number, b: number) => {
        for (const [p, q] of [[a, b], [b, a]] as const) {
            const list = links.get(p);
            if (list) list.push(q); else links.set(p, [q]);
        }
    };
    for (let j = 0; j < h - 1; j++) {
        for (let i = 0; i < w - 1; i++) {
            const tl = inside(i, j), tr = inside(i + 1, j), br = inside(i + 1, j + 1), bl = inside(i, j + 1);
            const top = tl !== tr, right = tr !== br, bottom = bl !== br, left = tl !== bl;
            const edge = {
                top: () => crossing(i, j, i + 1, j), right: () => crossing(i + 1, j, i + 1, j + 1),
                bottom: () => crossing(i, j + 1, i + 1, j + 1), left: () => crossing(i, j, i, j + 1),
            };
            if (top && right && bottom && left) {
                // A saddle: keep the two inside corners apart.
                if (tl) { link(edge.top(), edge.left()); link(edge.right(), edge.bottom()); }
                else { link(edge.top(), edge.right()); link(edge.bottom(), edge.left()); }
                continue;
            }
            const crossed = (['top', 'right', 'bottom', 'left'] as const).filter(side => ({top, right, bottom, left})[side]);
            if (crossed.length === 2) link(edge[crossed[0]!](), edge[crossed[1]!]());
        }
    }

    const loops: LonLat[][] = [];
    const seen = new Set<number>();
    for (const start of links.keys()) {
        if (seen.has(start)) continue;
        const loop: LonLat[] = [];
        let previous = -1, current = start;
        while (!seen.has(current)) {
            seen.add(current);
            loop.push(points.get(current)!);
            const next = links.get(current)!.find(k => k !== previous && !seen.has(k)) ?? links.get(current)!.find(k => k === start && k !== previous);
            if (next === undefined) break;
            previous = current;
            current = next;
        }
        if (loop.length >= 3) loops.push([...loop, loop[0]!]);
    }
    return loops;
}

/** A loop's area in square degrees (shoelace), for choosing the largest. */
export function loopArea(loop: readonly LonLat[]): number {
    let twice = 0;
    for (let k = 1; k < loop.length; k++) twice += loop[k - 1]![0] * loop[k]![1] - loop[k]![0] * loop[k - 1]![1];
    return Math.abs(twice) / 2;
}
