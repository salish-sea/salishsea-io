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
  // Homepage should not include og:image or og:description
  expect(body).not.toContain('og:image');
  expect(body).not.toContain('og:description');
});

test('regular browser UA on homepage receives SPA', async ({ request }) => {
  const response = await request.get('/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).not.toContain('og:title');
});
