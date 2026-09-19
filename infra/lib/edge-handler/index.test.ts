// Stand in for the values infra-stack.ts bakes into config.js at synth.
// Getters read overridable globals so a test can simulate a bundle whose
// config was never baked (index.ts references the exports live, not by copy).
jest.mock('./config', () => ({
  get SUPABASE_URL() { return (globalThis as any).__testSupabaseUrl ?? 'https://test.supabase.co'; },
  get SUPABASE_ANON_KEY() { return (globalThis as any).__testSupabaseKey ?? 'test-key'; },
}));

import { handler, WARMUP_WAIT_MS } from './index';

// The handler emits structured JSON log lines (og-fetch, og-fail-open, …);
// keep test output clean while leaving the spies available for assertions.
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// Helper to build a CloudFront viewer-request event
function makeEvent(userAgent: string, querystring: string = '', uri: string = '') {
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
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
    const event = makeEvent('facebookexternalhit/1.1');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('<html>');
    expect(result.body).toContain('og:title');
  });

  it('returns generic preview with og:title "SalishSea.io" when no ?o= param present', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
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
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [sampleOccurrence],
    } as Response);
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
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ ...sampleOccurrence, observed_at: '2026-08-30T01:38:00Z', count: 5 }],
    } as Response);
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.body).toContain('Orca · August 29, 2026');
    expect(result.body).toContain('6:38 PM');
    expect(result.body).not.toContain('August 30, 2026');
    expect(result.body).not.toContain('1:38 AM');
  });

  // Postgres can hand back a bare timestamp with no zone designator; it is UTC.
  it('reads a zone-less observed_at as UTC, then renders it in Pacific', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ ...sampleOccurrence, observed_at: '2026-08-30 01:38:00' }],
    } as Response);
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.body).toContain('Orca · August 29, 2026');
    expect(result.body).toContain('6:38 PM');
  });

  // An explicit negative offset must be left alone, not have 'Z' appended onto it.
  it('preserves an explicit negative UTC offset on observed_at', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ ...sampleOccurrence, observed_at: '2026-08-29T18:38:00-07:00' }],
    } as Response);
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.body).toContain('Orca · August 29, 2026');
    expect(result.body).toContain('6:38 PM');
  });

  it('falls back to the map card when the photo is cc-by-nc', async () => {
    const occurrence = {
      ...sampleOccurrence,
      photos: [{ src: 'https://example.com/restricted.jpg', license: 'cc-by-nc' }],
    };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [occurrence],
    } as Response);
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).not.toContain('https://example.com/restricted.jpg');
    expect(result.body).toContain('https://salishsea.io/cards/o/abc123.jpg');
    expect(result.body).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('falls back to the map card when the photos array is empty', async () => {
    const occurrence = { ...sampleOccurrence, photos: [] };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [occurrence],
    } as Response);
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
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [occurrence],
    } as Response);
    const event = makeEvent('discordbot/1.0', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).not.toContain('https://example.com/photo1.jpg');
    expect(result.body).toContain('https://salishsea.io/cards/o/abc123.jpg');
    expect(result.body).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('returns generic preview with og:title "SalishSea.io" when occurrence is not found', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
    const event = makeEvent('facebookexternalhit/1.1', 'o=nonexistent-id');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('SalishSea.io');
    // Falls back to the generic homepage preview, which now includes a description
    expect(result.body).toContain('og:description');
    expect(result.body).toContain('<meta name="description"');
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
  it('bounds the Supabase fetch with an AbortSignal deadline', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [sampleOccurrence],
    } as Response);
    await handler(makeEvent('facebookexternalhit/1.1', 'o=abc123'));
    const options = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('fail-open when the Supabase fetch aborts on its deadline still rewrites profile paths', async () => {
    jest.spyOn(global, 'fetch')
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    const event = makeEvent('facebookexternalhit/1.1', '', '/individuals/T065A');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/individual.html');
  });

  it('logs an og-fail-open line naming the uri and error when failing open', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network timeout'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await handler(makeEvent('facebookexternalhit/1.1', 'o=abc123', '/'));
    const line = errorSpy.mock.calls.map(c => String(c[0])).find(m => m.includes('og-fail-open'));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ msg: 'og-fail-open', uri: '/', error: expect.stringContaining('Network timeout') });
  });

  it('logs og-fetch timing and status for a successful Supabase read', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [sampleOccurrence],
    } as Response);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await handler(makeEvent('facebookexternalhit/1.1', 'o=abc123'));
    const line = logSpy.mock.calls.map(c => String(c[0])).find(m => m.includes('"og-fetch"'));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ msg: 'og-fetch', kind: 'occurrence', status: 200 });
  });

  it('warms the Supabase connection at module init when running in Lambda', () => {
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
      expect(url).toBe('https://test.supabase.co/auth/v1/health');
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

  it('fails open (with the shell rewrite) when build-time config was not baked', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockRejectedValue(new Error('unexpected network call'));
    (globalThis as any).__testSupabaseUrl = '';
    (globalThis as any).__testSupabaseKey = '';
    try {
      const event = makeEvent('facebookexternalhit/1.1', '', '/individuals/T065A');
      const result = await handler(event);
      expect(result).toBe(event.Records[0].cf.request);
      expect(result.uri).toBe('/individual.html');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as any).__testSupabaseUrl;
      delete (globalThis as any).__testSupabaseKey;
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

  it('does NOT pass through paths that contain but do not start with /dwca/', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc', '/observation/dwca/x');
    const result = await handler(event) as { status: string; body: string };
    // The bot-UA branch should run, returning OG-meta HTML — NOT a pass-through
    expect(result).not.toBe(event.Records[0].cf.request);
    expect(result.status).toBe('200');
    expect(result.body).toContain('og:title');
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

  it('exact-match only — /sitemap.xml.bak is NOT carved out', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
    const event = makeEvent('facebookexternalhit/1.1', '', '/sitemap.xml.bak');
    const result = await handler(event) as { status: string; body: string };
    expect(result).not.toBe(event.Records[0].cf.request);
    expect(result.status).toBe('200');
    expect(result.body).toContain('og:title');
  });
});

describe('map cards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  const bodyFor = async (querystring: string, occurrence?: unknown) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => (occurrence ? [occurrence] : []),
    } as Response);
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
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [withPhoto(src)],
    } as Response);
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

  it('still intercepts an HTML page request with a bot UA (not an asset extension)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123', '/observation.html');
    const result = await handler(event) as { status: string; body: string };
    expect(result).not.toBe(event.Records[0].cf.request);
    expect(result.status).toBe('200');
    expect(result.body).toContain('og:title');
  });

  it('does not treat a query-string image extension as an asset path (?o=inaturalist:...)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
    // uri is '/', extension-like tokens live only in the querystring — must still intercept
    const event = makeEvent('facebookexternalhit/1.1', 'o=inaturalist:377539157', '/');
    const result = await handler(event) as { status: string; body: string };
    expect(result).not.toBe(event.Records[0].cf.request);
    expect(result.status).toBe('200');
    expect(result.body).toContain('og:title');
  });
});

// Decision 034: a profile URL keys on the register identifier's seven-digit
// local part; the designation rides along as a slug that is never read.
const sampleIndividual = {
  entity_id: 'SSA:0010193',
  primary_designation: 'T065A',
  sex: 'female',
  born_earliest: 1986,
  born_latest: 1986,
  life_status: 'alive',
  nicknames: [
    { name: 'Old Name', status: 'deprecated' },
    { name: 'Artemis', status: 'official' },
  ],
};
const CANONICAL_T065A = '/individuals/0010193/T065A';

// What PostgREST returns for a designations?select=individual:individuals(...) read.
const designationRow = (individual: unknown) => [{ individual }];

const HUMAN_UA = 'Mozilla/5.0 (Macintosh)';
const BOT_UA = 'facebookexternalhit/1.1';

type Redirect = { status: string; headers: Record<string, { key: string; value: string }[]> };
const locationOf = (result: Redirect) => result.headers.location?.[0]?.value;

describe('/individuals/<identifier>/<slug> profile pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  it('rewrites the canonical path to /individual.html for a human without a lookup', async () => {
    const event = makeEvent(HUMAN_UA, '', CANONICAL_T065A);
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/individual.html');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // Telling a stale slug from the current one costs the lookup the canonical
  // branch exists to avoid; the page fixes the address with replaceState.
  it('serves the shell to a human whatever the slug says, still without a lookup', async () => {
    for (const uri of ['/individuals/0010193/T065A9', '/individuals/0010193/t065a', '/individuals/0010193/T065A/']) {
      const event = makeEvent(HUMAN_UA, '', uri);
      const result = await handler(event);
      expect(result.uri).toBe('/individual.html');
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('leaves non-individual paths alone for a human user-agent', async () => {
    const event = makeEvent(HUMAN_UA, '', '/about.html');
    const result = await handler(event);
    expect(result.uri).toBe('/about.html');
  });

  it('does not treat deeper paths as profile pages', async () => {
    for (const uri of ['/individuals/T065A/photos', '/individuals/0010193/T065A/photos']) {
      const event = makeEvent(HUMAN_UA, '', uri);
      const result = await handler(event);
      expect(result.uri).toBe(uri);
    }
  });

  it('returns individual-specific OG tags for a bot on the canonical path, looked up by identifier', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [sampleIndividual],
    } as Response);

    const event = makeEvent(BOT_UA, '', CANONICAL_T065A);
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('content="Artemis (T065A)"');
    expect(result.body).toContain('born 1986');
    expect(result.body).toContain('content="https://salishsea.io/individuals/0010193/T065A"');
    expect(result.body).toContain('content="profile"');

    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(apiUrl).toContain('/rest/v1/individuals?entity_id=eq.SSA%3A0010193');
    expect(apiUrl).not.toContain('primary_designation=');
  });

  it('includes "born after" vitals when only born_earliest is known', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ ...sampleIndividual, born_earliest: 1990, born_latest: null }],
    } as Response);

    const event = makeEvent(BOT_UA, '', CANONICAL_T065A);
    const result = await handler(event) as { body: string };
    expect(result.body).toContain('born after 1990');
  });

  it('falls back to designation-only title when there is no usable nickname', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ ...sampleIndividual, nicknames: [] }],
    } as Response);

    const event = makeEvent(BOT_UA, '', CANONICAL_T065A);
    const result = await handler(event) as { body: string };
    expect(result.body).toContain('<title>T065A</title>');
    expect(result.body).not.toContain('Artemis');
  });

  it('returns the generic preview to a bot for an identifier nothing answers to', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    const event = makeEvent(BOT_UA, '', '/individuals/9999999/NOPE');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('Salish Sea');
    expect(result.body).not.toContain('NOPE');
  });

  it('fail-open for a bot still rewrites to the page shell when fetch throws', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const event = makeEvent(BOT_UA, '', CANONICAL_T065A);
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/individual.html');
  });

  it('escapes HTML in OG tag content built from catalog data', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{
        ...sampleIndividual,
        nicknames: [{ name: '<script>alert(1)</script>', status: 'official' }],
      }],
    } as Response);

    const event = makeEvent(BOT_UA, '', CANONICAL_T065A);
    const result = await handler(event) as { body: string };
    expect(result.body).not.toContain('<script>alert(1)</script>');
    expect(result.body).toContain('&lt;script&gt;');
  });
});

// Every address that is not the canonical one redirects to it (decision 034).
// The designation paths are the ones in the wild — every link ever shared,
// and what a person types — and the ones that were dying for 65 codes.
describe('redirects to the canonical profile address', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  const resolvesTo = (individual: unknown) =>
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => designationRow(individual) } as Response);

  it.each([HUMAN_UA, BOT_UA])('301s a designation path for UA %s, resolved through public.designations', async (ua) => {
    resolvesTo(sampleIndividual);
    for (const uri of ['/individuals/T065A', '/individuals/T065A/']) {
      const result = await handler(makeEvent(ua, '', uri)) as Redirect;
      expect(result.status).toBe('301');
      expect(locationOf(result)).toBe(CANONICAL_T065A);
      expect(result.headers['cache-control']?.[0]?.value).toBe('public, max-age=86400');
    }

    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(apiUrl).toContain('/rest/v1/designations?code=ilike.T065A&select=individual:individuals(');
    expect(apiUrl).toContain('limit=1');
  });

  // T046A was renamed T122. primary_designation never matched it; designations
  // still does, because the superseded row points at the same individual.
  it('301s a superseded code to the individual that now carries it', async () => {
    resolvesTo({ ...sampleIndividual, entity_id: 'SSA:0010368', primary_designation: 'T122', nicknames: [] });
    const result = await handler(makeEvent(HUMAN_UA, '', '/individuals/T046A')) as Redirect;
    expect(result.status).toBe('301');
    expect(locationOf(result)).toBe('/individuals/0010368/T122');
  });

  it('resolves a code as a person types it: unpadded and lower-case', async () => {
    resolvesTo(sampleIndividual);
    const result = await handler(makeEvent(HUMAN_UA, '', '/individuals/t65a')) as Redirect;
    expect(locationOf(result)).toBe(CANONICAL_T065A);
    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(apiUrl).toContain('code=ilike.T065A&');
  });

  it('matches the typed code exactly — LIKE wildcards in the path are escaped', async () => {
    resolvesTo(sampleIndividual);
    await handler(makeEvent(HUMAN_UA, '', '/individuals/CA_20%25'));
    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    // `\_` and `\%`, percent-encoded for the query string.
    expect(apiUrl).toContain(`code=ilike.${encodeURIComponent('CA\\_20\\%')}&`);
  });

  it.each([HUMAN_UA, BOT_UA])('301s a bare identifier to the slugged form for UA %s', async (ua) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => [sampleIndividual] } as Response);
    for (const uri of ['/individuals/0010193', '/individuals/0010193/']) {
      const result = await handler(makeEvent(ua, '', uri)) as Redirect;
      expect(result.status).toBe('301');
      expect(locationOf(result)).toBe(CANONICAL_T065A);
    }
    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(apiUrl).toContain('individuals?entity_id=eq.SSA%3A0010193');
  });

  // A crawler looks the subject up anyway, so a wrong slug costs nothing extra
  // to correct; og:url alone would leave the stale address in the crawler's index.
  it('301s a bot from a stale or mis-cased slug to the canonical one', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => [sampleIndividual] } as Response);
    for (const uri of ['/individuals/0010193/T065A9', '/individuals/0010193/t065a', '/individuals/0010193/T065A/']) {
      const result = await handler(makeEvent(BOT_UA, '', uri)) as Redirect;
      expect(result.status).toBe('301');
      expect(locationOf(result)).toBe(CANONICAL_T065A);
    }
  });

  it('serves a human the shell for an unknown designation — the page says so', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response);
    const event = makeEvent(HUMAN_UA, '', '/individuals/NOPE');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/individual.html');
  });

  it('serves a bot the site card for an unknown designation', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response);
    const result = await handler(makeEvent(BOT_UA, '', '/individuals/NOPE')) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('Salish Sea');
    expect(result.body).not.toContain('NOPE');
  });

  // Decision 015's rule: slowness degrades to the shell, never to a 503 — and
  // the page then does the redirect's job client-side.
  it('fails open to the shell for a human when the lookup times out', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const event = makeEvent(HUMAN_UA, '', '/individuals/T065A');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/individual.html');
  });

  it('bounds the redirect lookup with the same AbortSignal deadline', async () => {
    const mockFetch = resolvesTo(sampleIndividual);
    await handler(makeEvent(HUMAN_UA, '', '/individuals/T065A'));
    const options = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  // The register has no matriline identifiers yet (salish-ox2.6), so the
  // family is not keyed: designation paths are canonical and nothing redirects.
  it('leaves /matrilines/<designation> canonical, and does not read a two-segment matriline path', async () => {
    const human = await handler(makeEvent(HUMAN_UA, '', '/matrilines/T065A'));
    expect(human.uri).toBe('/matriline.html');
    expect(global.fetch).not.toHaveBeenCalled();

    const deeper = makeEvent(HUMAN_UA, '', '/matrilines/0002039/T073s');
    expect((await handler(deeper)).uri).toBe('/matrilines/0002039/T073s');
  });
});

describe('/matrilines/<designation> profile pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  const sampleGroup = {
    designation: 'T065A',
    nicknames: [{ name: 'Artemis family', status: 'official' }],
  };

  it('rewrites the URI to /matriline.html for a human user-agent', async () => {
    const event = makeEvent('Mozilla/5.0 (Macintosh)', '', '/matrilines/T065A');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/matriline.html');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not rewrite deeper paths under /matrilines/', async () => {
    const event = makeEvent('Mozilla/5.0 (Macintosh)', '', '/matrilines/T065A/photos');
    const result = await handler(event);
    expect(result.uri).toBe('/matrilines/T065A/photos');
  });

  it('returns matriline-specific OG tags for a bot', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [sampleGroup],
    } as Response);

    const event = makeEvent('facebookexternalhit/1.1', '', '/matrilines/T065A');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('content="Artemis family (T065A matriline)"');
    expect(result.body).toContain('content="https://salishsea.io/matrilines/T065A"');
    expect(result.body).toContain('content="profile"');

    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(apiUrl).toContain('/rest/v1/social_groups?designation=eq.T065A');
    expect(apiUrl).toContain('kind=eq.matriline');
  });

  it('falls back to a designation-only title when there is no usable nickname', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ ...sampleGroup, nicknames: [] }],
    } as Response);

    const event = makeEvent('facebookexternalhit/1.1', '', '/matrilines/T065A');
    const result = await handler(event) as { body: string };
    expect(result.body).toContain('<title>The T065A matriline</title>');
    expect(result.body).not.toContain('Artemis');
  });

  it('returns the generic preview for an unknown designation', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    const event = makeEvent('facebookexternalhit/1.1', '', '/matrilines/NOPE');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('Salish Sea');
    expect(result.body).not.toContain('NOPE');
  });

  it('fail-open for a bot still rewrites to the page shell when fetch throws', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const event = makeEvent('facebookexternalhit/1.1', '', '/matrilines/T065A');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/matriline.html');
  });
});

describe('/ecotypes/<identifier>/<slug> profile pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  const sampleEcotype = { entity_id: 'SSA:0000002', designation: 'Biggs', nicknames: [] };
  const CANONICAL_BIGGS = '/ecotypes/0000002/Biggs';

  it('rewrites the canonical path to /ecotype.html for a human without a lookup', async () => {
    const event = makeEvent(HUMAN_UA, '', CANONICAL_BIGGS);
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/ecotype.html');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not treat deeper paths as profile pages', async () => {
    for (const uri of ['/ecotypes/Biggs/members', '/ecotypes/0000002/Biggs/members']) {
      const result = await handler(makeEvent(HUMAN_UA, '', uri));
      expect(result.uri).toBe(uri);
    }
  });

  it('returns ecotype-specific OG tags for a bot on the canonical path, looked up by identifier', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [sampleEcotype],
    } as Response);

    const result = await handler(makeEvent(BOT_UA, '', CANONICAL_BIGGS)) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain(`content="Bigg's (transient) killer whales"`);
    expect(result.body).toContain('content="https://salishsea.io/ecotypes/0000002/Biggs"');
    expect(result.body).toContain('content="profile"');

    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(apiUrl).toContain('/rest/v1/social_groups?entity_id=eq.SSA%3A0000002');
    expect(apiUrl).toContain('kind=eq.ecotype');
  });

  it.each([HUMAN_UA, BOT_UA])('301s the designation path for UA %s, matched case-insensitively', async (ua) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => [sampleEcotype] } as Response);
    for (const uri of ['/ecotypes/Biggs', '/ecotypes/biggs']) {
      const result = await handler(makeEvent(ua, '', uri)) as Redirect;
      expect(result.status).toBe('301');
      expect(locationOf(result)).toBe(CANONICAL_BIGGS);
    }
    const apiUrl = (global.fetch as jest.Mock).mock.calls[1][0] as string;
    expect(apiUrl).toContain('/rest/v1/social_groups?designation=ilike.biggs&kind=eq.ecotype');
  });

  it('returns the generic preview to a bot for an unknown designation', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    const result = await handler(makeEvent(BOT_UA, '', '/ecotypes/NOPE')) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('Salish Sea');
    expect(result.body).not.toContain('NOPE');
  });

  it('fail-open for a bot still rewrites to the page shell when fetch throws', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const event = makeEvent(BOT_UA, '', CANONICAL_BIGGS);
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/ecotype.html');
  });
});

// Decision 040: a haul-out site keys on its own integer id, not a register
// identifier, and has no designation to fall back on.
describe('/haulouts/<id>/<slug> site pages', () => {
  const CANONICAL_SHILSHOLE = '/haulouts/340/Shilshole-Bay-Area';
  const sampleHaulout = { id: 340, name: 'Shilshole Bay Area', region: 'Puget Sound (Whidbey Island to Olympia)', atlas_species: ['ZC'] };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  it('rewrites the canonical path to /haulout.html for a human without a lookup', async () => {
    const event = makeEvent(HUMAN_UA, '', CANONICAL_SHILSHOLE);
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/haulout.html');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('301s a human on the bare id to the slugged address, looked up by id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => [sampleHaulout] } as Response);
    const result = await handler(makeEvent(HUMAN_UA, '', '/haulouts/340')) as { status: string; headers: Record<string, { value: string }[]> };
    expect(result.status).toBe('301');
    expect(result.headers.location[0].value).toBe(CANONICAL_SHILSHOLE);
    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(apiUrl).toContain('/rest/v1/haulouts?id=eq.340');
  });

  it('returns site OG tags for a bot on the canonical path', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => [sampleHaulout] } as Response);
    const result = await handler(makeEvent(BOT_UA, '', CANONICAL_SHILSHOLE)) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('<title>Shilshole Bay Area haul-out</title>');
    expect(result.body).toContain('California sea lion haul-out site in the Puget Sound (Whidbey Island to Olympia)');
    expect(result.body).toContain(`content="https://salishsea.io${CANONICAL_SHILSHOLE}"`);
    expect(result.body).toContain('content="place"');
    expect(result.body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
  });

  it('serves the shell to a human on a non-numeric first segment, and the generic card to a bot', async () => {
    const human = await handler(makeEvent(HUMAN_UA, '', '/haulouts/Shilshole'));
    expect(human.uri).toBe('/haulout.html');
    expect(global.fetch).not.toHaveBeenCalled();
    const bot = await handler(makeEvent(BOT_UA, '', '/haulouts/Shilshole')) as { body: string };
    expect(bot.body).toContain(`content="website"`);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not read a seven-digit segment as a site id', async () => {
    const result = await handler(makeEvent(HUMAN_UA, '', '/haulouts/0010193/T065A'));
    // Not an entity key for this family, and a slug after a designation is nothing.
    expect(result.uri).toBe('/haulouts/0010193/T065A');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns the generic preview to a bot for an id nothing answers to', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => [] } as Response);
    const result = await handler(makeEvent(BOT_UA, '', '/haulouts/999999/Nowhere')) as { body: string };
    expect(result.body).toContain(`content="website"`);
  });
});
