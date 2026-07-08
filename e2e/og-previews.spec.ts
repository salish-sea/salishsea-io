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
  // Homepage card now carries a description and a fallback image
  expect(body).toContain('og:description');
  expect(body).toContain('og:image');
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
