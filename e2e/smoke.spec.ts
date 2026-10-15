import { test, expect } from '@playwright/test';
import path from 'node:path';

test('production smoke', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  page.on('requestfailed', request => {
    // A request the page cancelled is not a failure: MapLibre cancels the basemap's
    // tile reads that a move of the map made unnecessary.
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
    failedRequests.push(`${request.failure()?.errorText} ${request.url()}`);
  });

  // Wait for concrete readiness signals rather than network idle, which the
  // manifest poll and the tile loads make a poor proxy: the day's sightings arriving,
  // from the read-path build's file since salishsea.io reads the Fly app
  // (salish-xv35.16), and the map element rendering.
  const occurrencesResponse = page.waitForResponse(
    response =>
      response.url().includes('/read-path/days/') &&
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
