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

// jsdom has no WebGL, so MapLibre can't make a map there. A map that draws nothing
// stands in for it: <obs-map> still takes its occurrences and moves, and nothing here
// looks at the drawing.
vi.mock('maplibre-gl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('maplibre-gl')>()),
  Map: class {
    touchZoomRotate = {disableRotation() {}};
    keyboard = {disableRotation() {}};
    #container: HTMLElement;
    constructor({container}: {container: HTMLElement}) { this.#container = container; }
    addControl() {}
    on() {}
    once() {}
    off() {}
    jumpTo() {}
    fitBounds() {}
    easeTo() {}
    getBounds() { return {contains: () => true}; }
    getCenter() { return {lng: -123, lat: 48.5}; }
    getZoom() { return 8; }
    remove() {}
    getContainer() { return this.#container; }
  },
}));

vi.mock('@sentry/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/browser')>()),
  captureException: () => {},
}));

import SalishSea, { dateFromObservedAt } from './salish-sea.ts';
import type { Occurrence } from './types.ts';

test('dateFromObservedAt: UTC midnight in America/Los_Angeles is still the same calendar day', () => {
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


// The sidebar's subject (decision 093, salish-7ds1.1).
test('a subject opened on the page is in the URL, readably, and remembers it was opened here through a map move', async () => {
  window.history.replaceState({}, '', '/?d=2024-07-15');
  const el = await mountWithSightings(occurrenceFixture('aaa', '2024-07-15T18:23:00Z'));
  el.shadowRoot!.querySelector('main')!.dispatchEvent(new CustomEvent('open-subject', {bubbles: true, composed: true,
    detail: {kind: 'individuals', id: '0010082'}}));
  await el.updateComplete;
  expect(window.location.search).toContain('s=individuals/0010082');
  expect(el.shadowRoot!.querySelector('obs-panel')!.hidden).toBe(true);
  expect(el.shadowRoot!.querySelector('subject-view')!.hidden).toBe(false);
  // A map move rewrites the URL in place, as this does; the entry must still say the subject
  // was opened here, so the sidebar's Back steps back rather than taking it out of the URL.
  const {setQueryParams} = await import('./salish-sea.ts');
  setQueryParams({x: '1', y: '2', z: '9'}, {replace: true});
  expect((window.history.state as {subjectOpenedHere?: boolean}).subjectOpenedHere).toBe(true);
  expect(window.location.search).toContain('s=individuals/0010082');
});

test('focusing a sighting, from a dot on the map, closes the subject in the same history entry', async () => {
  window.history.replaceState({}, '', '/?d=2024-07-15');
  const sighting = occurrenceFixture('aaa', '2024-07-15T18:23:00Z');
  const el = await mountWithSightings(sighting);
  // A subject in the URL, as a link or the browser's Back would put it there.
  window.history.pushState({}, '', '/?d=2024-07-15&s=individuals/0010082');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('subject-view')!.hidden).toBe(false);
  el.focusOccurrence(sighting);
  await el.updateComplete;
  const params = new URLSearchParams(window.location.search);
  expect(params.get('o')).toBe('aaa');
  expect(params.get('s')).toBeNull();
  expect(el.shadowRoot!.querySelector('obs-panel')!.hidden).toBe(false);
});

test('cloning from the sidebar closes the subject in place, and the entry no longer claims one was opened here', async () => {
  window.history.replaceState({}, '', '/?d=2024-07-15');
  const sighting = occurrenceFixture('aaa', '2024-07-15T18:23:00Z');
  const el = await mountWithSightings(sighting);
  el.shadowRoot!.querySelector('main')!.dispatchEvent(new CustomEvent('open-subject', {bubbles: true, composed: true,
    detail: {kind: 'individuals', id: '0010082'}}));
  await el.updateComplete;
  expect((window.history.state as {subjectOpenedHere?: boolean}).subjectOpenedHere).toBe(true);
  el.dispatchEvent(new CustomEvent('clone-sighting', {bubbles: true, composed: true, detail: sighting}));
  await el.updateComplete;
  expect(new URLSearchParams(window.location.search).get('s')).toBeNull();
  expect(window.history.state).toEqual({});
  expect(el.shadowRoot!.querySelector('obs-panel')!.hidden).toBe(false);
});

const openSubjectFrom = async (el: SalishSea, origin: Element, subject = {kind: 'individuals', id: '0010082'}) => {
  origin.dispatchEvent(new CustomEvent('open-subject', {bubbles: true, composed: true, detail: subject}));
  await el.updateComplete;
};

test("the sidebar's Back steps back past a deselected sighting to where the subject was opened, once however often it's pressed", async () => {
  window.history.replaceState({}, '', '/?d=2024-07-15');
  const el = await mountWithSightings(occurrenceFixture('aaa', '2024-07-15T18:23:00Z'));
  await openSubjectFrom(el, el.shadowRoot!.querySelector('main')!);
  // Clicking empty water deselects, which pushes an entry with the subject still open.
  el.focusOccurrence(null);
  expect((window.history.state as {stepsBack?: number}).stepsBack).toBe(2);
  const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
  const back = el.shadowRoot!.querySelector('subject-view')!.shadowRoot!.querySelector<HTMLButtonElement>('nav.back button');
  el.shadowRoot!.querySelector('subject-view')!.dispatchEvent(new Event('close-subject', {bubbles: true, composed: true}));
  el.shadowRoot!.querySelector('subject-view')!.dispatchEvent(new Event('close-subject', {bubbles: true, composed: true}));
  expect(go.mock.calls).toEqual([[-2]]);
  expect(back).not.toBeNull();
  go.mockRestore();
  window.dispatchEvent(new PopStateEvent('popstate'));
});

test('"Last reported" moves to the day the sighting is found on, and leaves the subject open when it is gone', async () => {
  window.history.replaceState({}, '', '/?d=2024-07-15');
  const el = await mountWithSightings(occurrenceFixture('aaa', '2024-07-15T18:23:00Z'));
  await openSubjectFrom(el, el.shadowRoot!.querySelector('main')!);
  const view = el.shadowRoot!.querySelector('subject-view')!;

  occurrenceQuery.single = {data: null, error: null};
  view.dispatchEvent(new CustomEvent('go-to-occurrence', {bubbles: true, composed: true, detail: {date: '2024-07-15', occurrenceId: 'gone'}}));
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;
  expect(new URLSearchParams(window.location.search).get('s')).toBe('individuals/0010082');
  expect(await toastText(el)).toMatch(/no longer on the map/);

  // The link says the 16th; the sighting, edited since the build, is on the 15th.
  occurrenceQuery.single = {data: occurrenceFixture('bbb', '2024-07-15T20:00:00Z'), error: null};
  view.dispatchEvent(new CustomEvent('go-to-occurrence', {bubbles: true, composed: true, detail: {date: '2024-07-16', occurrenceId: 'bbb'}}));
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;
  const params = new URLSearchParams(window.location.search);
  expect([params.get('d'), params.get('o'), params.get('s')]).toEqual(['2024-07-15', 'bbb', null]);
  occurrenceQuery.single = {data: null, error: null};
});

test('opening a subject from a link moves focus to its Back button, and closing it returns focus to the link', async () => {
  window.history.replaceState({}, '', '/?d=2024-07-15');
  const el = await mountWithSightings(occurrenceFixture('aaa', '2024-07-15T18:23:00Z'));
  const link = document.createElement('a');
  link.href = '/individuals/0010082/T037';
  link.textContent = 'T37';
  el.shadowRoot!.querySelector('obs-panel')!.append(link);
  link.focus();
  await openSubjectFrom(el, link);
  const view = el.shadowRoot!.querySelector('subject-view')!;
  await view.updateComplete;
  await new Promise(r => setTimeout(r, 0));
  expect(view.shadowRoot!.activeElement).toBe(view.shadowRoot!.querySelector('nav.back button'));
  // Closed from a link's entry: the subject leaves the URL in place, and focus goes home.
  window.history.replaceState({}, '', window.location.href);
  view.dispatchEvent(new Event('close-subject', {bubbles: true, composed: true}));
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement ?? document.activeElement).toBe(link);
});

test('closing the subject by focusing a sighting leaves focus where the page put it, not on the opening link', async () => {
  window.history.replaceState({}, '', '/?d=2024-07-15');
  const sighting = occurrenceFixture('aaa', '2024-07-15T18:23:00Z');
  const el = await mountWithSightings(sighting);
  const link = document.createElement('a');
  link.href = '/individuals/0010082/T037';
  el.shadowRoot!.querySelector('obs-panel')!.append(link);
  await openSubjectFrom(el, link);
  const focus = vi.spyOn(link, 'focus');
  el.focusOccurrence(sighting);
  await el.updateComplete;
  expect(focus).not.toHaveBeenCalled();
});
