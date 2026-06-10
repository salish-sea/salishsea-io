import { test, expect } from '@playwright/test';
import path from 'node:path';

test('production smoke', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  page.on('requestfailed', request => {
    failedRequests.push(`${request.failure()?.errorText} ${request.url()}`);
  });

  // The app holds a persistent Supabase realtime WebSocket, so the network
  // never goes idle -- waitForLoadState('networkidle') would hang until timeout.
  // Instead, wait for concrete readiness signals: the core occurrences data
  // fetch returning, and the map element rendering.
  const occurrencesResponse = page.waitForResponse(
    response =>
      response.url().includes('/rest/v1/occurrences') &&
      response.request().method() === 'GET',
    { timeout: 30_000 },
  );

  await page.goto('/', { waitUntil: 'load' });
  await occurrencesResponse;
  await expect(page.locator('obs-map')).toBeVisible();

  await page.screenshot({
    path: path.join('e2e/screenshots', `smoke-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`),
    fullPage: true,
  });

  expect(consoleErrors, 'console errors').toEqual([]);
  expect(failedRequests, 'failed requests').toEqual([]);
});
