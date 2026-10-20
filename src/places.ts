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
export const PLACE_LISTS: readonly string[] = ['https://tiles.salishsea.io/places/places-gazetteers-6ebc4b7473854290.json', 'https://tiles.salishsea.io/places/places-osm-c2e7cd37c8651122.json'];

/**
 * One list as the basemap writes it: its places as rows of its columns. The OpenStreetMap
 * list also says which island each of the gazetteers' places that shares its name with
 * another is on, found from OpenStreetMap's outlines, so it is under the ODbL with them.
 */
export interface PlaceList {
  columns: string[];
  places: unknown[][];
  gazetteer_islands?: { columns: string[]; rows: unknown[][] };
}

/** A place as a list gives it. Its zoom is MapLibre's, which counts 512-pixel tiles. */
export interface Place {
  name: string;
  kind: string;
  lon: number;
  lat: number;
  zoom: number;
  otherNames: string[];
  /** The island it is on or beside, where a list says so. */
  island?: string;
}

/** What a result says a place is. A kind the lists add later is still found, and says "Place". */
const KIND_NOTES: Record<string, string> = {
  water: 'Water', point: 'Point', island: 'Island', islet: 'Islet', city: 'City', town: 'Town', village: 'Village',
  hamlet: 'Hamlet', suburb: 'Neighborhood', quarter: 'Neighborhood', neighbourhood: 'Neighborhood', ferry_terminal: 'Ferry terminal',
};

/** The places that tell apart two of one name when no island does: "Rocky Point · Point · near Oak Harbor". */
const TOWN_KINDS = new Set(['city', 'town', 'village']);

/**
 * The closest zoom at which an island too big to tell two places apart fits the map:
 * Vancouver Island (6) and Whidbey Island (8) each hold several Mud Bays or Rocky Points.
 * Saltspring Island fits at 9, and San Juan Island at 10.
 */
const LARGEST_TELLING_ISLAND = 9;

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

/** The islands a list names for the gazetteers' places, by each place's name and position. */
export function readIslands(list: PlaceList): Map<string, string> {
  const table = list.gazetteer_islands;
  if (!table) return new Map();
  const [name, lon, lat, island] = ['name', 'lon', 'lat', 'island'].map(c => table.columns.indexOf(c));
  if ([name, lon, lat, island].some(i => i! < 0)) throw new Error('a table of islands without the columns it needs');
  return new Map(table.rows.map(row => [islandKey(String(row[name!]), Number(row[lon!]), Number(row[lat!])), String(row[island!])]));
}

const islandKey = (name: string, lon: number, lat: number) => `${name} ${lon} ${lat}`;

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
 * Mud Bays do, each says the island it is on, or else the town it is nearest. Friday
 * Harbor the bay, the town and the ferry terminal are told apart by their kinds already.
 */
export function placeEntries(places: readonly Place[]): SearchEntry[] {
  const key = (p: Place) => `${p.kind} ${fold(p.name)}`;
  const namesakes = new Map<string, Place[]>();
  for (const p of places) namesakes.set(key(p), [...namesakes.get(key(p)) ?? [], p]);
  const islandZooms = new Map(places.filter(p => p.kind === 'island').map(p => [p.name, p.zoom]));
  const towns = new Grid(places.filter(p => TOWN_KINDS.has(p.kind)));
  const onIsland = (place: Place): string | undefined =>
    place.island && (islandZooms.get(place.island) ?? 0) >= LARGEST_TELLING_ISLAND ? `on ${place.island}` : undefined;
  const nearTown = (place: Place): string | undefined => {
    const town = towns.nearest(place);
    return town && `near ${town.name}`;
  };
  // An island two namesakes are both on doesn't tell them apart, so they say a town instead;
  // and a note that still doesn't tell a place from its namesakes says nothing, so it is left off.
  const notes = new Map<Place, string | undefined>();
  for (const same of namesakes.values()) {
    if (same.length < 2) continue;
    const islands = same.map(onIsland);
    const wheres = same.map((p, i) => islands[i] && islands.indexOf(islands[i]) === islands.lastIndexOf(islands[i]) ? islands[i] : nearTown(p));
    same.forEach((p, i) => notes.set(p, wheres.filter(w => w === wheres[i]).length > 1 ? undefined : wheres[i]));
  }
  return places.map(place => ({
    kind: 'place',
    label: place.name,
    note: [KIND_NOTES[place.kind] ?? 'Place', notes.get(place)].filter(Boolean).join(' · '),
    keys: [...new Set([place.name, ...place.otherNames].map(fold))],
    href: placeHref(place),
  }));
}

/** Every list's places as search results; a list that fails to load is left out, so the rest are still found. */
export async function loadPlaceEntries(lists: readonly string[] = PLACE_LISTS): Promise<SearchEntry[]> {
  const loaded = await Promise.allSettled(lists.map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const list = await response.json() as PlaceList;
    return { places: readPlaces(list), islands: readIslands(list) };
  }));
  const read = loaded.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const islands = new Map(read.flatMap(r => [...r.islands]));
  return placeEntries(read.flatMap(r => r.places).map(p => {
    const island = islands.get(islandKey(p.name, p.lon, p.lat));
    return island ? { ...p, island } : p;
  }));
}
