// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
// Side-effect import: registers <about-page> custom element via @customElement('about-page')
import './about-page.ts';

// Shared response fixtures
const lastModifiedHeader = new Date('2026-06-18T06:00:00Z').toUTCString();
const okZip = () => new Response(null, { status: 200, headers: { 'content-length': '1500000', 'last-modified': lastModifiedHeader } });
const okParquet = () => new Response(null, { status: 200, headers: { 'content-length': '350000' } });
const bad503 = () => new Response(null, { status: 503 });

afterEach(() => {
  vi.restoreAllMocks();
  // Remove any <about-page> elements added by tests
  document.body.querySelectorAll('about-page').forEach(el => el.remove());
});

test('renders four /dwca hrefs + dwc + cc links with rel', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.endsWith('.zip')) return Promise.resolve(okZip());
    return Promise.resolve(okParquet());
  });

  const el = document.createElement('about-page') as InstanceType<typeof import('./about-page.ts').AboutPage>;
  document.body.appendChild(el);
  await el.updateComplete;
  // Allow firstUpdated's fetchArchiveMetadata promise to settle
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;

  const links = Array.from(el.shadowRoot!.querySelectorAll('a')) as HTMLAnchorElement[];

  // Four /dwca/ anchors
  const dwcaLinks = links.filter(a =>
    /^\/dwca\/salishsea-occurrences-v1(\.(zip|parquet))(\.sha256)?$/.test(a.getAttribute('href') ?? '')
  );
  expect(dwcaLinks).toHaveLength(4);

  // Outbound prose links
  const dwcLink = links.find(a => a.getAttribute('href') === 'https://dwc.tdwg.org/');
  const ccLink = links.find(a => a.getAttribute('href') === 'https://creativecommons.org/licenses/by-nc/4.0/');
  expect(dwcLink).toBeDefined();
  expect(ccLink).toBeDefined();

  // Both outbound anchors must carry rel="noopener noreferrer"
  expect(dwcLink!.getAttribute('rel')).toBe('noopener noreferrer');
  expect(ccLink!.getAttribute('rel')).toBe('noopener noreferrer');

  fetchSpy.mockRestore();
});

test('HEAD fires on mount: two requests, .zip and .parquet', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.endsWith('.zip')) return Promise.resolve(okZip());
    return Promise.resolve(okParquet());
  });

  const el = document.createElement('about-page');
  document.body.appendChild(el);
  await el.updateComplete;
  // Allow firstUpdated's fetchArchiveMetadata promise to settle
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;

  const headCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'HEAD');
  expect(headCalls).toHaveLength(2);
  const urls = headCalls.map(([url]) => (url as string).toString());
  expect(urls.some(u => u.endsWith('.zip'))).toBe(true);
  expect(urls.some(u => u.endsWith('.parquet'))).toBe(true);

  fetchSpy.mockRestore();
});

test('fallback on HEAD failure', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.endsWith('.zip')) return Promise.reject(new TypeError('network'));
    return Promise.resolve(bad503());
  });

  const el = document.createElement('about-page');
  document.body.appendChild(el);
  await el.updateComplete;
  // Allow firstUpdated's fetchArchiveMetadata promise to settle
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;

  // Freshness paragraph shows static fallback copy
  const freshness = el.shadowRoot!.querySelector('.freshness');
  expect(freshness).not.toBeNull();
  expect(freshness!.textContent?.trim()).toBe('Updated nightly at 09:00 UTC.');

  // No <small> elements (no size text on failure path)
  const smalls = el.shadowRoot!.querySelectorAll('.downloads li small');
  expect(smalls).toHaveLength(0);

  fetchSpy.mockRestore();
});
