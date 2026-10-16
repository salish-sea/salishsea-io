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

  test('namesakes of one kind say what they are near; other kinds tell themselves apart', () => {
    const entries = placeEntries([
      place('Mud Bay', 'water', -122.83, 48.46),
      place('Mud Bay', 'water', -122.95, 47.06),
      place('Lopez Island', 'island', -122.87, 48.49),
      place('Olympia', 'city', -122.9, 47.04),
      place('Friday Harbor', 'water', -123.008, 48.536),
      place('Friday Harbor', 'village', -123.017, 48.534),
    ]);
    expect(entries.map(e => `${e.label} · ${e.note}`)).toEqual([
      'Mud Bay · Water · near Lopez Island',
      'Mud Bay · Water · near Olympia',
      'Lopez Island · Island',
      'Olympia · City',
      'Friday Harbor · Water',
      'Friday Harbor · Village',
    ]);
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
  });
});
