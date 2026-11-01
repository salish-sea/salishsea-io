// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { enhanceAboutDownloads, restoreMapBackLink } from './about.ts';

// Mirrors the static markup in about.html that the enhancement script upgrades.
function makeAboutRoot(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <nav class="site-nav"><a class="about-link" href="/about.html">About</a><a class="map-link" href="/">Map</a><a class="whales-link" href="/whales">Whales</a></nav>
    <ul class="downloads">
      <li><a href="/dwca/salishsea-occurrences-v1.zip" download>zip</a><small data-size="zip"></small></li>
      <li><a href="/dwca/salishsea-occurrences-v1.parquet" download>parquet</a><small data-size="parquet"></small></li>
    </ul>
    <p class="freshness">Updated as new sightings arrive.</p>
  `;
  return root;
}

const lastModifiedHeader = new Date('2026-06-18T06:00:00Z').toUTCString();
const okZip = () => new Response(null, { status: 200, headers: { 'content-length': '1500000', 'last-modified': lastModifiedHeader } });
const okParquet = () => new Response(null, { status: 200, headers: { 'content-length': '350000' } });
const bad503 = () => new Response(null, { status: 503 });

afterEach(() => {
  vi.restoreAllMocks();
});

test('fires exactly two HEAD requests (.zip and .parquet)', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.endsWith('.zip')) return Promise.resolve(okZip());
    return Promise.resolve(okParquet());
  });

  await enhanceAboutDownloads(makeAboutRoot());

  const headCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'HEAD');
  expect(headCalls).toHaveLength(2);
  const urls = headCalls.map(([url]) => (url as string).toString());
  expect(urls.some(u => u.endsWith('.zip'))).toBe(true);
  expect(urls.some(u => u.endsWith('.parquet'))).toBe(true);
});

test('fills in sizes and a relative timestamp on success', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.endsWith('.zip')) return Promise.resolve(okZip());
    return Promise.resolve(okParquet());
  });

  const root = makeAboutRoot();
  await enhanceAboutDownloads(root);

  expect(root.querySelector('[data-size="zip"]')!.textContent).toContain('MB');
  expect(root.querySelector('[data-size="parquet"]')!.textContent).toContain('KB');
  // Static fallback replaced with a parsed "updated …" timestamp
  expect(root.querySelector('.freshness')!.textContent).toContain('updated');
});

test('restoreMapBackLink: restores the map permalink from a same-origin referrer', () => {
  const root = makeAboutRoot();
  restoreMapBackLink(root, 'https://salishsea.io/?d=2026-06-29&x=1&y=2&z=10&o=abc', 'https://salishsea.io');
  expect(root.querySelector('.map-link')!.getAttribute('href')).toBe('/?d=2026-06-29&x=1&y=2&z=10&o=abc');
});

test('restoreMapBackLink: keeps "/" fallback for a cross-origin referrer', () => {
  const root = makeAboutRoot();
  restoreMapBackLink(root, 'https://example.com/?d=2026-06-29', 'https://salishsea.io');
  expect(root.querySelector('.map-link')!.getAttribute('href')).toBe('/');
});

test('restoreMapBackLink: keeps "/" fallback when there is no referrer (direct visit)', () => {
  const root = makeAboutRoot();
  restoreMapBackLink(root, '', 'https://salishsea.io');
  expect(root.querySelector('.map-link')!.getAttribute('href')).toBe('/');
});

test('restoreMapBackLink: keeps "/" fallback for a same-origin non-map referrer', () => {
  const root = makeAboutRoot();
  restoreMapBackLink(root, 'https://salishsea.io/about.html', 'https://salishsea.io');
  expect(root.querySelector('.map-link')!.getAttribute('href')).toBe('/');
});

test('leaves the static fallbacks untouched on HEAD failure', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.endsWith('.zip')) return Promise.reject(new TypeError('network'));
    return Promise.resolve(bad503());
  });

  const root = makeAboutRoot();
  await enhanceAboutDownloads(root);

  // Sizes stay empty, freshness keeps its static copy
  expect(root.querySelector('[data-size="zip"]')!.textContent).toBe('');
  expect(root.querySelector('[data-size="parquet"]')!.textContent).toBe('');
  expect(root.querySelector('.freshness')!.textContent!.trim()).toBe('Updated as new sightings arrive.');
});

// The page's citation is typed by hand; the archive's comes from the dataset row the
// build writes (scripts/dwca/eml.ts, datasetCitation). A new version of the dataset
// changes the row's title, and this keeps the page from citing the old one.
test('the citation on about.html names the dataset as the build does', () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf-8');
  const sql = read('scripts/read-path/derive/dwc.sql');
  const row = sql.slice(sql.indexOf('CREATE OR REPLACE TABLE pgdb.dwc.datasets'));
  const title = row.match(/'([^']+)' AS title/)?.[1];
  const datasetId = row.match(/'([^']+)' AS dataset_id/)?.[1];
  expect(title).toBeTruthy();
  expect(datasetId).toBeTruthy();

  const page = document.createElement('div');
  page.innerHTML = read('about.html');
  const citation = page.querySelector('.citation')?.textContent?.replace(/\s+/g, ' ');
  expect(citation).toContain(`. ${title}. `);
  expect(citation).toContain(datasetId);
});
