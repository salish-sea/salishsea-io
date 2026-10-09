// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Every test here instantiates <salish-sea>, whose constructor asks the write API who is
// signed in and whose first render fetches a day of sightings and watches the manifest.
// Stub the file readers and the API so none of that reaches the network, and so a
// failure is something a test can ask for. A test that serves the files itself, through
// a fetch stub, sets `files` and gets the real readers.
const occurrenceQuery = vi.hoisted(() => ({
  rows: [] as unknown[] | null,
  error: null as unknown,
  /** Set to hold a response open, so a test can decide when it lands. */
  gate: null as Promise<void> | null,
  /** What a `?o=` permalink lookup finds in the files. */
  single: {data: null as unknown, error: null as unknown},
  /** Read the files for real, from whatever the test's fetch stub serves. */
  files: false,
}));
const api = vi.hoisted(() => ({
  /** Who GET /api/me (and a sign-in) says is signed in. */
  me: null as unknown,
  /** The signed-in contributor's own sightings, as GET /api/sightings answers. */
  own: [] as unknown[],
}));
vi.mock('./read-path.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./read-path.ts')>();
  return {
    ...actual,
    fetchDayOccurrences: ((...args: Parameters<typeof actual.fetchDayOccurrences>) => {
      if (occurrenceQuery.files) return actual.fetchDayOccurrences(...args);
      // Captured when the request is issued, not when it lands: a test that holds a
      // response open is modelling a server whose answer is already decided.
      const {rows, error, gate} = occurrenceQuery;
      return (async () => {
        if (gate) await gate;
        if (error) throw error;
        return rows;
      })();
    }) as typeof actual.fetchDayOccurrences,
    findOccurrence: (async (id: string) => {
      if (occurrenceQuery.files) return actual.findOccurrence(id);
      if (occurrenceQuery.single.error) throw occurrenceQuery.single.error;
      return occurrenceQuery.single.data;
    }) as typeof actual.findOccurrence,
    fetchCalendarCounts: ((...args: Parameters<typeof actual.fetchCalendarCounts>) =>
      occurrenceQuery.files ? actual.fetchCalendarCounts(...args) : Promise.resolve(new Map())) as typeof actual.fetchCalendarCounts,
    watchManifest: ((...args: Parameters<typeof actual.watchManifest>) =>
      occurrenceQuery.files ? actual.watchManifest(...args) : () => {}) as typeof actual.watchManifest,
    // The published names, which the sighting form's menu asks for on mount (salish-53t.3)
    // and a contributor's own sightings are named from. Only the fixtures' animal.
    fetchStaticAnimalNames: async () => new Map([['SSA:0000002',
      {common_name: null, taxon_common_name: 'Killer whale', inaturalist_scientific_name: 'Orcinus orca'}]]),
  };
});
vi.mock('./write-api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./write-api.ts')>();
  return {
    ...actual,
    fetchMe: async () => api.me,
    signIn: async () => api.me,
    signOut: async () => {},
    fetchOwnSightings: async () => api.own,
    fetchPublicSighting: ((id: string) =>
      occurrenceQuery.files ? actual.fetchPublicSighting(id) : Promise.resolve(null)) as typeof actual.fetchPublicSighting,
  };
});

vi.mock('@sentry/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/browser')>()),
  captureException: () => {},
}));

import SalishSea, { dateFromObservedAt } from './salish-sea.ts';
import type { Occurrence } from './types.ts';

test('dateFromObservedAt: UTC midnight in PST8PDT is still the same calendar day', () => {
  // 2024-07-15T18:23:00Z is 11:23 PDT — still July 15 in Pacific time
  expect(dateFromObservedAt('2024-07-15T18:23:00Z')).toBe('2024-07-15');
});

test('dateFromObservedAt: 06:00 UTC = 22:00 PST, still the previous calendar day', () => {
  // 2024-07-16T06:00:00Z is 22:00 PDT on July 15 — still July 15 in Pacific time
  expect(dateFromObservedAt('2024-07-16T06:00:00Z')).toBe('2024-07-15');
});

test('dateFromObservedAt: 08:01 UTC = 00:01 PDT, just past midnight Pacific', () => {
  // 2024-07-16T08:01:00Z is 00:01 PDT on July 16 — July 16 in Pacific time
  expect(dateFromObservedAt('2024-07-16T08:01:00Z')).toBe('2024-07-16');
});

// jsdom lacks ResizeObserver (used by OpenLayers in obs-map) — stub it globally so
// instantiating <salish-sea> doesn't throw before tests can run.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

beforeEach(() => {
  occurrenceQuery.rows = [];
  occurrenceQuery.error = null;
  occurrenceQuery.gate = null;
  occurrenceQuery.single = {data: null, error: null};
  occurrenceQuery.files = false;
  api.me = null;
  api.own = [];
});

afterEach(() => {
  // Remove any <salish-sea> elements added by tests
  document.body.querySelectorAll('salish-sea').forEach(el => el.remove());
});

test('the header carries the site nav, the map marked as the page you are on, and no dialog', async () => {
  const el = document.createElement('salish-sea') as InstanceType<typeof import('./salish-sea.ts').default>;
  document.body.appendChild(el);
  await el.updateComplete;

  const links = [...el.shadowRoot!.querySelectorAll('header nav.site-nav a')] as HTMLAnchorElement[];
  expect(links.map(a => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])).toEqual([
    ['About', '/about.html', 'false'],
    ['Map', '/', 'page'],
    ['Whales', '/whales', 'false'],
  ]);

  const dialog = el.shadowRoot!.querySelector('dialog');
  expect(dialog).toBeNull();
});

/** Enough of an Occurrence for the panel to render a row for it. */
function occurrenceFixture(id: string, observedAt: string, contributorId: number | null = null): Occurrence {
  return {
    attribution: 'Test',
    body: 'Two orcas heading north',
    collection: null,
    contributor_id: contributorId,
    count: 2,
    id,
    location: {lat: 48.5, lon: -123.0},
    observed_at: observedAt,
    observed_at_ms: Date.parse(observedAt),
    observer: null,
    organization_url: null,
    photos: [],
    provider: 'Test',
    provider_slug: 'test',
    source_url: null,
    taxon: {scientific_name: 'Orcinus orca'},
    url: null,
  } as unknown as Occurrence;
}

async function mountWithSightings(...occurrences: Occurrence[]) {
  const el = document.createElement('salish-sea') as SalishSea;
  document.body.appendChild(el);
  await el.updateComplete;
  el.receiveOccurrences(occurrences, el.date, el.region.slug);
  await el.updateComplete;
  return el;
}

const summaryIds = (el: SalishSea) =>
  [...el.shadowRoot!.querySelectorAll('obs-summary')].map(node => node.id);

/** The rendered toast text, or null when nothing is on screen. */
async function toastText(el: SalishSea): Promise<string | null> {
  const toast = el.shadowRoot!.querySelector('error-toast')!;
  await toast.updateComplete;
  return toast.shadowRoot!.querySelector('.toast p')?.textContent ?? null;
}

test('a deleted sighting leaves the list on the delete, not on the next build', async () => {
  const el = await mountWithSightings(
    occurrenceFixture('aaa', '2024-07-15T18:23:00Z'),
    occurrenceFixture('bbb', '2024-07-15T19:23:00Z'),
  );
  expect(summaryIds(el)).toEqual(['summary-aaa', 'summary-bbb']);

  el.dispatchEvent(new CustomEvent('sighting-deleted', {detail: 'aaa'}));
  await el.updateComplete;

  // No build has landed. Before this, a missed refresh left the deleted sighting
  // on screen indefinitely.
  expect(summaryIds(el)).toEqual(['summary-bbb']);
});

test('deleting the focused sighting clears the focus it leaves behind', async () => {
  const el = await mountWithSightings(occurrenceFixture('aaa', '2024-07-15T18:23:00Z'));
  const focusedId = () => (el as unknown as {focusedOccurrenceId: string | null}).focusedOccurrenceId;
  el.focusOccurrence(occurrenceFixture('aaa', '2024-07-15T18:23:00Z'));
  expect(focusedId()).toBe('aaa');

  el.dispatchEvent(new CustomEvent('sighting-deleted', {detail: 'aaa'}));
  await el.updateComplete;

  expect(focusedId()).toBeNull();
});

test('a failed sighting load says so, and says it may be incomplete', async () => {
  occurrenceQuery.error = new Error('FetchError: network request failed');
  const el = document.createElement('salish-sea') as SalishSea;
  document.body.appendChild(el);
  await el.updateComplete;
  await el.fetchOccurrences(el.date);
  await el.updateComplete;

  // An empty list is indistinguishable from a quiet day on the water, so
  // silence here is the map misrepresenting the data.
  expect(await toastText(el)).toBe("Couldn't load sightings. The list may be incomplete.");
});

test('a fire-and-forget refetch that fails outright surfaces instead of rejecting into nothing', async () => {
  const el = document.createElement('salish-sea') as SalishSea;
  document.body.appendChild(el);
  await el.updateComplete;

  const unhandled: unknown[] = [];
  const onUnhandled = (e: PromiseRejectionEvent) => { unhandled.push(e.reason); e.preventDefault(); };
  window.addEventListener('unhandledrejection', onUnhandled as EventListener);
  try {
    // A response the reader is happy with and the code that reads it is
    // not. It fails *after* fetchOccurrences' own try/catch, which is the
    // failure that used to reject into nothing — the read errors it does catch
    // report themselves.
    occurrenceQuery.rows = null;
    el.date = '2024-07-16';
    await new Promise(resolve => setTimeout(resolve, 0));
    await el.updateComplete;
  } finally {
    window.removeEventListener('unhandledrejection', onUnhandled as EventListener);
  }

  expect(await toastText(el)).toBe("Couldn't refresh sightings. The list may be out of date.");
  expect(unhandled).toEqual([]);
});

test('a response already in flight when a sighting is deleted does not put the row back', async () => {
  const aaa = occurrenceFixture('aaa', '2024-07-15T18:23:00Z');
  const bbb = occurrenceFixture('bbb', '2024-07-15T19:23:00Z');
  // Two responses held open independently, so the test can land them in the
  // order that exposes the race: the one issued *before* the delete arrives
  // last, and would have the final word.
  let landStale!: () => void;
  let landFresh!: () => void;
  occurrenceQuery.rows = [aaa, bbb];
  occurrenceQuery.gate = new Promise<void>(resolve => { landStale = resolve; });

  const el = await mountWithSightings(aaa, bbb);
  const stale = el.fetchOccurrences(el.date);

  // The delete commits. Its own refetch sees the shorter list; the outstanding
  // request above still answers with both, and it asked for the same day and
  // the same region, so neither existing staleness guard knows it is out of
  // date — only that it predates the delete.
  occurrenceQuery.rows = [bbb];
  occurrenceQuery.gate = new Promise<void>(resolve => { landFresh = resolve; });
  el.dispatchEvent(new CustomEvent('sighting-deleted', {detail: 'aaa'}));
  await el.updateComplete;
  expect(summaryIds(el)).toEqual(['summary-bbb']);

  landFresh();
  await new Promise(resolve => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(summaryIds(el)).toEqual(['summary-bbb']);

  landStale();
  await stale;
  await el.updateComplete;

  expect(summaryIds(el)).toEqual(['summary-bbb']);
});

test('a permalink lookup that fails is not reported as a sighting that does not exist', async () => {
  const failure = new Error('/read-path/ids/ab.json: HTTP 503');
  occurrenceQuery.single = {data: null, error: failure};
  const el = document.createElement('salish-sea') as SalishSea;
  document.body.appendChild(el);
  await el.updateComplete;

  // A failed lookup and a `?o=` for a sighting we don't have both leave nothing to
  // show. Reaching firstUpdated's toast depends on the two being told apart: the
  // files' reader throws for one and resolves null for the other.
  await expect(
    (el as unknown as {hydrateFromOccurrenceId(id: string): Promise<void>}).hydrateFromOccurrenceId('abc'),
  ).rejects.toBe(failure);
});

test('a permalink for a sighting we do not have stays quiet, as it always has', async () => {
  occurrenceQuery.single = {data: null, error: null};
  const el = document.createElement('salish-sea') as SalishSea;
  document.body.appendChild(el);
  await el.updateComplete;

  await (el as unknown as {hydrateFromOccurrenceId(id: string): Promise<void>}).hydrateFromOccurrenceId('abc');

  expect(await toastText(el)).toBeNull();
});

/** A contributor's own sighting as GET /api/sightings answers (decision 065). */
const ownSighting = (id: string, observedAt: string) => ({
  id, observed_at: observedAt, location: {lon: -123.0, lat: 48.5}, observed_from: null, body: 'Two orcas heading north',
  count: 2, direction: null, url: null, entity_id: 'SSA:0000002', photos: [], contributor_id: 7, updated_at: observedAt,
});
const CONTRIBUTOR = {id: 7, name: 'Contributor', picture: null, editor: false, orcid: null};

// Decisions 056 and 065: the day comes from the read-path file. A signed-in
// contributor's tab overlays their own sightings from the write API, because the
// files trail the store and a contributor must see a sighting they just saved
// (decision 055).
test('a signed-out visitor reads the day file and a signed-in contributor sees their own sightings as saved', async () => {
  occurrenceQuery.files = true;
  const fromFile = (date: string) => new Response(JSON.stringify([
    occurrenceFixture('from-file', `${date}T20:00:00Z`),
    // Saved here, then deleted or moved to another day since the build.
    occurrenceFixture('stale-native', `${date}T19:00:00Z`, 7),
  ]), {status: 200});
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) =>
    String(url).endsWith('manifest.json') ? new Response(null, {status: 404}) : fromFile(el.date));
  const el = document.createElement('salish-sea') as SalishSea;
  try {
    document.body.appendChild(el);
    await el.updateComplete;
    api.own = [ownSighting('live-native', `${el.date}T21:00:00Z`)];

    await el.fetchOccurrences(el.date);
    await el.updateComplete;
    expect(fetchSpy).toHaveBeenCalledWith(`/read-path/days/${el.date}.json`);
    expect(summaryIds(el)).toEqual(['summary-from-file', 'summary-stale-native']);

    fetchSpy.mockClear();
    Object.assign(el as unknown as {user: unknown, contributor: unknown}, {user: {id: 'contributor'}, contributor: CONTRIBUTOR});
    await el.fetchOccurrences(el.date);
    await el.updateComplete;
    expect(fetchSpy).toHaveBeenCalledWith(`/read-path/days/${el.date}.json`);
    // The file's upstream sighting and their own as saved, newest first; the file's
    // copy of their sighting goes, since it may have been deleted or moved since.
    expect(summaryIds(el)).toEqual(['summary-live-native', 'summary-from-file']);
  } finally {
    fetchSpy.mockRestore();
  }
});

test('a day file still in flight when someone signs in does not overwrite their overlaid list', async () => {
  occurrenceQuery.files = true;
  let release!: (r: Response) => void;
  const held = new Promise<Response>(resolve => release = resolve);
  let dayRequests = 0;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: RequestInfo | URL) => {
    if (String(url).endsWith('manifest.json')) return Promise.resolve(new Response(null, {status: 404}));
    if (!String(url).includes('/read-path/days/')) return Promise.resolve(new Response(null, {status: 404}));
    // The first day request (signed out) is held open; later ones answer at once.
    return dayRequests++ === 0 ? held : Promise.resolve(new Response(JSON.stringify([])));
  });
  const el = document.createElement('salish-sea') as SalishSea;
  try {
    document.body.appendChild(el);
    await el.updateComplete;
    api.own = [ownSighting('live-native', `${el.date}T20:00:00Z`)];
    const signedOut = el.fetchOccurrences(el.date);   // the file request, held open

    api.me = {user_id: 'contributor', contributor: CONTRIBUTOR};
    await el.receiveIdToken('token', 'nonce');
    await vi.waitFor(() => expect(summaryIds(el)).toEqual(['summary-live-native']));

    release(new Response(JSON.stringify([occurrenceFixture('from-file', `${el.date}T20:00:00Z`)]), {status: 200}));
    await signedOut;
    await el.updateComplete;
    expect(summaryIds(el)).toEqual(['summary-live-native']);
  } finally {
    fetchSpy.mockRestore();
  }
});

test('a permalink to a sighting saved since the last build opens it from the API (salish-9uu.5)', async () => {
  occurrenceQuery.files = true;
  const fresh = '01977c2a-b313-77a9-8433-ffccbd56bf57';
  const asked: string[] = [];
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
    const u = String(url);
    asked.push(u);
    // no file holds it yet; the API, which holds what was saved, does
    if (u.includes('/read-path/ids/')) return new Response(JSON.stringify({'maplify:1': '2025-03-09'}));
    if (u.endsWith('/read-path/manifest.json')) return new Response(JSON.stringify({version: 1, covered_through: '2025-03-10'}));
    if (u === `/api/sightings/${fresh}`)
      return new Response(JSON.stringify({occurrence: occurrenceFixture(fresh, '2025-03-10T20:00:00Z', 7)}), {status: 200});
    if (u.includes('/api/sightings/')) return new Response(JSON.stringify({error: 'no such sighting'}), {status: 404});
    if (u.endsWith('/read-path/days/2025-03-10.json')) return new Response(JSON.stringify([]));
    return new Response(null, {status: 404});
  });
  const el = document.createElement('salish-sea') as SalishSea;
  const hydrate = (id: string) =>
    (el as unknown as {hydrateFromOccurrenceId(id: string): Promise<void>}).hydrateFromOccurrenceId(id);
  try {
    document.body.appendChild(el);
    await el.updateComplete;
    const today = el.date;
    Element.prototype.scrollIntoView = () => {};
    await hydrate(fresh).catch(() => {});   // jsdom has no map to centre
    expect(el.date).toBe('2025-03-10');
    expect(asked).toContain(`/api/sightings/${fresh}`);

    // an upstream id no file holds is not asked of the API: it comes with the build or not at all
    asked.length = 0;
    await hydrate('maplify:9');
    expect(asked.some(u => u.includes('/api/sightings/'))).toBe(false);
    // nor is a native id the API has not got an error: the quiet fallback, as ever
    await hydrate('01977c2a-b313-77a9-8433-000000000000');
    expect(el.date).toBe('2025-03-10');
    void today;
  } finally {
    el.remove();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    fetchSpy.mockRestore();
  }
});

test('a new build makes a signed-in tab refetch its day too', async () => {
  occurrenceQuery.files = true;
  vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
  let takenAt = '2025-03-09T20:00:00.000Z';
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) =>
    String(url).endsWith('manifest.json')
      ? new Response(JSON.stringify({version: 1, snapshot_taken_at: takenAt, covered_through: '2099-01-01'}))
      : new Response(JSON.stringify([occurrenceFixture('from-file', '2025-03-09T20:00:00Z')])));
  const el = document.createElement('salish-sea') as SalishSea;
  const dayFetches = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes('/read-path/days/')).length;
  try {
    document.body.appendChild(el);
    await el.updateComplete;
    (el as unknown as {user: unknown}).user = {id: 'contributor'};
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/read-path/manifest.json'));
    const before = dayFetches();

    takenAt = '2025-03-09T21:00:00.000Z';
    await vi.advanceTimersByTimeAsync(60_000);
    // Upstream sightings reach a contributor only through the files now.
    await vi.waitFor(() => expect(dayFetches()).toBe(before + 1));
  } finally {
    el.remove();
    vi.useRealTimers();
    fetchSpy.mockRestore();
  }
});

test('a new build makes a signed-out tab refetch its day', async () => {
  occurrenceQuery.files = true;
  vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
  let takenAt = '2025-03-09T20:00:00.000Z';
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) =>
    String(url).endsWith('manifest.json')
      ? new Response(JSON.stringify({version: 1, snapshot_taken_at: takenAt, covered_through: '2099-01-01'}))
      : new Response(JSON.stringify([occurrenceFixture('from-file', '2025-03-09T20:00:00Z')])));
  const el = document.createElement('salish-sea') as SalishSea;
  const dayFetches = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes('/read-path/days/')).length;
  const calendarFetches = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes('/read-path/calendar/')).length;
  try {
    document.body.appendChild(el);
    await el.updateComplete;
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/read-path/manifest.json'));
    await vi.waitFor(() => expect(calendarFetches()).toBeGreaterThan(0));
    const before = dayFetches();
    const calendarBefore = calendarFetches();

    await vi.advanceTimersByTimeAsync(60_000);   // same snapshot: nothing to do
    expect(dayFetches()).toBe(before);

    expect(calendarFetches()).toBe(calendarBefore);

    takenAt = '2025-03-09T21:00:00.000Z';
    await vi.advanceTimersByTimeAsync(60_000);   // a new build landed
    await vi.waitFor(() => expect(dayFetches()).toBe(before + 1));
    // The calendar's months are fetched again too, so its circles follow the build.
    await vi.waitFor(() => expect(calendarFetches()).toBeGreaterThan(calendarBefore));
  } finally {
    el.remove();
    vi.useRealTimers();
    fetchSpy.mockRestore();
  }
});

