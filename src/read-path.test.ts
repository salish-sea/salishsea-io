import { afterEach, describe, expect, test, vi } from 'vitest';

import { fetchDayOccurrences, parseReadSource, watchManifest, type Manifest } from './read-path.ts';
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
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(body === null ? null : JSON.stringify(body), {status}),
  );
}

/** A day file's response, and the manifest's: `null` for either is a 404. */
function serveDayAndManifest(day: unknown, manifest: Manifest | null) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
    const body = String(url).endsWith('manifest.json') ? manifest : day;
    return new Response(body === null ? null : JSON.stringify(body), {status: body === null ? 404 : 200});
  });
}

const manifest = (coveredThrough: string, takenAt = `${coveredThrough}T20:00:00.000Z`): Manifest =>
  ({version: 1, snapshot_taken_at: takenAt, covered_through: coveredThrough});

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

  test('a missing day the last build covered is a day with no sightings', async () => {
    serveDayAndManifest(null, manifest('2025-03-09'));
    expect(await fetchDayOccurrences<Row>('2025-03-09', null)).toEqual([]);
  });

  test('a missing day past the last build is not built yet, not quiet', async () => {
    serveDayAndManifest(null, manifest('2025-03-08'));
    await expect(fetchDayOccurrences<Row>('2025-03-09', null)).rejects.toThrow(/not built yet/);
  });

  test('with no manifest, nothing is built, so a missing day is not quiet either', async () => {
    serveDayAndManifest(null, null);
    await expect(fetchDayOccurrences<Row>('2025-03-09', null)).rejects.toThrow(/covered through nothing/);
  });

  test('any other failure throws, so the caller reports it', async () => {
    serve(503);
    await expect(fetchDayOccurrences<Row>('2025-03-09', null)).rejects.toThrow(/HTTP 503/);
  });
});

describe('watchManifest', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Let the watcher's pending fetches settle. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  test('the first manifest is the baseline; a new snapshot is a new build', async () => {
    vi.useFakeTimers();
    let current: Manifest | null = manifest('2025-03-09', '2025-03-09T20:00:00.000Z');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(current), {status: 200}));
    const onNewBuild = vi.fn(() => true);
    const stop = watchManifest(onNewBuild, {intervalMs: 1000, isVisible: () => true});
    await settle();
    expect(onNewBuild).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewBuild).not.toHaveBeenCalled();

    current = manifest('2025-03-09', '2025-03-09T21:00:00.000Z');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewBuild).toHaveBeenCalledTimes(1);
    stop();
  });

  test('a hidden page does not poll', async () => {
    vi.useFakeTimers();
    const fetch = serve(200, manifest('2025-03-09'));
    const stop = watchManifest(() => true, {intervalMs: 1000, isVisible: () => false});
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).not.toHaveBeenCalled();
    stop();
  });

  test('a failed poll is not a new build', async () => {
    vi.useFakeTimers();
    const fetch = serve(200, manifest('2025-03-09'));
    const onNewBuild = vi.fn(() => true);
    const stop = watchManifest(onNewBuild, {intervalMs: 1000, isVisible: () => true});
    await settle();
    fetch.mockImplementation(async () => new Response(null, {status: 503}));
    await vi.advanceTimersByTimeAsync(3000);
    expect(onNewBuild).not.toHaveBeenCalled();
    stop();
  });

  test('a new build the page failed to load is tried again on the next poll', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(current), {status: 200}));
    let current = manifest('2025-03-09', '2025-03-09T20:00:00.000Z');
    const results = [false, true];
    const onNewBuild = vi.fn(() => results.shift() ?? true);
    const stop = watchManifest(onNewBuild, {intervalMs: 1000, isVisible: () => true});
    await settle();
    current = manifest('2025-03-09', '2025-03-09T21:00:00.000Z');
    await vi.advanceTimersByTimeAsync(1000);   // the load fails
    await vi.advanceTimersByTimeAsync(1000);   // so the same build is tried again, and loads
    await vi.advanceTimersByTimeAsync(1000);   // then it's seen, and nothing more happens
    expect(onNewBuild).toHaveBeenCalledTimes(2);
    stop();
  });

  test('a baseline taken after a failed first poll counts as a change', async () => {
    vi.useFakeTimers();
    const fetch = serve(503);
    const onNewBuild = vi.fn(() => true);
    const stop = watchManifest(onNewBuild, {intervalMs: 1000, isVisible: () => true});
    await settle();
    fetch.mockImplementation(async () => new Response(JSON.stringify(manifest('2025-03-09')), {status: 200}));
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewBuild).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewBuild).toHaveBeenCalledTimes(1);
    stop();
  });

  test('a poll still refetching when the next is due holds that one back', async () => {
    vi.useFakeTimers();
    let current = manifest('2025-03-09', '2025-03-09T20:00:00.000Z');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(current), {status: 200}));
    let finish!: (ok: boolean) => void;
    const onNewBuild = vi.fn(() => new Promise<boolean>(resolve => finish = resolve));
    const stop = watchManifest(onNewBuild, {intervalMs: 1000, isVisible: () => true});
    await settle();
    current = manifest('2025-03-09', '2025-03-09T21:00:00.000Z');
    await vi.advanceTimersByTimeAsync(1000);   // a new build: the refetch starts, and hangs
    const polls = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);   // three ticks pass while it runs
    expect(fetch.mock.calls.length).toBe(polls);
    expect(onNewBuild).toHaveBeenCalledTimes(1);
    finish(true);
    stop();
  });
});

