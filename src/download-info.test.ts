import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Temporal } from 'temporal-polyfill';
import { formatBytes, formatRelativeTime, fetchArchiveMetadata } from './download-info.ts';

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

test('formatBytes: 0 → "0 B"', () => {
  expect(formatBytes(0)).toBe('0 B');
});

test('formatBytes: 65 → "65 B" (predictable .sha256 sidecar size)', () => {
  expect(formatBytes(65)).toBe('65 B');
});

test('formatBytes: 1023 → "1023 B" (stays in B below 1024 threshold)', () => {
  expect(formatBytes(1023)).toBe('1023 B');
});

test('formatBytes: 1024 → "1 KB" (boundary — first KB)', () => {
  expect(formatBytes(1024)).toBe('1 KB');
});

test('formatBytes: 1536 → "1.5 KB" (mid-range KB with decimal)', () => {
  expect(formatBytes(1536)).toBe('1.5 KB');
});

test('formatBytes: 1024 * 1024 → "1 MB" (boundary — first MB)', () => {
  expect(formatBytes(1024 * 1024)).toBe('1 MB');
});

test('formatBytes: 1.4 * 1024 * 1024 → "1.4 MB" (expected DwC-A size range)', () => {
  expect(formatBytes(1.4 * 1024 * 1024)).toBe('1.4 MB');
});

test('formatBytes: 1024 * 1024 * 1024 → "1 GB" (boundary — first GB)', () => {
  expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
});

// ---------------------------------------------------------------------------
// formatRelativeTime — fixed now: 2026-06-18T12:00:00Z
// ---------------------------------------------------------------------------

const NOW = Temporal.Instant.from('2026-06-18T12:00:00Z');

function headerFromNow(msAgo: number): string {
  return new Date(Number(NOW.epochMilliseconds) - msAgo).toUTCString();
}

test('formatRelativeTime: 30 minutes ago → "updated 30 minutes ago"', () => {
  const header = headerFromNow(30 * 60 * 1000);
  expect(formatRelativeTime(header, NOW)).toBe('updated 30 minutes ago');
});

test('formatRelativeTime: 6 hours ago → "updated 6 hours ago"', () => {
  const header = headerFromNow(6 * 3600 * 1000);
  expect(formatRelativeTime(header, NOW)).toBe('updated 6 hours ago');
});

test('formatRelativeTime: 24 hours ago → "updated yesterday" (numeric:auto)', () => {
  const header = headerFromNow(24 * 3600 * 1000);
  expect(formatRelativeTime(header, NOW)).toBe('updated yesterday');
});

test('formatRelativeTime: 2 days ago → "updated 2 days ago"', () => {
  const header = headerFromNow(2 * 24 * 3600 * 1000);
  expect(formatRelativeTime(header, NOW)).toBe('updated 2 days ago');
});

test('formatRelativeTime: exactly 7 days ago → absolute "updated YYYY-MM-DD"', () => {
  const header = headerFromNow(7 * 24 * 3600 * 1000);
  const result = formatRelativeTime(header, NOW);
  expect(result).toMatch(/^updated \d{4}-\d{2}-\d{2}$/);
});

test('formatRelativeTime: 14 days ago → absolute "updated YYYY-MM-DD"', () => {
  const header = headerFromNow(14 * 24 * 3600 * 1000);
  const result = formatRelativeTime(header, NOW);
  expect(result).toMatch(/^updated \d{4}-\d{2}-\d{2}$/);
});

test('formatRelativeTime: malformed header → "" (empty string, not null)', () => {
  expect(formatRelativeTime('not a date', NOW)).toBe('');
});

// ---------------------------------------------------------------------------
// fetchArchiveMetadata — mocked fetch via vi.spyOn(globalThis, 'fetch')
// ---------------------------------------------------------------------------

const LAST_MODIFIED = new Date('2026-06-18T09:02:00Z').toUTCString();
const ZIP_BYTES = '1500000';
const PARQUET_BYTES = '350000';

function makeOkResponse(contentLength: string | null, lastModified?: string) {
  const headers: Record<string, string> = {};
  if (contentLength !== null) headers['content-length'] = contentLength;
  if (lastModified != null) headers['last-modified'] = lastModified;
  return new Response(null, { status: 200, headers });
}

function make503Response() {
  return new Response(null, { status: 503 });
}

// Single spy instance; each test configures its own mockImplementation.
// Restored in afterEach to avoid leaking into other test files.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('fetchArchiveMetadata: both HEADs succeed → { ok: true, zipBytes, parquetBytes, lastModified }', async () => {
  fetchSpy.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('.zip')) return makeOkResponse(ZIP_BYTES, LAST_MODIFIED);
    return makeOkResponse(PARQUET_BYTES);
  });

  const info = await fetchArchiveMetadata('/dwca/test');
  expect(info.ok).toBe(true);
  if (!info.ok) return;
  expect(info.zipBytes).toBe(1_500_000);
  expect(info.parquetBytes).toBe(350_000);
  expect(info.lastModified).toBe(LAST_MODIFIED);

  expect(fetchSpy).toHaveBeenCalledTimes(2);
  const urls = fetchSpy.mock.calls.map(c => (typeof c[0] === 'string' ? c[0] : String(c[0])));
  expect(urls.some(u => u.endsWith('.zip'))).toBe(true);
  expect(urls.some(u => u.endsWith('.parquet'))).toBe(true);
  const methods = fetchSpy.mock.calls.map(c => (c[1] as RequestInit | undefined)?.method);
  expect(methods.every(m => m === 'HEAD')).toBe(true);
});

test('fetchArchiveMetadata: one HEAD rejects → { ok: false }', async () => {
  fetchSpy.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('.zip')) throw new Error('network error');
    return makeOkResponse(PARQUET_BYTES);
  });

  const info = await fetchArchiveMetadata('/dwca/test');
  expect(info).toEqual({ ok: false });
});

test('fetchArchiveMetadata: one HEAD returns 503 (response.ok === false) → { ok: false }', async () => {
  fetchSpy.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('.parquet')) return make503Response();
    return makeOkResponse(ZIP_BYTES, LAST_MODIFIED);
  });

  const info = await fetchArchiveMetadata('/dwca/test');
  expect(info).toEqual({ ok: false });
});

test('fetchArchiveMetadata: success with missing Content-Length on .zip → zipBytes null, ok stays true', async () => {
  fetchSpy.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('.zip')) return makeOkResponse(null, LAST_MODIFIED);
    return makeOkResponse(PARQUET_BYTES);
  });

  const info = await fetchArchiveMetadata('/dwca/test');
  expect(info.ok).toBe(true);
  if (!info.ok) return;
  expect(info.zipBytes).toBeNull();
  expect(info.parquetBytes).toBe(350_000);
});

test('fetchArchiveMetadata: fires exactly two HEAD requests to the default base path', async () => {
  fetchSpy.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('.zip')) return makeOkResponse(ZIP_BYTES, LAST_MODIFIED);
    return makeOkResponse(PARQUET_BYTES);
  });

  await fetchArchiveMetadata();
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  const urls = fetchSpy.mock.calls.map(c => (typeof c[0] === 'string' ? c[0] : String(c[0])));
  expect(urls).toContain('/dwca/salishsea-occurrences-v1.zip');
  expect(urls).toContain('/dwca/salishsea-occurrences-v1.parquet');
});
