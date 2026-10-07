import { handler, idShard, WARMUP_WAIT_MS } from './index';

// The handler emits structured JSON log lines (og-fetch, og-fail-open, …);
// keep test output clean while leaving the spies available for assertions.
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// Helper to build a CloudFront viewer-request event
function makeEvent(userAgent: string, querystring: string = '', uri: string = '/') {
  return {
    Records: [
      {
        cf: {
          request: {
            headers: {
              'user-agent': [{ value: userAgent }],
            },
            querystring,
            uri,
          },
        },
      },
    ],
  };
}

/**
 * The read-path build's files as the edge reads a sighting from them (decisions 056,
 * 061): the id index names each occurrence's day, and that day's file holds it.
 * Supabase, asked only for a sighting saved here since the last build, has none.
 */
function servePublished(...occurrences: { id: string; [field: string]: unknown }[]) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as Response);
    if (url.startsWith('https://salishsea.io/read-path/ids/'))
      return json(Object.fromEntries(occurrences.map(o => [o.id, '2025-06-03'])));
    if (url === 'https://salishsea.io/read-path/days/2025-06-03.json') return json(occurrences);
    // Nothing saved here since the last build.
    if (url.includes('/api/sightings/')) return { ok: false, status: 404, json: async () => ({ error: 'no such sighting' }) } as Response;
    throw new Error(`unexpected fetch ${url}`);
  });
}

// Sample occurrence data matching the locked format decisions
const sampleOccurrence = {
  id: 'abc123',
  taxon: { vernacular_name: 'Orca' },
  observed_at: '2025-06-03T14:32:00Z',
  count: 3,
  photos: [{ src: 'https://example.com/orca.jpg', license: 'cc0' }],
  location: { lon: -123.0882, lat: 48.6132 },
};

describe('Lambda@Edge OG meta handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  it('passes through non-bot user-agents (Mozilla/5.0) unmodified', async () => {
    const event = makeEvent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    const result = await handler(event);
    // Should return the request object unchanged (pass-through)
    expect(result).toBe(event.Records[0].cf.request);
  });

  it('returns OG HTML response for known bot user-agent facebookexternalhit/1.1', async () => {
    servePublished();
    const event = makeEvent('facebookexternalhit/1.1');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('<html>');
    expect(result.body).toContain('og:title');
  });

  it('returns generic preview with og:title "SalishSea.io" when no ?o= param present', async () => {
    servePublished();
    const event = makeEvent('facebookexternalhit/1.1', '');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('SalishSea.io');
    // Generic homepage preview carries a description, a real <title>, and the
    // brand card — there is no image of a *thing shared* on the bare homepage,
    // so the identity-shaped card stands in (decision 026, superseding 019).
    expect(result.body).toContain('og:description');
    expect(result.body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
    expect(result.body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(result.body).toContain('<title>');
    // ...and a real <meta name="description"> for search snippets, not just og:*
    expect(result.body).toContain('<meta name="description"');
    // fb:app_id enables Facebook Domain Insights and clears the debugger warning
    expect(result.body).toContain('<meta property="fb:app_id" content="678644427974059">');
  });

  it('returns occurrence-specific OG tags with correct title, description, and image for cc0 photo', async () => {
    servePublished(sampleOccurrence);
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    // Title: "Orca · June 3, 2025"
    expect(result.body).toContain('Orca · June 3, 2025');
    // Description contains "3 Orca", in both og:description and the real meta description
    expect(result.body).toContain('3 Orca');
    expect(result.body).toContain('<meta name="description" content="3 Orca');
    // Image is the photo src — an actual picture of the thing shared, so the card
    // may promise a large image
    expect(result.body).toContain('https://example.com/orca.jpg');
    expect(result.body).toContain('<meta name="twitter:card" content="summary_large_image">');
    // fb:app_id present on occurrence cards too
    expect(result.body).toContain('<meta property="fb:app_id" content="678644427974059">');
  });

  // The sample above is 14:32 UTC — the same calendar day in either zone, so it
  // cannot catch a missing timeZone. This one is an evening Pacific sighting that
  // has already rolled over in UTC, which is how the bug reached production: the
  // preview for a 6:38 PM sighting on Aug 29 read "August 30 · 1:38 AM".
  it('renders date and time in Pacific for an evening sighting that is next-day in UTC', async () => {
    servePublished({ ...sampleOccurrence, observed_at: '2026-08-30T01:38:00Z', count: 5 });
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.body).toContain('Orca · August 29, 2026');
    expect(result.body).toContain('6:38 PM');
    expect(result.body).not.toContain('August 30, 2026');
    expect(result.body).not.toContain('1:38 AM');
  });

  // Postgres can hand back a bare timestamp with no zone designator; it is UTC.
  it('reads a zone-less observed_at as UTC, then renders it in Pacific', async () => {
    servePublished({ ...sampleOccurrence, observed_at: '2026-08-30 01:38:00' });
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.body).toContain('Orca · August 29, 2026');
    expect(result.body).toContain('6:38 PM');
  });

  // An explicit negative offset must be left alone, not have 'Z' appended onto it.
  it('preserves an explicit negative UTC offset on observed_at', async () => {
    servePublished({ ...sampleOccurrence, observed_at: '2026-08-29T18:38:00-07:00' });
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.body).toContain('Orca · August 29, 2026');
    expect(result.body).toContain('6:38 PM');
  });

  // Zulip's fetcher identifies itself as "ZulipURLPreview"; a link pasted into the
  // Orcasound Zulip got the generic card until it was on the list (2026-09-25).
  it('serves the occurrence card to Zulip', async () => {
    servePublished(sampleOccurrence);
    const event = makeEvent('Mozilla/5.0 (compatible; ZulipURLPreview/11.2; +https://orcasound.zulipchat.com)', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.body).toContain('Orca · June 3, 2025');
  });

  // An Orcasound bout (decision 053): heard over a span at a hydrophone, no count,
  // and the whales named in its identifiers rather than counted.
  it('describes an acoustic occurrence as heard, over its span, at its hydrophone', async () => {
    const bout = {
      id: 'orcasound:bout_031YvAeJ4O13YgkbQlc8yJ:SSA:0000900',
      taxon: { vernacular_name: 'Killer whale' },
      observed_at: '2025-11-10T04:00:50.373+00:00',
      observed_until: '2025-11-10T04:30:32.358+00:00',
      count: null,
      photos: [],
      location: { lon: -122.760614, lat: 48.135743 },
      provider_slug: 'orcasound',
      identifiers: ['J pod', 'K pod', 'Southern Resident'],
      attribution: 'Orcasound moderators at Port Townsend',
    };
    servePublished(bout);
    const event = makeEvent('Slackbot-LinkExpanding 1.0', `o=${encodeURIComponent(bout.id)}`);
    const result = await handler(event) as { status: string; body: string };
    expect(result.body).toContain('Killer whale heard · November 9, 2025');
    expect(result.body).toContain('J pod, K pod, Southern Resident · 8:00 PM–8:30 PM · Port Townsend hydrophone');
    expect(result.body).not.toContain('1 Killer whales');
    expect(result.body).toContain(`https://salishsea.io/cards/o/${encodeURIComponent(bout.id)}.jpg`);
  });

  it('falls back to the map card when the photo is cc-by-nc', async () => {
    const occurrence = {
      ...sampleOccurrence,
      photos: [{ src: 'https://example.com/restricted.jpg', license: 'cc-by-nc' }],
    };
    servePublished(occurrence);
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).not.toContain('https://example.com/restricted.jpg');
    expect(result.body).toContain('https://salishsea.io/cards/o/abc123.jpg');
    expect(result.body).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('falls back to the map card when the photos array is empty', async () => {
    const occurrence = { ...sampleOccurrence, photos: [] };
    servePublished(occurrence);
    const event = makeEvent('twitterbot/1.0', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('https://salishsea.io/cards/o/abc123.jpg');
    expect(result.body).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('falls back to the map card when every photo is non-open', async () => {
    const occurrence = {
      ...sampleOccurrence,
      photos: [
        { src: 'https://example.com/photo1.jpg', license: 'cc-by-nd' },
        { src: 'https://example.com/photo2.jpg', license: 'none' },
        { src: 'https://example.com/photo3.jpg', license: null },
      ],
    };
    servePublished(occurrence);
    const event = makeEvent('discordbot/1.0', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).not.toContain('https://example.com/photo1.jpg');
    expect(result.body).toContain('https://salishsea.io/cards/o/abc123.jpg');
    expect(result.body).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('returns generic preview with og:title "SalishSea.io" when occurrence is not found', async () => {
    servePublished();
    const event = makeEvent('facebookexternalhit/1.1', 'o=nonexistent-id');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('SalishSea.io');
    // Falls back to the generic homepage preview, which now includes a description
    expect(result.body).toContain('og:description');
    expect(result.body).toContain('<meta name="description"');
  });

  // decision 061: the sightings are the build's files; Supabase holds only what people
  // save here, and is asked only for one saved since the last build.
  it('reads a sighting from the id index and its day file, never Supabase', async () => {
    const fetchSpy = servePublished(sampleOccurrence);
    const result = await handler(makeEvent('facebookexternalhit/1.1', 'o=abc123')) as { body: string };
    expect(result.body).toContain('Orca · June 3, 2025');
    expect(fetchSpy.mock.calls.map(([u]) => String(u))).toEqual([
      `https://salishsea.io/read-path/ids/${idShard('abc123')}.json`,
      'https://salishsea.io/read-path/days/2025-06-03.json',
    ]);
  });

  // Generated from src/read-path-shard.ts, which the build and the browser share and
  // this bundle cannot import: an edit to either copy must change this table too.
  it.each([
      ["abc123", "05"],
      ["maplify:1", "42"],
      ["maplify:2", "af"],
      ["inaturalist:375544838", "c6"],
      ["happywhale:42", "62"],
      ["orcasound:bout_031YvAeJ4O13YgkbQlc8yJ:SSA:0000900", "f8"],
      ["0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", "3f"],
      ["\u00e9", "44"],
      ["", "c5"],
  ])('shards %j into %s, as the build and the browser do', (id, shard) => {
    expect(idShard(id)).toBe(shard);
  });

  it('asks the write API, for native sightings only, about one no file holds yet', async () => {
    const fresh = { ...sampleOccurrence, id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' };
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as Response);
      if (url.includes('/read-path/ids/')) return json({});
      if (url === `https://salishsea.io/api/sightings/${fresh.id}`) return json({ occurrence: fresh });
      throw new Error(`unexpected fetch ${url}`);
    });
    const result = await handler(makeEvent('facebookexternalhit/1.1', `o=${fresh.id}`)) as { body: string };
    expect(result.body).toContain('Orca · June 3, 2025');
    expect(fetchSpy.mock.calls.map(([u]) => String(u))).toContain(`https://salishsea.io/api/sightings/${fresh.id}`);
  });

  it('a native id the API has not got either falls back to the map page', async () => {
    const id = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/read-path/ids/')) return { ok: true, status: 200, json: async () => ({}) } as Response;
      if (url.includes('/api/sightings/')) return { ok: false, status: 404, json: async () => ({ error: 'no such sighting' }) } as Response;
      throw new Error(`unexpected fetch ${url}`);
    });
    const result = await handler(makeEvent('facebookexternalhit/1.1', `o=${id}`)) as { body: string };
    // the site's own tags, not a sighting's
    expect(result.body).toContain('og:title" content="Salish Sea');
    expect(result.body).not.toContain('June 3, 2025');
  });

  it('never asks the API about an upstream id the files don\'t hold', async () => {
    const fetchSpy = servePublished();
    const result = await handler(makeEvent('facebookexternalhit/1.1', 'o=maplify:1')) as { body: string };
    expect(result.body).toContain('og:title');
    expect(fetchSpy.mock.calls.map(([u]) => String(u)).some(u => u.includes('/api/'))).toBe(false);
  });

  it('an id naming an inherited property is not found in the index', async () => {
    const fetchSpy = servePublished();
    await handler(makeEvent('facebookexternalhit/1.1', 'o=maplify:constructor'));
    expect(fetchSpy.mock.calls.map(([u]) => String(u)).some(u => u.includes('/days/'))).toBe(false);
  });

  it('returns request (fail-open) when Supabase fetch throws an error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network timeout'));
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event);
    // Fail-open: return the original request, not a 500
    expect(result).toBe(event.Records[0].cf.request);
  });

  // salish-g9e: the viewer-request Lambda is killed at 5s and CloudFront
  // serves a 503 — every network call must carry its own deadline so slowness
  // surfaces as a catchable error inside the fail-open try/catch instead.
  it('bounds every fetch with an AbortSignal deadline', async () => {
    const mockFetch = servePublished(sampleOccurrence);
    await handler(makeEvent('facebookexternalhit/1.1', 'o=abc123'));
    const options = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails open to the origin when the Supabase fetch aborts on its deadline', async () => {
    jest.spyOn(global, 'fetch')
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123', '/');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/');
  });

  it('logs an og-fail-open line naming the uri and error when failing open', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network timeout'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await handler(makeEvent('facebookexternalhit/1.1', 'o=abc123', '/'));
    const line = errorSpy.mock.calls.map(c => String(c[0])).find(m => m.includes('og-fail-open'));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ msg: 'og-fail-open', uri: '/', error: expect.stringContaining('Network timeout') });
  });

  it('logs og-fetch timing and status for each read', async () => {
    servePublished(sampleOccurrence);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await handler(makeEvent('facebookexternalhit/1.1', 'o=abc123'));
    const lines = logSpy.mock.calls.map(c => String(c[0])).filter(m => m.includes('"og-fetch"')).map(l => JSON.parse(l));
    expect(lines).toEqual([
      expect.objectContaining({ msg: 'og-fetch', kind: 'ids', status: 200 }),
      expect.objectContaining({ msg: 'og-fetch', kind: 'day', status: 200 }),
    ]);
  });

  it('warms the read path\'s connection at module init when running in Lambda', () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) } as Response);
    const prevEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-fn';
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('./index');
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://salishsea.io/read-path/manifest.json');
      expect(options.signal).toBeInstanceOf(AbortSignal);
    } finally {
      if (prevEnv === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      else process.env.AWS_LAMBDA_FUNCTION_NAME = prevEnv;
    }
  });

  // salish-cwd: the first real fetch must reuse the warmup's connection
  // rather than race it, but must never be held hostage by a stalled warmup.
  describe('init warmup handoff', () => {
    // Load a fresh copy of the module with the Lambda env guard satisfied, so
    // the warmup runs and its promise is live for the handler to wait on.
    function loadInLambda(warmupFetch: () => Promise<Response>) {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementationOnce(warmupFetch);
      const prevEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-fn';
      let mod: typeof import('./index');
      try {
        jest.isolateModules(() => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          mod = require('./index');
        });
      } finally {
        if (prevEnv === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        else process.env.AWS_LAMBDA_FUNCTION_NAME = prevEnv;
      }
      return { mod: mod!, fetchSpy };
    }

    const occurrenceResponse = {
      ok: true,
      status: 200,
      json: async () => [sampleOccurrence],
    } as Response;

    it('waits for an in-flight warmup before issuing the first Supabase fetch', async () => {
      let releaseWarmup: () => void;
      const warmupDone = new Promise<void>(resolve => { releaseWarmup = resolve; });
      const { mod, fetchSpy } = loadInLambda(async () => {
        await warmupDone;
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) } as Response;
      });

      let realFetchIssued = false;
      fetchSpy.mockImplementation(async () => { realFetchIssued = true; return occurrenceResponse; });

      const pending = mod.handler(makeEvent('facebookexternalhit/1.1', 'o=abc123'));
      await Promise.resolve();
      expect(realFetchIssued).toBe(false); // still waiting on the warmup

      releaseWarmup!();
      await pending;
      expect(realFetchIssued).toBe(true);
    });

    it('gives up on a stalled warmup and fetches anyway, on a reduced deadline', async () => {
      jest.useFakeTimers();
      try {
        // A warmup that never settles — the handler must not hang on it.
        const { mod, fetchSpy } = loadInLambda(() => new Promise<Response>(() => {}));
        fetchSpy.mockResolvedValue(occurrenceResponse);

        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const pending = mod.handler(makeEvent('facebookexternalhit/1.1', 'o=abc123'));
        await jest.advanceTimersByTimeAsync(WARMUP_WAIT_MS);
        const result = await pending;

        expect(result.status).toBe('200');
        // Warmup call is mockImplementationOnce; the real read is the next one.
        const options = fetchSpy.mock.calls[1]?.[1] as RequestInit;
        expect(options.signal).toBeInstanceOf(AbortSignal);
        // Waited the full cap and no longer — and that time came out of the
        // fetch's own deadline rather than extending the total budget.
        const line = logSpy.mock.calls.map(c => String(c[0])).find(m => m.includes('"og-fetch"'));
        expect(JSON.parse(line!)).toMatchObject({ msg: 'og-fetch', warmupMs: WARMUP_WAIT_MS });
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not wait again once a fetch has already waited out the warmup', async () => {
      jest.useFakeTimers();
      try {
        // The warmup must NOT settle on its own. With one that resolves
        // immediately, waiting again is indistinguishable from not waiting —
        // both cost ~0ms — so the only thing an elapsed-time assertion measures
        // is clock granularity. (It measured 1ms on a loaded runner and failed a
        // build on #352.) Stalled, the timer is the sole escape from
        // awaitWarmup, so "didn't wait" becomes something a test can observe:
        // the second call has to settle without any timer advancing at all.
        const { mod, fetchSpy } = loadInLambda(() => new Promise<Response>(() => {}));
        fetchSpy.mockResolvedValue(occurrenceResponse);

        // First invocation: pays the full cap, and consumes pendingWarmup.
        const first = mod.handler(makeEvent('facebookexternalhit/1.1', 'o=abc123'));
        await jest.advanceTimersByTimeAsync(WARMUP_WAIT_MS);
        await first;

        // console.log is already spied in beforeEach, and spyOn hands back that
        // same mock — so its calls still hold the first invocation's og-fetch
        // (warmupMs 1000). Clear it, or `find` below reads the wrong line.
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        logSpy.mockClear();
        let settled = false;
        const second = mod.handler(makeEvent('facebookexternalhit/1.1', 'o=abc123'))
          .then((r: unknown) => { settled = true; return r; });

        // Drain the microtask queue without touching the clock. Enough hops to
        // clear the handler's await chain; a handler that waited on the warmup
        // again is still parked on a 1000ms timer that nothing has advanced.
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(settled).toBe(true);

        await second;
        const line = logSpy.mock.calls.map(c => String(c[0])).find(m => m.includes('"og-fetch"'));
        // Exact under fake timers: the clock is frozen, so this can't flake.
        expect(JSON.parse(line!)).toMatchObject({ msg: 'og-fetch', warmupMs: 0 });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('does not touch the network at import time outside Lambda (no env guard)', () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockRejectedValue(new Error('unexpected network call'));
    const prevEnv = process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('./index');
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (prevEnv !== undefined) process.env.AWS_LAMBDA_FUNCTION_NAME = prevEnv;
    }
  });

});

describe('L-01 carve-out: /dwca/* path-gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  it('passes through /dwca/* request unmodified for bot UA', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const event = makeEvent('facebookexternalhit/1.1', '', '/dwca/salishsea-occurrences-v1.zip');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes through /dwca/* request unmodified for non-bot UA', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const event = makeEvent('Mozilla/5.0', '', '/dwca/salishsea-occurrences-v1.zip');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes through /dwca/* request with querystring unmodified', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const event = makeEvent('twitterbot/1.0', 'foo=bar', '/dwca/salishsea-occurrences-v1.zip');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes through /dwca/sub/path.parquet — prefix is /dwca/ not a hardcoded filename', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const event = makeEvent('slackbot/1.0', '', '/dwca/salishsea-occurrences-v1.parquet');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

});

describe('SEO carve-out: /sitemap.xml and /robots.txt path-gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  // baiduspider and google-snippet ARE in BOT_AGENTS — without the carve-out they
  // would receive synthesized OG HTML instead of the raw sitemap/robots file.
  it('passes through /sitemap.xml unmodified for a listed crawler (baiduspider)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const event = makeEvent('Mozilla/5.0 (compatible; Baiduspider/2.0)', '', '/sitemap.xml');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes through /robots.txt unmodified for a listed crawler (google-snippet)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const event = makeEvent('Google-Snippet', '', '/robots.txt');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes through /sitemap.xml unmodified for non-bot UA', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const event = makeEvent('Mozilla/5.0', '', '/sitemap.xml');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

});

describe('map cards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  const bodyFor = async (querystring: string, occurrence?: { id: string; [field: string]: unknown }) => {
    if (occurrence) servePublished(occurrence); else servePublished();
    const result = await handler(makeEvent('facebookexternalhit/1.1', querystring)) as { body: string };
    return result.body;
  };

  it('percent-encodes the colon in a provider-prefixed occurrence id', async () => {
    // Ids look like `inaturalist:375544838`; a raw colon in a path segment is
    // legal but needlessly ambiguous to intermediaries.
    const body = await bodyFor('o=inaturalist:375544838', {
      ...sampleOccurrence, id: 'inaturalist:375544838', photos: [],
    });
    expect(body).toContain('https://salishsea.io/cards/o/inaturalist%3A375544838.jpg');
  });

  it('falls back to the brand card for a photoless occurrence with no coordinates', async () => {
    // The renderer 404s without a location, so a map card URL here would sit
    // broken inside a post. The brand card always resolves (decision 026).
    const body = await bodyFor('o=abc123', {
      ...sampleOccurrence, photos: [], location: null,
    });
    expect(body).not.toContain('/cards/o/');
    expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    // The rest of the card still works — it is only the picture that is missing.
    expect(body).toContain('Orca · June 3, 2025');
  });

  it('still uses an open-licensed photo when the occurrence has no coordinates', async () => {
    const body = await bodyFor('o=abc123', { ...sampleOccurrence, location: null });
    expect(body).toContain('https://example.com/orca.jpg');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('names a day card for a shared date', async () => {
    const body = await bodyFor('d=2026-07-27');
    expect(body).toContain('<meta property="og:image" content="https://salishsea.io/cards/day/2026-07-27.jpg">');
    expect(body).toContain('Sightings · July 27, 2026');
    expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
    // The og:url points back at the day the sharer was looking at.
    expect(body).toContain('https://salishsea.io/?d=2026-07-27');
  });

  it('prefers the occurrence card when both o and d are present', async () => {
    const body = await bodyFor('d=2026-07-27&o=abc123', { ...sampleOccurrence, photos: [] });
    expect(body).toContain('/cards/o/abc123.jpg');
    expect(body).not.toContain('/cards/day/');
  });

  it.each([
    ['2026-02-31', 'a date that does not exist'],
    ['2026-13-01', 'a month that does not exist'],
    ['2026-7-27', 'an unpadded date'],
    ['yesterday', 'a word'],
    ['', 'an empty value'],
  ])('falls back to the site card for %s (%s)', async (date) => {
    // A malformed date must never become a card URL that 404s inside a post;
    // the site card it falls back to carries the brand card, which resolves.
    const body = await bodyFor(`d=${date}`);
    expect(body).not.toContain('/cards/day/');
    expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
    expect(body).toContain('Salish Sea');
  });
});

// A 75×75 thumbnail is below Facebook's 200×200 og:image floor, so declaring one
// is as good as declaring nothing. iNat serves `large` (1024px) off the same path.
describe('og:image uses a card-sized photo, not the 75×75 iNat thumbnail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  const withPhoto = (src: string) => ({ ...sampleOccurrence, photos: [{ src, license: 'cc0' }] });

  const cardFor = async (src: string) => {
    servePublished(withPhoto(src));
    const result = await handler(makeEvent('facebookexternalhit/1.1', 'o=abc123')) as { body: string };
    return result.body.match(/<meta property="og:image" content="([^"]*)">/)?.[1];
  };

  it('rewrites the iNaturalist square variant to large', async () => {
    expect(await cardFor('https://inaturalist-open-data.s3.amazonaws.com/photos/705787369/square.jpg'))
      .toBe('https://inaturalist-open-data.s3.amazonaws.com/photos/705787369/large.jpg');
  });

  it('preserves the original extension', async () => {
    expect(await cardFor('https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpeg'))
      .toBe('https://inaturalist-open-data.s3.amazonaws.com/photos/1/large.jpeg');
  });

  it('rewrites photos served from static.inaturalist.org too', async () => {
    expect(await cardFor('https://static.inaturalist.org/photos/42/square.png'))
      .toBe('https://static.inaturalist.org/photos/42/large.png');
  });

  it.each([
    // HappyWhale and Spotter URLs carry no size variant — nothing to rewrite.
    'https://au-hw-media-m.happywhale.com/49f1c4f4-1f5b-4c6f-9c7a-000000000000.jpg',
    'https://spotter-production.s3.amazonaws.com/images/photo.jpg',
    // Our own uploads are already full-size.
    'https://salishsea-io.s3.us-west-2.amazonaws.com/Js-susan.jpg',
    // A `square` segment on a non-iNat host is left alone — we can't assume
    // some other provider serves a `large` sibling.
    'https://example.com/photos/7/square.jpg',
    // Lookalike authorities must not satisfy the host check: `src` is ingested
    // data, so a substring match on "inaturalist" would be enough to redirect
    // a card's image at an attacker-chosen origin.
    'https://evil-inaturalist.example/photos/7/square.jpg',
    'https://static.inaturalist.org.evil.example/photos/7/square.jpg',
    'https://inaturalist-open-data.s3.amazonaws.com.evil.example/photos/7/square.jpg',
    // Already large: not double-rewritten.
    'https://inaturalist-open-data.s3.amazonaws.com/photos/705787369/large.jpg',
  ])('passes through %s unchanged', async (src) => {
    expect(await cardFor(src)).toBe(src);
  });
});

describe('Image-asset carve-out: og:image must serve bytes, not OG HTML', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  // Regression for the broken-Facebook-preview bug: when a card's og:image lives on
  // our own origin, the crawler fetches that image URL with the SAME bot UA; without
  // this carve-out the handler returned OG-meta HTML as the image body, so the card
  // broke. Today's cards only reference off-origin photos, but any image path must
  // still pass through to origin as bytes.
  it('passes through an on-origin image path unmodified for a crawler', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const event = makeEvent('facebookexternalhit/1.1', '', '/preview.jpg');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    '/preview.jpg',
    '/img/whale.jpeg',
    '/icons/logo.png',
    '/photo.GIF',
    '/marker.svg',
    '/hero.webp',
    '/favicon.ico',
    '/next-gen.avif',
  ])('passes through image asset %s for a bot UA', async (uri) => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const event = makeEvent('twitterbot/1.0', '', uri);
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not treat a query-string image extension as an asset path (?o=inaturalist:...)', async () => {
    servePublished();
    // uri is '/', extension-like tokens live only in the querystring — must still intercept
    const event = makeEvent('facebookexternalhit/1.1', 'o=inaturalist:377539157', '/');
    const result = await handler(event) as { status: string; body: string };
    expect(result).not.toBe(event.Records[0].cf.request);
    expect(result.status).toBe('200');
    expect(result.body).toContain('og:title');
  });
});

// Profile pages are prerendered, with their own OG tags, canonical links and
// redirects, by the origin since salishsea.io reads the Fly app (salish-xv35.16).
// The edge leaves every profile path alone, for crawlers too, and asks nothing.
describe('a crawler gets a synthesized preview on the map page only', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['/observation/dwca/x', '/sitemap.xml.bak', '/observation.html', '/about.html'])(
    '%s goes to the origin, whose page carries its own tags', async (uri) => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected network call'));
      const event = makeEvent('facebookexternalhit/1.1', 'o=abc123', uri);
      expect(await handler(event)).toBe(event.Records[0].cf.request);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

  it('/index.html is the map page too', async () => {
    const event = makeEvent('facebookexternalhit/1.1', '', '/index.html');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('og:title');
  });
});

describe('profile paths pass through to the origin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['/individuals/0010193/T065A', 'Mozilla/5.0 (Macintosh)'],
    ['/individuals/0010193/T065A', 'facebookexternalhit/1.1'],
    ['/individuals/T065A', 'facebookexternalhit/1.1'],
    ['/matrilines/0010001/J2s', 'twitterbot'],
    ['/populations/0000010/Southern-Resident', 'slackbot'],
    ['/haulouts/170/Waadah-Island', 'Mozilla/5.0 (Macintosh)'],
  ])('%s for %s: untouched, no lookup', async (uri, ua) => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected network call'));
    const event = makeEvent(ua, '', uri);
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe(uri);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
