import { test, expect } from '@playwright/test';

// Wait for the edge handler this deploy shipped before asserting on what it says.
//
// Smoke runs the moment `cdk deploy` returns, but a new Lambda@Edge version takes
// minutes to replicate, and the first request a cold container answers can blow
// its 3s Supabase deadline and take decision 015's fail-open path (the bare shell,
// no per-thing OG tags). Neither is a regression; both read as one to an
// assertion that fires too early. On 2026-08-31 that failed the smoke of a deploy
// that had not touched the handler at all and filed a spurious deploy-failed issue
// (bd salish-eia).
//
// So the wait is separate from the assertions: probe one OG route until it
// answers with profile tags, then run every test exactly as strict as before. A
// genuine regression still fails — after the bounded wait, with the assertion's
// own message rather than a timeout. On the scheduled run, the probe passes on
// its first request and costs nothing.
const READY_TIMEOUT_MS = 5 * 60_000;
const READY_INTERVAL_MS = 10_000;
const BOT_UA = { 'User-Agent': 'facebookexternalhit/1.1' };

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(READY_TIMEOUT_MS + 30_000);
  const api = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  const started = Date.now();
  try {
    for (let attempt = 1; ; attempt++) {
      const response = await api.get('/individuals/T065A', { headers: BOT_UA });
      const body = await response.text();
      if (response.status() === 200 && body.includes('content="profile"')) {
        if (attempt > 1) console.log(`edge handler ready after ${attempt} probes, ${Date.now() - started}ms`);
        return;
      }
      if (Date.now() - started >= READY_TIMEOUT_MS) {
        console.warn(`edge handler still serving the shell after ${attempt} probes, ${Date.now() - started}ms; asserting anyway`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, READY_INTERVAL_MS));
    }
  } finally {
    await api.dispose();
  }
});

test('bot UA on homepage receives OG meta tags', async ({ request }) => {
  const response = await request.get('/', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('og:title');
  expect(body).toContain('SalishSea.io');
  expect(body).toContain('og:type');
  // The homepage has no image of a thing shared, so it carries the brand card
  // (decision 026, superseding 019) — identity-shaped, true of every link.
  expect(body).toContain('og:description');
  expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
  expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
});

// The card only counts if the crawler that follows og:image gets bytes back.
// A brand card intercepted into OG HTML is the 019-era broken-preview bug.
test('the brand card serves image bytes to the crawler that reads og:image', async ({ request }) => {
  const response = await request.get('/social-card.jpg', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/jpeg');
  // Above Facebook's 200x200 floor in every sense — the real 1200x630 card.
  expect((await response.body()).byteLength).toBeGreaterThan(20_000);
});

test('bot UA on a dated link receives a day card', async ({ request }) => {
  const response = await request.get('/?d=2026-07-26', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('https://salishsea.io/cards/day/2026-07-26.jpg');
  expect(body).toContain('July 26, 2026');
});

// A fixed past date rather than an occurrence id: the card must exist forever,
// and a day card renders whether or not anything was seen that day.
test('card images serve bytes, not OG HTML, to the crawler that reads og:image', async ({ request }) => {
  const response = await request.get('/cards/day/2026-07-26.jpg', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/jpeg');
  // Above Facebook's 200x200 floor in every sense — a real rendered map.
  expect((await response.body()).byteLength).toBeGreaterThan(20_000);
});

test('regular browser UA on homepage receives SPA', async ({ request }) => {
  const response = await request.get('/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  // Regular browsers get the real SPA shell (with the <salish-sea> root element),
  // not the synthesized, empty-body bot preview page.
  expect(body).toContain('<salish-sea>');
});

test('bot UA on an individual page receives profile OG meta tags', async ({ request }) => {
  const response = await request.get('/individuals/T065A', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('T065A');
  expect(body).toContain('og:title');
  expect(body).toContain('content="profile"');
  expect(body).toContain('https://salishsea.io/individuals/T065A');
  // A profile has no image of its own, so it carries the brand card. Asserted
  // per route: the shared fallback is easy to restore to text-only for one
  // path without noticing (decision 026).
  expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
  expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
});

test('regular browser UA on an individual page receives the page shell', async ({ request }) => {
  const response = await request.get('/individuals/T065A', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  // The viewer-request function rewrites /individuals/* to the individual.html
  // shell (there is no S3 object at the path itself).
  expect(body).toContain('<individual-page>');
});

test('bot UA on a matriline page receives profile OG meta tags', async ({ request }) => {
  const response = await request.get('/matrilines/T065A', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('T065A');
  expect(body).toContain('og:title');
  expect(body).toContain('content="profile"');
  expect(body).toContain('https://salishsea.io/matrilines/T065A');
  // A profile has no image of its own, so it carries the brand card. Asserted
  // per route: the shared fallback is easy to restore to text-only for one
  // path without noticing (decision 026).
  expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
  expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
});

test('regular browser UA on a matriline page receives the page shell', async ({ request }) => {
  const response = await request.get('/matrilines/T065A', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  // The viewer-request function rewrites /matrilines/* to the matriline.html
  // shell (there is no S3 object at the path itself).
  expect(body).toContain('<matriline-page>');
});

test('bot UA on an ecotype page receives profile OG meta tags', async ({ request }) => {
  const response = await request.get('/ecotypes/Biggs', {
    headers: { 'User-Agent': 'facebookexternalhit/1.1' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('og:title');
  expect(body).toContain('content="profile"');
  expect(body).toContain('https://salishsea.io/ecotypes/Biggs');
  // A profile has no image of its own, so it carries the brand card. Asserted
  // per route: the shared fallback is easy to restore to text-only for one
  // path without noticing (decision 026).
  expect(body).toContain('<meta property="og:image" content="https://salishsea.io/social-card.jpg">');
  expect(body).toContain('<meta name="twitter:card" content="summary_large_image">');
});

test('regular browser UA on an ecotype page receives the page shell', async ({ request }) => {
  const response = await request.get('/ecotypes/Biggs', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  // The viewer-request function rewrites /ecotypes/* to the ecotype.html
  // shell (there is no S3 object at the path itself).
  expect(body).toContain('<ecotype-page>');
});
