/**
 * The landmark near a sighting (decision 100): the nearest name reporters use within 5 km
 * of its point, which a card writes after the water region, "Haro Strait, off Lime Kiln Point".
 *
 * The names are data/reference/landmarks.tsv, which scripts/propose-landmarks.ts writes
 * from the Maplify reports and a pull request reviews. A gazetteer row carries its
 * position, which tells namesakes apart (there are five Sandy Points). An OpenStreetMap
 * row carries none, since the list would otherwise be a work derived from OpenStreetMap
 * under the ODbL; its position comes from the basemap's OpenStreetMap place list, which
 * the build fetches (fetch-water-regions.ts), by its name and kind.
 *
 * A point of land or a ferry landing sits on the shore, so it counts only if it is on the
 * sighting's own water: within 0.5 km of its region's edge. A town, village, city or
 * island has only a point near its middle in the list, so it counts by distance alone.
 */

import { parseTsv } from '../register/edition.ts';
import type { WaterRegions } from './water-regions.ts';

export const LANDMARK_COLUMNS = ['name', 'kind', 'source', 'lon', 'lat', 'reports', 'says'] as const;

/** A row of landmarks.tsv. `says` is what a card writes; an empty one is never a landmark. */
export type LandmarkRow = {
    name: string, kind: string, source: 'gazetteers' | 'osm',
    lon: number | null, lat: number | null, reports: number, says: string | null,
};

/** A place list as the basemap publishes it (basemap decision 018): named columns, then rows. */
export type PlaceList = {columns: string[], places: unknown[][]};

export type Landmark = {says: string, kind: string, lon: number, lat: number};

const RADIUS_KM = 5;
const SHORE_KM = 0.5;
/** The kinds that sit on the shore, and so can be checked against the region. */
const ON_SHORE = new Set(['point', 'ferry_terminal']);

export function parseLandmarks(tsv: string): LandmarkRow[] {
    return parseTsv(tsv, LANDMARK_COLUMNS).map(([name, kind, source, lon, lat, reports, says]) => {
        if (!name || !kind || (source !== 'gazetteers' && source !== 'osm'))
            throw new Error(`landmarks.tsv: a row needs a name, a kind and a source of gazetteers or osm: ${name}`);
        if ((source === 'gazetteers') !== (lon !== null && lat !== null))
            throw new Error(`landmarks.tsv: ${name}: a gazetteer row has a position and an OpenStreetMap row has none`);
        return {name, kind, source, lon: lon === null ? null : Number(lon), lat: lat === null ? null : Number(lat),
            reports: Number(reports ?? 0), says: says ?? null};
    });
}

/** The list's places as objects, by its own column names. */
export function placesOf(list: PlaceList): {name: string, kind: string, lon: number, lat: number}[] {
    const col = (c: string) => {
        const i = list.columns.indexOf(c);
        if (i < 0) throw new Error(`the place list has no ${c} column`);
        return i;
    };
    const [name, kind, lon, lat] = [col('name'), col('kind'), col('lon'), col('lat')];
    return list.places.map(p => ({name: p[name] as string, kind: p[kind] as string, lon: p[lon] as number, lat: p[lat] as number}));
}

/**
 * The rows that are landmarks, where they are: a gazetteer row at its own position, an
 * OpenStreetMap row at every place of its name and kind in the list (two Stuart Islands,
 * far enough apart that distance chooses). `unmatched` names the OpenStreetMap rows the
 * list has no place for, which a basemap version that renamed one would leave.
 */
export function resolveLandmarks(rows: readonly LandmarkRow[], osm: PlaceList): {landmarks: Landmark[], unmatched: LandmarkRow[]} {
    const byName = new Map<string, {lon: number, lat: number}[]>();
    for (const p of placesOf(osm)) {
        const key = `${p.kind}\t${p.name}`;
        (byName.get(key) ?? byName.set(key, []).get(key)!).push(p);
    }
    const landmarks: Landmark[] = [];
    const unmatched: LandmarkRow[] = [];
    for (const row of rows) {
        if (row.source === 'gazetteers') {
            if (row.says) landmarks.push({says: row.says, kind: row.kind, lon: row.lon!, lat: row.lat!});
            continue;
        }
        const at = byName.get(`${row.kind}\t${row.name}`);
        if (!at) { unmatched.push(row); continue; }
        if (row.says) for (const {lon, lat} of at) landmarks.push({says: row.says, kind: row.kind, lon, lat});
    }
    return {landmarks, unmatched};
}

/** Distance in km, on a plane through the first point: close enough within 5 km. */
function km(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const kx = 111.2 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 111.2);
}

export type Landmarks = {
    /** What a card writes for the landmark near a point in the named region, or null. */
    landmarkAt(lon: number, lat: number, region: string): string | null,
    size: number,
};

export function landmarks(list: readonly Landmark[], regions: WaterRegions): Landmarks {
    // whether each landmark on the shore is on a region's water, asked once per pair
    const borders = new Map<string, boolean>();
    const onRegion = (i: number, region: string) => {
        const key = `${i}\t${region}`;
        let b = borders.get(key);
        if (b === undefined) {
            const l = list[i]!;
            borders.set(key, b = regions.borders(region, l.lon, l.lat, SHORE_KM));
        }
        return b;
    };
    return {
        size: list.length,
        landmarkAt(lon, lat, region) {
            const near: [number, number][] = [];
            list.forEach((l, i) => {
                const d = km(lon, lat, l.lon, l.lat);
                if (d <= RADIUS_KM) near.push([d, i]);
            });
            near.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            for (const [, i] of near)
                if (!ON_SHORE.has(list[i]!.kind) || onRegion(i, region)) return list[i]!.says;
            return null;
        },
    };
}
