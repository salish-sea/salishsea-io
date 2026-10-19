import { afterEach, describe, expect, test, vi } from 'vitest';

import { fromLonLat } from './map-view.ts';
import { loadPlaceEntries, placeEntries, placeHref, readPlaces, type Place, type PlaceList } from './places.ts';

const COLUMNS = ['name', 'kind', 'lon', 'lat', 'zoom', 'other_names'];
const place = (name: string, kind: string, lon: number, lat: number, zoom = 12, otherNames: string[] = []): Place =>
  ({ name, kind, lon, lat, zoom, otherNames });

describe('place lists (basemap decision 018)', () => {
  test('rows are read by the columns the list names, in whatever order', () => {
    const list: PlaceList = { columns: ['lat', 'lon', 'name', 'kind', 'other_names', 'zoom'], places: [[48.53714, -123.06809, 'San Juan Island', 'island', [], 10]] };
    expect(readPlaces(list)).toEqual([place('San Juan Island', 'island', -123.06809, 48.53714, 10)]);
  });

  test('a list without a column it needs is an error', () => {
    expect(() => readPlaces({ columns: ['name', 'kind'], places: [] })).toThrow(/lon/);
  });

  test('a place opens the map at its point, a zoom above MapLibre\'s, never further out than 8 or in than 15', () => {
    const [x, y] = fromLonLat([-123.15245, 48.51587]);
    expect(placeHref(place('Lime Kiln Point', 'point', -123.15245, 48.51587, 12))).toBe(`/?x=${Math.round(x)}&y=${Math.round(y)}&z=13`);
    expect(placeHref(place('Strait of Georgia', 'water', -123.5, 49.2, 6))).toMatch(/&z=9$/);
    expect(placeHref(place('Friday Harbor', 'ferry_terminal', -123.014, 48.536, 16))).toMatch(/&z=16$/);
  });

  test('namesakes of one kind say the island they are on, or else the town they are near; other kinds tell themselves apart', () => {
    const entries = placeEntries([
      // Cattle Point on San Juan Island is nearer Lopez Island's middle than San Juan Island's.
      { ...place('Cattle Point', 'point', -122.96295, 48.45038), island: 'San Juan Island' },
      place('Cattle Point', 'point', -123.29167, 48.43833),
      place('San Juan Island', 'island', -123.06809, 48.53714, 10),
      place('Lopez Island', 'island', -122.87285, 48.49547, 10),
      place('Oak Bay', 'town', -123.3175, 48.4264),
      place('Friday Harbor', 'water', -123.008, 48.536),
      place('Friday Harbor', 'village', -123.017, 48.534),
    ]);
    expect(entries.map(e => `${e.label} · ${e.note}`)).toEqual([
      'Cattle Point · Point · on San Juan Island',
      'Cattle Point · Point · near Oak Bay',
      'San Juan Island · Island',
      'Lopez Island · Island',
      'Oak Bay · Town',
      'Friday Harbor · Water',
      'Friday Harbor · Village',
    ]);
  });

  test('an island too big to tell namesakes apart gives way to the nearest town', () => {
    const entries = placeEntries([
      { ...place('Rocky Point', 'point', -122.52432, 48.09648), island: 'Whidbey Island' },
      { ...place('Rocky Point', 'point', -122.69989, 48.32816), island: 'Whidbey Island' },
      place('Whidbey Island', 'island', -122.6, 48.2, 8),
      place('Langley', 'town', -122.4068, 48.0401),
      place('Oak Harbor', 'city', -122.6432, 48.2932),
    ]);
    expect(entries.slice(0, 2).map(e => e.note)).toEqual(['Point · near Langley', 'Point · near Oak Harbor']);
  });

  test('namesakes that would get the same note get none, since it would not tell them apart', () => {
    const entries = placeEntries([
      place('Kiapot Point', 'point', -123.04073, 48.07954),
      place('Kiapot Point', 'point', -123.02073, 48.08315),
      place('Sequim', 'city', -123.1018, 48.0796),
    ]);
    expect(entries.slice(0, 2).map(e => e.note)).toEqual(['Point', 'Point']);
  });

  test('a place answers to its other names too', () => {
    const [entry] = placeEntries([place('Saltspring Island', 'island', -123.48, 48.83, 9, ['Salt Spring Island'])]);
    expect(entry!.keys).toEqual(['saltspring island', 'salt spring island']);
  });

  describe('loading', () => {
    afterEach(() => vi.unstubAllGlobals());

    test('a list that fails to load is left out, and the others are still found', async () => {
      const lists: Record<string, PlaceList> = { 'https://t/a.json': { columns: COLUMNS, places: [['Haro Strait', 'water', -123.22, 48.56, 8, []]] } };
      vi.stubGlobal('fetch', vi.fn(async (url: string) =>
        lists[url] ? new Response(JSON.stringify(lists[url])) : new Response('', { status: 404 })));
      const entries = await loadPlaceEntries(['https://t/a.json', 'https://t/b.json']);
      expect(entries.map(e => e.label)).toEqual(['Haro Strait']);
    });

    test("one list's table of islands names the island of a place in another", async () => {
      const lists: Record<string, PlaceList> = {
        'https://t/gazetteers.json': { columns: COLUMNS, places: [
          ['Cattle Point', 'point', -122.96295, 48.45038, 11, []], ['Cattle Point', 'point', -123.29167, 48.43833, 12, []],
        ] },
        'https://t/osm.json': {
          columns: COLUMNS, places: [['San Juan Island', 'island', -123.06809, 48.53714, 10, []]],
          gazetteer_islands: { columns: ['name', 'lon', 'lat', 'island'], rows: [['Cattle Point', -122.96295, 48.45038, 'San Juan Island']] },
        },
      };
      vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(lists[url]))));
      const entries = await loadPlaceEntries(Object.keys(lists));
      expect(entries.map(e => `${e.label} · ${e.note}`).slice(0, 2)).toEqual(['Cattle Point · Point · on San Juan Island', 'Cattle Point · Point']);
    });
  });
});
