import { afterEach, expect, test, vi } from 'vitest';

import { release, resetRelease } from './release.ts';

afterEach(() => {
  vi.restoreAllMocks();
  resetRelease();
});

const serve = (status: number, body: string) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, {status}));

test('reads the release from /release.json', async () => {
  const fetch = serve(200, '{"release":"abc123"}');
  expect(await release()).toBe('abc123');
  expect(fetch.mock.calls[0]![0]).toBe('/release.json');
});

test('asks once, however many callers', async () => {
  const fetch = serve(200, '{"release":"abc123"}');
  await Promise.all([release(), release()]);
  await release();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('no file, or the dev server\'s HTML in its place, is unknown, and the next call asks again', async () => {
  const fetch = serve(200, '<!doctype html>');
  expect(await release()).toBe('unknown');
  fetch.mockImplementation(async () => new Response(null, {status: 404}));
  expect(await release()).toBe('unknown');
  fetch.mockImplementation(async () => new Response('{"release":"abc123"}'));
  expect(await release()).toBe('abc123');
});

test('a failed fetch is unknown, never a rejection', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  expect(await release()).toBe('unknown');
});
