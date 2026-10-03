import { afterEach, describe, expect, test, vi } from 'vitest';

import { addLiveNative, fetchCalendarCounts, fetchDayOccurrences, findOccurrence, overlayNative, parseReadSource, watchManifest, type Manifest } from './read-path.ts';
import { idShard } from './read-path-shard.ts';
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

describe('fetchCalendarCounts', () => {
  const files: Record<string, unknown> = {
    '2025-08': {'salish-sea': {'2025-08-30': 4, '2025-08-31': 5}, 'puget-sound': {'2025-08-31': 2}},
    '2025-09': {'salish-sea': {'2025-09-01': 7, '2025-09-15': 1}},
    '2025-10': {'salish-sea': {'2025-10-04': 3, '2025-10-20': 9}},
  };

  // What the build counted again as saved here (calendar/<month>.native.json).
  const nativeFiles: Record<string, unknown> = {
    '2025-08': {'salish-sea': {'2025-08-31': 2}},
    '2025-09': {'salish-sea': {'2025-09-15': 1}},
  };

  function serveCalendar(manifest: Manifest | null, missing: string[] = []) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('manifest.json'))
        return new Response(manifest && JSON.stringify(manifest), {status: manifest ? 200 : 404});
      const [, month, native] = u.match(/calendar\/(\d{4}-\d{2})(\.native)?\.json$/)!;
      const body = missing.includes(month!) ? undefined : (native ? nativeFiles : files)[month!];
      return new Response(body ? JSON.stringify(body) : null, {status: body ? 200 : 404});
    });
  }

  test('a grid across three months reads three files, clipped to the grid, for one region', async () => {
    const fetch = serveCalendar(manifest('2025-10-31'));
    const counts = await fetchCalendarCounts('2025-08-31', '2025-10-11', 'salish-sea');
    expect([...counts]).toEqual([['2025-08-31', 5], ['2025-09-01', 7], ['2025-09-15', 1], ['2025-10-04', 3]]);
    expect(fetch.mock.calls.map(([u]) => String(u))).toEqual([
      '/read-path/manifest.json',
      '/read-path/calendar/2025-08.json', '/read-path/calendar/2025-09.json', '/read-path/calendar/2025-10.json']);
  });

  test('a region with nothing in a month contributes nothing from it', async () => {
    serveCalendar(manifest('2025-10-31'));
    expect([...await fetchCalendarCounts('2025-08-31', '2025-10-11', 'puget-sound')]).toEqual([['2025-08-31', 2]]);
  });

  test('a missing month the last build covered is empty', async () => {
    serveCalendar(manifest('2025-10-31'), ['2025-09']);
    expect([...(await fetchCalendarCounts('2025-09-01', '2025-09-30', 'salish-sea')).keys()]).toEqual([]);
  });

  test('the grid\'s days in next month, past the last build, are not fetched and get no circle', async () => {
    const fetch = serveCalendar(manifest('2025-09-28'), ['2025-10']);
    const counts = await fetchCalendarCounts('2025-08-31', '2025-10-11', 'salish-sea');
    expect([...counts.keys()]).toEqual(['2025-08-31', '2025-09-01', '2025-09-15']);
    expect(fetch.mock.calls.map(([u]) => String(u))).not.toContain('/read-path/calendar/2025-10.json');
  });

  test('with nothing built, it throws rather than draw an empty month', async () => {
    serveCalendar(null);
    await expect(fetchCalendarCounts('2025-09-01', '2025-09-30', 'salish-sea')).rejects.toThrow(/nothing built/);
  });

  test('without native sightings, each month\'s native count comes off, and a day left with none has no circle', async () => {
    serveCalendar(manifest('2025-10-31'));
    const counts = await fetchCalendarCounts('2025-08-31', '2025-10-11', 'salish-sea', {withoutNative: true});
    // 08-31: 5 - 2; 09-15: 1 - 1, gone; October has no native file.
    expect([...counts]).toEqual([['2025-08-31', 3], ['2025-09-01', 7], ['2025-10-04', 3]]);
  });

  test('signed out, the native files are not fetched', async () => {
    const fetch = serveCalendar(manifest('2025-10-31'));
    await fetchCalendarCounts('2025-08-31', '2025-10-11', 'salish-sea');
    expect(fetch.mock.calls.map(([u]) => String(u)).filter(u => u.includes('.native.'))).toEqual([]);
  });
});

describe('addLiveNative', () => {
  test('adds each live sighting to its Pacific day, within the grid', () => {
    const counts = addLiveNative(new Map([['2025-09-14', 3]]), [
      // 22:00 Pacific on the 14th, though the 15th in UTC.
      {observed_at: '2025-09-15T05:00:00Z'},
      {observed_at: '2025-09-15T20:00:00Z'},
      {observed_at: '2025-10-20T20:00:00Z'},   // past the grid
    ], '2025-08-31', '2025-10-11');
    expect([...counts]).toEqual([['2025-09-14', 4], ['2025-09-15', 1]]);
  });
});

describe('overlayNative', () => {
  type Row = {id: string, observed_at: string, contributor_id: number | null};
  const row = (id: string, hour: number, contributor_id: number | null = null): Row =>
    ({id, observed_at: `2025-09-15T${String(hour).padStart(2, '0')}:00:00Z`, contributor_id});

  test('the file\'s upstream rows and the live native ones, newest first; the file\'s native rows go', () => {
    const file = [row('maplify:2', 20), row('native-old-copy', 19, 7), row('native-since-deleted', 18, 7), row('maplify:1', 17)];
    const live = [row('native-old-copy', 21, 7), row('native-new', 18, 3)];
    expect(overlayNative(file, live).map(r => r.id))
      .toEqual(['native-old-copy', 'maplify:2', 'native-new', 'maplify:1']);
  });

  test('upstream rows at the same instant keep the file\'s order', () => {
    const file = [row('b', 20), row('a', 20)];
    expect(overlayNative(file, []).map(r => r.id)).toEqual(['b', 'a']);
  });
});

describe('findOccurrence', () => {
  const linked = {id: 'maplify:42', location: {lon: -130, lat: 55}};   // outside every region
  const other = {id: 'maplify:43', location: {lon: -122.5, lat: 48.5}};

  function serveIndex({shard, day, manifest: m}: {shard?: Record<string, string>, day?: unknown[], manifest?: Manifest | null}) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      const body = u.endsWith('manifest.json') ? m ?? null
        : u.includes('/ids/') ? shard ?? null
        : u.includes('/days/') ? day ?? null
        : null;
      return new Response(body === null ? null : JSON.stringify(body), {status: body === null ? 404 : 200});
    });
  }

  test('reads the id\'s shard, then its day, and returns it whatever the region', async () => {
    const fetch = serveIndex({shard: {'maplify:42': '2025-03-09'}, day: [other, linked], manifest: manifest('2025-03-09')});
    expect(await findOccurrence<Row & {id: string}>('maplify:42')).toEqual(linked);
    expect(fetch.mock.calls.map(([u]) => String(u))).toEqual([
      `/read-path/ids/${idShard('maplify:42')}.json`, '/read-path/days/2025-03-09.json']);
  });

  test('an id its shard doesn\'t list is not ours: null, as an unknown link is today', async () => {
    serveIndex({shard: {'maplify:43': '2025-03-09'}, manifest: manifest('2025-03-09')});
    expect(await findOccurrence('maplify:42')).toBeNull();
  });

  test('a missing shard after a build is an unknown id too', async () => {
    serveIndex({manifest: manifest('2025-03-09')});
    expect(await findOccurrence('maplify:42')).toBeNull();
  });

  test('with nothing built, it throws, so the page says the link couldn\'t be opened', async () => {
    serveIndex({manifest: null});
    await expect(findOccurrence('maplify:42')).rejects.toThrow(/nothing built/);
  });

  test('an id naming an inherited property is not found', async () => {
    serveIndex({shard: {'maplify:43': '2025-03-09'}, manifest: manifest('2025-03-09')});
    expect(await findOccurrence('constructor')).toBeNull();
    expect(await findOccurrence('__proto__')).toBeNull();
  });
});

