// Stand in for the values infra-stack.ts bakes into config.js at synth.
// Getters read overridable globals so a test can simulate a bundle whose
// config was never baked (index.ts references the exports live, not by copy).
jest.mock('./config', () => ({
  get SUPABASE_URL() { return (globalThis as any).__testSupabaseUrl ?? 'https://test.supabase.co'; },
  get SUPABASE_ANON_KEY() { return (globalThis as any).__testSupabaseKey ?? 'test-key'; },
}));

import { handler } from './index';

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
    // Generic homepage preview now carries a description, fallback image, and a real <title>
    expect(result.body).toContain('og:description');
    expect(result.body).toContain('og:image');
    expect(result.body).toContain('https://salishsea.io/preview.jpg');
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
    // Image is the photo src
    expect(result.body).toContain('https://example.com/orca.jpg');
    // fb:app_id present on occurrence cards too
    expect(result.body).toContain('<meta property="fb:app_id" content="678644427974059">');
  });

  it('uses branded fallback image when photo has cc-by-nc license', async () => {
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
    expect(result.body).toContain('https://salishsea.io/preview.jpg');
  });

  it('uses branded fallback image when photos array is empty', async () => {
    const occurrence = { ...sampleOccurrence, photos: [] };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [occurrence],
    } as Response);
    const event = makeEvent('twitterbot/1.0', 'o=abc123');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('https://salishsea.io/preview.jpg');
  });

  it('uses branded fallback image when all photos have non-open licenses', async () => {
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
    expect(result.body).toContain('https://salishsea.io/preview.jpg');
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

  // salishsea-io-g9e: the viewer-request Lambda is killed at 5s and CloudFront
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
      .mockResolvedValue({ ok: true, status: 200 } as Response);
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
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    }
  });

  it('does not touch the network at import time outside Lambda (no env guard)', () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockRejectedValue(new Error('unexpected network call'));
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('./index');
    });
    expect(fetchSpy).not.toHaveBeenCalled();
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

describe('Image-asset carve-out: og:image must serve bytes, not OG HTML', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  // Regression for the broken-Facebook-preview bug: the generic and fallback OG cards
  // set og:image = https://salishsea.io/preview.jpg. A crawler then fetches that image
  // URL with the SAME bot UA; without this carve-out the handler returned OG-meta HTML
  // as the image body, so the card broke. /preview.jpg must pass through to origin.
  it('passes through /preview.jpg unmodified for the crawler that reads og:image', async () => {
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

describe('/individuals/<designation> profile pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  const sampleIndividual = {
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

  it('rewrites the URI to /individual.html for a human user-agent', async () => {
    const event = makeEvent('Mozilla/5.0 (Macintosh)', '', '/individuals/T065A');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/individual.html');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('leaves non-individual paths alone for a human user-agent', async () => {
    const event = makeEvent('Mozilla/5.0 (Macintosh)', '', '/about.html');
    const result = await handler(event);
    expect(result.uri).toBe('/about.html');
  });

  it('does not rewrite deeper paths under /individuals/', async () => {
    const event = makeEvent('Mozilla/5.0 (Macintosh)', '', '/individuals/T065A/photos');
    const result = await handler(event);
    expect(result.uri).toBe('/individuals/T065A/photos');
  });

  it('returns individual-specific OG tags for a bot', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [sampleIndividual],
    } as Response);

    const event = makeEvent('facebookexternalhit/1.1', '', '/individuals/T065A');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('content="Artemis (T065A)"');
    expect(result.body).toContain('born 1986');
    expect(result.body).toContain('content="https://salishsea.io/individuals/T065A"');
    expect(result.body).toContain('content="profile"');

    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(apiUrl).toContain('/rest/v1/individuals?primary_designation=eq.T065A');
  });

  it('includes "born after" vitals when only born_earliest is known', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ ...sampleIndividual, born_earliest: 1990, born_latest: null }],
    } as Response);

    const event = makeEvent('facebookexternalhit/1.1', '', '/individuals/T065A');
    const result = await handler(event) as { body: string };
    expect(result.body).toContain('born after 1990');
  });

  it('falls back to designation-only title when there is no usable nickname', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ ...sampleIndividual, nicknames: [] }],
    } as Response);

    const event = makeEvent('facebookexternalhit/1.1', '', '/individuals/T065A');
    const result = await handler(event) as { body: string };
    expect(result.body).toContain('<title>T065A</title>');
    expect(result.body).not.toContain('Artemis');
  });

  it('returns the generic preview for an unknown designation', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    const event = makeEvent('facebookexternalhit/1.1', '', '/individuals/NOPE');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('Salish Sea');
    expect(result.body).not.toContain('NOPE');
  });

  it('fail-open for a bot still rewrites to the page shell when fetch throws', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const event = makeEvent('facebookexternalhit/1.1', '', '/individuals/T065A');
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

    const event = makeEvent('facebookexternalhit/1.1', '', '/individuals/T065A');
    const result = await handler(event) as { body: string };
    expect(result.body).not.toContain('<script>alert(1)</script>');
    expect(result.body).toContain('&lt;script&gt;');
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

describe('/ecotypes/<designation> profile pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockReset();
  });

  const sampleEcotype = { designation: 'Biggs', nicknames: [] };

  it('rewrites the URI to /ecotype.html for a human user-agent', async () => {
    const event = makeEvent('Mozilla/5.0 (Macintosh)', '', '/ecotypes/Biggs');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/ecotype.html');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not rewrite deeper paths under /ecotypes/', async () => {
    const event = makeEvent('Mozilla/5.0 (Macintosh)', '', '/ecotypes/Biggs/members');
    const result = await handler(event);
    expect(result.uri).toBe('/ecotypes/Biggs/members');
  });

  it('returns ecotype-specific OG tags for a bot', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [sampleEcotype],
    } as Response);

    const event = makeEvent('facebookexternalhit/1.1', '', '/ecotypes/Biggs');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain(`content="Bigg's (transient) killer whales"`);
    expect(result.body).toContain('content="https://salishsea.io/ecotypes/Biggs"');
    expect(result.body).toContain('content="profile"');

    const apiUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(apiUrl).toContain('/rest/v1/social_groups?designation=eq.Biggs');
    expect(apiUrl).toContain('kind=eq.ecotype');
  });

  it('returns the generic preview for an unknown designation', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    const event = makeEvent('facebookexternalhit/1.1', '', '/ecotypes/NOPE');
    const result = await handler(event) as { status: string; body: string };
    expect(result.status).toBe('200');
    expect(result.body).toContain('Salish Sea');
    expect(result.body).not.toContain('NOPE');
  });

  it('fail-open for a bot still rewrites to the page shell when fetch throws', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const event = makeEvent('facebookexternalhit/1.1', '', '/ecotypes/Biggs');
    const result = await handler(event);
    expect(result).toBe(event.Records[0].cf.request);
    expect(result.uri).toBe('/ecotype.html');
  });
});
