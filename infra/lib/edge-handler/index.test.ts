import { handler, _clearCredentialCache } from './index';

// Mock @aws-sdk/client-ssm before any imports
jest.mock('@aws-sdk/client-ssm', () => {
  const mockSend = jest.fn().mockResolvedValue({
    Parameter: { Value: 'mock-value' },
  });
  return {
    SSMClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    GetParameterCommand: jest.fn(),
    __mockSend: mockSend,
  };
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

// Mock SSM to return fake Supabase credentials
function mockSsmCredentials() {
  const { SSMClient } = jest.requireMock('@aws-sdk/client-ssm') as {
    SSMClient: jest.Mock;
    __mockSend: jest.Mock;
  };
  SSMClient.mockImplementation(() => ({
    send: jest.fn()
      .mockResolvedValueOnce({ Parameter: { Value: 'https://test.supabase.co' } })
      .mockResolvedValueOnce({ Parameter: { Value: 'test-key' } }),
  }));
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
    _clearCredentialCache();
    jest.spyOn(global, 'fetch').mockReset();
    mockSsmCredentials();
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

  it('calls SSM once and caches credentials for subsequent invocations', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [sampleOccurrence],
    } as Response);

    const { SSMClient } = jest.requireMock('@aws-sdk/client-ssm') as { SSMClient: jest.Mock };
    const mockSend = jest.fn()
      .mockResolvedValueOnce({ Parameter: { Value: 'https://test.supabase.co' } })
      .mockResolvedValueOnce({ Parameter: { Value: 'test-key' } });
    SSMClient.mockImplementation(() => ({ send: mockSend }));

    const event = makeEvent('facebookexternalhit/1.1', 'o=abc123');

    // First invocation — SSM should be called
    await handler(event);
    // Second invocation — SSM should NOT be called again (cached)
    await handler(event);

    expect(mockSend).toHaveBeenCalledTimes(2); // 2 params fetched once, not 4
    expect(mockFetch).toHaveBeenCalledTimes(2); // Supabase called each time
  });
});

describe('L-01 carve-out: /dwca/* path-gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearCredentialCache();
    jest.spyOn(global, 'fetch').mockReset();
    mockSsmCredentials();
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
    _clearCredentialCache();
    jest.spyOn(global, 'fetch').mockReset();
    mockSsmCredentials();
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
    _clearCredentialCache();
    jest.spyOn(global, 'fetch').mockReset();
    mockSsmCredentials();
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
