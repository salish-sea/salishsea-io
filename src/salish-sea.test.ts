// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { dateFromObservedAt } from './salish-sea.ts';
// Side-effect import: registers <salish-sea> custom element via @customElement('salish-sea')
import './salish-sea.ts';
import type { DownloadInfo } from './download-info.ts';

test('dateFromObservedAt: UTC midnight in PST8PDT is still the same calendar day', () => {
  // 2024-07-15T18:23:00Z is 11:23 PDT — still July 15 in Pacific time
  expect(dateFromObservedAt('2024-07-15T18:23:00Z')).toBe('2024-07-15');
});

test('dateFromObservedAt: 06:00 UTC = 22:00 PST, still the previous calendar day', () => {
  // 2024-07-16T06:00:00Z is 22:00 PDT on July 15 — still July 15 in Pacific time
  expect(dateFromObservedAt('2024-07-16T06:00:00Z')).toBe('2024-07-15');
});

test('dateFromObservedAt: 08:01 UTC = 00:01 PDT, just past midnight Pacific', () => {
  // 2024-07-16T08:01:00Z is 00:01 PDT on July 16 — July 16 in Pacific time
  expect(dateFromObservedAt('2024-07-16T08:01:00Z')).toBe('2024-07-16');
});

// ─── Download section DOM tests ───────────────────────────────────────────────
// These tests drive the <salish-sea> custom element in jsdom.
//
// Assumption A1 mitigation: jsdom 29 does not implement HTMLDialogElement.showModal().
// Tests that call onAboutClicked() mock dialogRef.value.showModal to a no-op so the
// handler proceeds to the HEAD-firing path. The "download section renders" test avoids
// the issue entirely by setting @state directly without opening the dialog.
//
// Additionally: jsdom lacks ResizeObserver (used by OpenLayers in obs-map) — stub it
// globally so instantiating <salish-sea> doesn't throw before tests can run.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

// Shared response fixtures
const lastModifiedHeader = new Date('2026-06-18T06:00:00Z').toUTCString();
const okZip = () => new Response(null, { status: 200, headers: { 'content-length': '1500000', 'last-modified': lastModifiedHeader } });
const okParquet = () => new Response(null, { status: 200, headers: { 'content-length': '350000' } });
const bad503 = () => new Response(null, { status: 503 });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
  // Remove any <salish-sea> elements added by tests
  document.body.querySelectorAll('salish-sea').forEach(el => el.remove());
});

/** Create a fresh <salish-sea> element with showModal mocked to avoid jsdom limitation (A1). */
async function makeEl() {
  const el = document.createElement('salish-sea') as InstanceType<typeof import('./salish-sea.ts').default>;
  document.body.appendChild(el);
  await el.updateComplete;
  // Stub showModal so onAboutClicked can proceed past it (Assumption A1 mitigation)
  const dialogRef: { value: HTMLDialogElement | null } = (el as any).dialogRef;
  if (dialogRef.value) {
    dialogRef.value.showModal = () => {};
  }
  return el;
}

test('download section renders four hrefs + dwc + cc links', async () => {
  const el = await makeEl();

  // Set downloadInfo directly (avoids showModal jsdom limitation — Assumption A1)
  (el as any).downloadInfo = {
    ok: true,
    zipBytes: 1500000,
    parquetBytes: 350000,
    lastModified: lastModifiedHeader,
  } satisfies DownloadInfo;
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
});

test('HEAD fires on open: two requests, .zip and .parquet', async () => {
  fetchSpy.mockImplementation((url: string) => {
    if (url.endsWith('.zip')) return Promise.resolve(okZip());
    return Promise.resolve(okParquet());
  });

  const el = await makeEl();
  el.onAboutClicked(new Event('click'));

  // Let Promise.allSettled + .then callback resolve
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;

  const headCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'HEAD');
  expect(headCalls).toHaveLength(2);
  const urls = headCalls.map(([url]) => url as string);
  expect(urls.some(u => u.endsWith('.zip'))).toBe(true);
  expect(urls.some(u => u.endsWith('.parquet'))).toBe(true);
});

test('HEAD does not refire on second open', async () => {
  fetchSpy.mockImplementation((url: string) => {
    if (url.endsWith('.zip')) return Promise.resolve(okZip());
    return Promise.resolve(okParquet());
  });

  const el = await makeEl();

  // First open
  el.onAboutClicked(new Event('click'));
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;

  // Second open — guard (this.downloadInfo === null) must prevent re-fire
  el.onAboutClicked(new Event('click'));
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;

  // Still only 2 HEAD calls total (not 4)
  const headCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'HEAD');
  expect(headCalls).toHaveLength(2);
});

test('fallback on HEAD failure', async () => {
  fetchSpy.mockImplementation((url: string) => {
    if (url.endsWith('.zip')) return Promise.reject(new TypeError('network'));
    return Promise.resolve(bad503());
  });

  const el = await makeEl();
  el.onAboutClicked(new Event('click'));

  // Allow Promise.allSettled + .then to resolve
  await new Promise(r => setTimeout(r, 0));
  await el.updateComplete;

  expect((el as any).downloadInfo).toEqual({ ok: false });

  // Freshness paragraph shows static fallback copy
  const freshness = el.shadowRoot!.querySelector('.freshness');
  expect(freshness).not.toBeNull();
  expect(freshness!.textContent?.trim()).toBe('Updated nightly at 09:00 UTC.');

  // No <small> elements (no size text on failure path)
  const smalls = el.shadowRoot!.querySelectorAll('.downloads li small');
  expect(smalls).toHaveLength(0);
});
