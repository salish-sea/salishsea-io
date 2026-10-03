// The card renderer reads the read-path build's files (decisions 056, 061), and Supabase
// only for a sighting saved here since the last build.

import { fetchDayOccurrences, fetchOccurrence, idShard } from './data';

const cfg = { url: 'https://test.supabase.co', key: 'anon' };

const row = (id: string, location: { lon: number; lat: number } | null = { lon: -123, lat: 48.5 }) => ({
  id, location, observed_at: '2025-06-03T14:32:00Z', count: 2, taxon: { vernacular_name: 'Orca' },
});

type Routes = Record<string, unknown>;

/** Answers each URL from `routes`; anything else is a 404. */
function serve(routes: Routes) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input);
    const key = Object.keys(routes).find(k => url.startsWith(k));
    if (key === undefined) return { ok: false, status: 404, json: async () => null } as Response;
    return { ok: true, status: 200, json: async () => routes[key] } as Response;
  });
}

const RP = 'https://salishsea.io/read-path/';
const SUPABASE = 'https://test.supabase.co/rest/v1/occurrences?';

afterEach(() => jest.restoreAllMocks());

// Generated from src/read-path-shard.ts, which the build and the browser share and this
// bundle cannot import: an edit to either copy must change this table too.
it.each([
  ['abc123', '05'], ['maplify:1', '42'], ['inaturalist:375544838', 'c6'],
  ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', '3f'], ['', 'c5'],
])('shards %j into %s, as the build and the browser do', (id, shard) => {
  expect(idShard(id)).toBe(shard);
});

describe('fetchOccurrence', () => {
  it('reads a sighting from the id index and its day file, never Supabase', async () => {
    const fetchSpy = serve({
      [`${RP}ids/${idShard('maplify:1')}.json`]: { 'maplify:1': '2025-06-03' },
      [`${RP}days/2025-06-03.json`]: [row('maplify:2'), row('maplify:1')],
    });
    expect(await fetchOccurrence(cfg, 'maplify:1')).toMatchObject({ id: 'maplify:1', species: 'Orca', count: 2 });
    expect(fetchSpy.mock.calls.map(([u]) => String(u)).some(u => u.startsWith(SUPABASE))).toBe(false);
  });

  it('asks Supabase, for native sightings only, about one no file holds yet', async () => {
    const id = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    const fetchSpy = serve({ [`${RP}ids/`]: {}, [SUPABASE]: [row(id)] });
    expect(await fetchOccurrence(cfg, id)).toMatchObject({ id });
    const asked = fetchSpy.mock.calls.map(([u]) => String(u)).find(u => u.startsWith(SUPABASE));
    expect(asked).toContain('contributor_id=not.is.null');
  });

  it('an upstream id no file holds is unknown, without asking Supabase', async () => {
    const fetchSpy = serve({ [`${RP}ids/`]: {} });
    expect(await fetchOccurrence(cfg, 'maplify:1')).toBeNull();
    expect(fetchSpy.mock.calls.map(([u]) => String(u)).some(u => u.startsWith(SUPABASE))).toBe(false);
  });

  it('an id naming an inherited property is not in the index', async () => {
    serve({ [`${RP}ids/`]: {} });
    expect(await fetchOccurrence(cfg, 'maplify:constructor')).toBeNull();
  });

  it('a failing read path throws, so the card is a 500 rather than a wrong miss', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503, json: async () => null } as Response);
    await expect(fetchOccurrence(cfg, 'maplify:1')).rejects.toThrow(/HTTP 503/);
  });
});

describe('fetchDayOccurrences', () => {
  it('the day\'s located sightings, from its file', async () => {
    serve({ [`${RP}days/2025-06-03.json`]: [row('a'), row('b', null), row('c')] });
    expect((await fetchDayOccurrences('2025-06-03')).map(o => o.id)).toEqual(['a', 'c']);
  });

  it('a day with no file has no sightings', async () => {
    serve({});
    expect(await fetchDayOccurrences('2025-06-03')).toEqual([]);
  });
});
