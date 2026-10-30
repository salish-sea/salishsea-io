/**
 * Which water region a point is in (salish-fwyt.2): the basemap's regions, one for each
 * water name its map labels, which together cover the water from 42°N to 51.5°N and
 * reach about 300 m onto the shore (basemap decision 027). Each has its name as a card
 * says it: "Haro Strait", "Mud Bay (Lopez Sound)", "off Vancouver Island". The list is
 * published beside the basemap's place lists and named in the style the site uses
 * (src/basemap-style.json, `salishsea:places`.regions); fetch-water-regions.ts brings it
 * to the build.
 *
 * The regions don't overlap, so a point is in one region or none: on land beyond the
 * shore, in fresh water, or outside the map's range. A point on a shared edge goes to
 * the region listed first, so the answer doesn't depend on anything but the list.
 */

/** The list as published: a GeoJSON FeatureCollection of Polygons and MultiPolygons. */
export type RegionList = {
    features: {
        properties: {name: string},
        geometry: {type: 'Polygon', coordinates: number[][][]} | {type: 'MultiPolygon', coordinates: number[][][][]},
    }[],
};

type Region = {name: string, order: number, bbox: [number, number, number, number], rings: Float64Array[]};

/** Grid cells, in degrees: about 1,500 regions over 9.5° of latitude, a few in each. */
const CELL = 0.1;
const cellKey = (x: number, y: number) => `${x},${y}`;

/**
 * Whether the point is inside the rings, by the even-odd rule over all of them, which a
 * Polygon's holes and a MultiPolygon's parts both satisfy, since their rings don't cross.
 */
function inside(rings: readonly Float64Array[], lon: number, lat: number): boolean {
    let odd = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
            const xi = ring[i]!, yi = ring[i + 1]!, xj = ring[j]!, yj = ring[j + 1]!;
            if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) odd = !odd;
        }
    }
    return odd;
}

export type WaterRegions = {
    /** The name of the region the point is in, or null when it is in none. */
    regionAt(lon: number, lat: number): string | null,
    size: number,
};

export function waterRegions(list: RegionList): WaterRegions {
    const grid = new Map<string, Region[]>();
    let order = 0;
    for (const {properties, geometry} of list.features) {
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        const rings = polygons.flat().map(ring => Float64Array.from(ring.flat()));
        let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const ring of rings) for (let i = 0; i < ring.length; i += 2) {
            w = Math.min(w, ring[i]!); e = Math.max(e, ring[i]!);
            s = Math.min(s, ring[i + 1]!); n = Math.max(n, ring[i + 1]!);
        }
        const region: Region = {name: properties.name, order: order++, bbox: [w, s, e, n], rings};
        for (let x = Math.floor(w / CELL); x <= Math.floor(e / CELL); x++)
            for (let y = Math.floor(s / CELL); y <= Math.floor(n / CELL); y++) {
                const key = cellKey(x, y);
                (grid.get(key) ?? grid.set(key, []).get(key)!).push(region);
            }
    }
    return {
        size: order,
        regionAt(lon, lat) {
            // a cell's regions are in the list's order, since they were added in it
            for (const r of grid.get(cellKey(Math.floor(lon / CELL), Math.floor(lat / CELL))) ?? []) {
                const [w, s, e, n] = r.bbox;
                if (lon >= w && lon <= e && lat >= s && lat <= n && inside(r.rings, lon, lat)) return r.name;
            }
            return null;
        },
    };
}
