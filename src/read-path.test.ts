import { afterEach, describe, expect, test, vi } from 'vitest';

import { fetchDayOccurrences, parseReadSource } from './read-path.ts';
import type { Extent } from './extents.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseReadSource', () => {
  test('defaults to supabase', () => {
    expect(parseReadSource(undefined)).toBe('supabase');
    expect(parseReadSource('')).toBe('supabase');
    expect(parseReadSource('supabase')).toBe('supabase');
  });

  test('reads static', () => {
    expect(parseReadSource('static')).toBe('static');
  });

  test('refuses anything else rather than quietly reading the other source', () => {
    expect(() => parseReadSource('Static')).toThrow(/VITE_READ_SOURCE/);
  });
});

type Row = {id: string, location: {lon: number | null, lat: number | null} | null};

function serve(status: number, body: unknown = null) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body === null ? null : JSON.stringify(body), {status}),
  );
}

const box: Extent = [-123, 48, -122, 49];

const day: Row[] = [
  {id: 'inside', location: {lon: -122.5, lat: 48.5}},
  {id: 'on-the-edge', location: {lon: -123, lat: 49}},
  {id: 'outside', location: {lon: -124, lat: 48.5}},
  {id: 'no-location', location: null},
  {id: 'half-location', location: {lon: -122.5, lat: null}},
];

describe('fetchDayOccurrences', () => {
  test('asks for the day file on this origin', async () => {
    const fetch = serve(200, []);
    await fetchDayOccurrences<Row>('2025-03-09', null);
    expect(fetch).toHaveBeenCalledWith('/read-path/days/2025-03-09.json');
  });

  test('with no region, every row, in the file\'s order', async () => {
    serve(200, day);
    expect((await fetchDayOccurrences<Row>('2025-03-09', null)).map(r => r.id))
      .toEqual(day.map(r => r.id));
  });

  test('a region keeps what PostgREST\'s inclusive bounds kept', async () => {
    serve(200, day);
    expect((await fetchDayOccurrences<Row>('2025-03-09', box)).map(r => r.id))
      .toEqual(['inside', 'on-the-edge']);
  });

  test('a day with no file is a day with no sightings', async () => {
    serve(404);
    expect(await fetchDayOccurrences<Row>('2025-03-09', null)).toEqual([]);
  });

  test('any other failure throws, so the caller reports it', async () => {
    serve(503);
    await expect(fetchDayOccurrences<Row>('2025-03-09', null)).rejects.toThrow(/HTTP 503/);
  });
});
