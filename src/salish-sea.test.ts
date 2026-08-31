// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Every test here instantiates <salish-sea>, whose constructor subscribes to
// auth and to the realtime channel and whose first render fetches a day of
// sightings. Stub the client so none of that reaches the network, and so a
// query failure is something a test can ask for.
const occurrenceQuery = vi.hoisted(() => ({
  rows: [] as unknown[] | null,
  error: null as unknown,
  /** Set to hold a response open, so a test can decide when it lands. */
  gate: null as Promise<void> | null,
  /** What a `?o=` permalink lookup finds. */
  single: {data: null as unknown, error: null as unknown},
}));
vi.mock('@sentry/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/browser')>()),
  captureException: () => {},
}));
vi.mock('./supabase.ts', () => {
  const query: Record<string, unknown> = {};
  for (const chained of ['select', 'gte', 'lt', 'lte', 'eq', 'order'])
    query[chained] = () => query;
  query.throwOnError = () => {
    // Captured when the request is issued, not when it lands: a test that holds
    // a response open is modelling a server whose answer is already decided.
    const {rows, error, gate} = occurrenceQuery;
    return (async () => {
      if (gate) await gate;
      if (error) throw error;
      return {data: rows};
    })();
  };
  query.maybeSingle = async () => occurrenceQuery.single;
  const channel: Record<string, unknown> = {};
  channel.on = () => channel;
  channel.subscribe = () => channel;
  channel.unsubscribe = () => {};
  return {
    supabase: () => ({
      auth: {
        onAuthStateChange: () => ({data: {subscription: {unsubscribe() {}}}}),
        signOut: async () => ({error: null}),
      },
      from: () => query,
      channel: () => channel,
      rpc: async () => ({data: null, error: null}),
    }),
  };
});

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
});

afterEach(() => {
  // Remove any <salish-sea> elements added by tests
  document.body.querySelectorAll('salish-sea').forEach(el => el.remove());
});

test('header info control is a plain anchor to /about.html with no dialog', async () => {
  const el = document.createElement('salish-sea') as InstanceType<typeof import('./salish-sea.ts').default>;
  document.body.appendChild(el);
  await el.updateComplete;

  const aboutLink = el.shadowRoot!.querySelector('a.about-link') as HTMLAnchorElement | null;
  expect(aboutLink).not.toBeNull();
  expect(aboutLink!.getAttribute('href')).toBe('/about.html');
  // Icon-only control needs an explicit accessible name for screen readers / voice control
  expect(aboutLink!.getAttribute('aria-label')).toBe('About SalishSea.io');

  const dialog = el.shadowRoot!.querySelector('dialog');
  expect(dialog).toBeNull();
});

/** Enough of an Occurrence for the panel to render a row for it. */
function occurrenceFixture(id: string, observedAt: string): Occurrence {
  return {
    attribution: 'Test',
    body: 'Two orcas heading north',
    collection: null,
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

test('a deleted sighting leaves the list on the delete, not on the broadcast', async () => {
  const el = await mountWithSightings(
    occurrenceFixture('aaa', '2024-07-15T18:23:00Z'),
    occurrenceFixture('bbb', '2024-07-15T19:23:00Z'),
  );
  expect(summaryIds(el)).toEqual(['summary-aaa', 'summary-bbb']);

  el.dispatchEvent(new CustomEvent('sighting-deleted', {detail: 'aaa'}));
  await el.updateComplete;

  // No realtime broadcast was delivered. Before this, a missed broadcast left
  // the deleted sighting on screen indefinitely.
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
    // A response the query layer is happy with and the code that reads it is
    // not. It fails *after* fetchOccurrences' own try/catch, which is the
    // failure that used to reject into nothing — the query errors it does catch
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
  const failure = {code: '57014', message: 'canceling statement due to statement timeout'};
  occurrenceQuery.single = {data: null, error: failure};
  const el = document.createElement('salish-sea') as SalishSea;
  document.body.appendChild(el);
  await el.updateComplete;

  // Supabase hands a failed lookup back as a null `data` alongside an error —
  // the same null a `?o=` for a sighting we don't have produces. Reaching
  // firstUpdated's toast depends on the two being told apart here.
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
