/**
 * The places the search field finds: the Salish Sea's larger places the basemap labels, from
 * the two lists each basemap version publishes beside its tiles (salish-sea/basemap's
 * decision 018). One holds the larger water bodies and points from the US and Canadian
 * gazetteers, the other the larger islands, the cities, towns and villages, and the ferry
 * terminals OpenStreetMap names. Choosing a place opens the map there.
 *
 * The lists are fetched the first time the search is opened, after the search index
 * (src/site-search.ts). Together they are about 32 KB gzipped, and a page that is never
 * searched never loads them.
 */

import { fold } from './fold.ts';
import { fromLonLat, permalinkZoom } from './map-view.ts';
import type { SearchEntry } from './search.ts';

/** The lists, as the basemap version in src/basemap-style.json names them; scripts/update-basemap.ts rewrites this line. */
export const PLACE_LISTS: readonly string[] = ['https://tiles.salishsea.io/places/places-gazetteers-6ebc4b7473854290.json', 'https://tiles.salishsea.io/places/places-osm-c356e8a3b37250a1.json'];

/** One list as the basemap writes it: its places as rows of its columns. */
export interface PlaceList {
  columns: string[];
  places: unknown[][];
}

/** A place as a list gives it. Its zoom is MapLibre's, which counts 512-pixel tiles. */
export interface Place {
  name: string;
  kind: string;
  lon: number;
  lat: number;
  zoom: number;
  otherNames: string[];
}

/** What a result says a place is. A kind the lists add later is still found, and says "Place". */
const KIND_NOTES: Record<string, string> = {
  water: 'Water', point: 'Point', island: 'Island', islet: 'Islet', city: 'City', town: 'Town', village: 'Village',
  hamlet: 'Hamlet', suburb: 'Neighborhood', quarter: 'Neighborhood', neighbourhood: 'Neighborhood', ferry_terminal: 'Ferry terminal',
};

/** The places that tell apart two of one name: "Mud Bay · Water · near Lopez Island". */
const LANDMARK_KINDS = new Set(['island', 'city', 'town', 'village']);

/**
 * Bounds on the zoom a place opens at. Straits are labelled from zoom 6, which shows the
 * whole coast; SalishSea.io's map is for looking closer than that.
 */
const ZOOMS = [8, 15] as const;

/** The rows of a list as places; a list without the columns this reads is an error, not an empty list. */
export function readPlaces(list: PlaceList): Place[] {
  const at = (column: string) => {
    const i = list.columns.indexOf(column);
    if (i < 0) throw new Error(`a place list without a ${column} column`);
    return i;
  };
  const [name, kind, lon, lat, zoom, otherNames] = ['name', 'kind', 'lon', 'lat', 'zoom', 'other_names'].map(at) as
    [number, number, number, number, number, number];
  return list.places.map(row => ({
    name: String(row[name]),
    kind: String(row[kind]),
    lon: Number(row[lon]),
    lat: Number(row[lat]),
    zoom: Number(row[zoom]),
    otherNames: Array.isArray(row[otherNames]) ? (row[otherNames] as unknown[]).map(String) : [],
  }));
}

/** The map, centred on a place at its zoom, in the permalink's terms (src/map-view.ts). */
export function placeHref(place: Place): string {
  const [x, y] = fromLonLat([place.lon, place.lat]);
  const zoom = Math.min(ZOOMS[1], Math.max(ZOOMS[0], place.zoom));
  return `/?x=${Math.round(x)}&y=${Math.round(y)}&z=${permalinkZoom(zoom)}`;
}

/** Places to name a neighbour by, in cells a tenth of a degree a side, so finding the nearest looks at few. */
class Grid {
  private cells = new Map<string, Place[]>();
  constructor(places: readonly Place[]) {
    for (const p of places) {
      const key = Grid.key(Math.floor(p.lon * 10), Math.floor(p.lat * 10));
      const cell = this.cells.get(key);
      if (cell) cell.push(p);
      else this.cells.set(key, [p]);
    }
  }
  private static key(i: number, j: number) {
    return `${i},${j}`;
  }
  /**
   * The place within about 30 km, with another name, that is nearest for its size, or none.
   * A place's zoom stands for its size, so a bay on Lopez Island is near Lopez Island,
   * not the rock off its shore.
   */
  nearest(place: Place): Place | undefined {
    const i0 = Math.floor(place.lon * 10), j0 = Math.floor(place.lat * 10);
    const scale = Math.cos(place.lat * Math.PI / 180);
    let best: Place | undefined, bestDistance = Infinity;
    for (let i = i0 - 3; i <= i0 + 3; i++) {
      for (let j = j0 - 3; j <= j0 + 3; j++) {
        for (const p of this.cells.get(Grid.key(i, j)) ?? []) {
          if (p.name === place.name) continue;
          const d = Math.hypot((p.lon - place.lon) * scale, p.lat - place.lat) * 2 ** p.zoom;
          if (d < bestDistance) [best, bestDistance] = [p, d];
        }
      }
    }
    return best;
  }
}

/**
 * The places as search results. Where two places of one kind share a name, as the several
 * Mud Bays do, each says which island or town it is nearest. Friday Harbor the bay, the
 * town and the ferry terminal are told apart by their kinds already.
 */
export function placeEntries(places: readonly Place[]): SearchEntry[] {
  const key = (p: Place) => `${p.kind} ${fold(p.name)}`;
  const counts = new Map<string, number>();
  for (const p of places) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
  const grid = new Grid(places.filter(p => LANDMARK_KINDS.has(p.kind)));
  return places.map(place => {
    const near = (counts.get(key(place)) ?? 0) > 1 ? grid.nearest(place) : undefined;
    return {
      kind: 'place',
      label: place.name,
      note: [KIND_NOTES[place.kind] ?? 'Place', near && `near ${near.name}`].filter(Boolean).join(' · '),
      keys: [...new Set([place.name, ...place.otherNames].map(fold))],
      href: placeHref(place),
    };
  });
}

/** Every list's places as search results; a list that fails to load is left out, so the rest are still found. */
export async function loadPlaceEntries(lists: readonly string[] = PLACE_LISTS): Promise<SearchEntry[]> {
  const loaded = await Promise.allSettled(lists.map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return readPlaces(await response.json() as PlaceList);
  }));
  return placeEntries(loaded.flatMap(result => result.status === 'fulfilled' ? result.value : []));
}
