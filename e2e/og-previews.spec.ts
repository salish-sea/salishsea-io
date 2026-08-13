import { test, expect } from '@playwright/test';

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
