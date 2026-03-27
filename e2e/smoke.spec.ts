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

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await page.screenshot({
    path: path.join('e2e/screenshots', `smoke-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`),
    fullPage: true,
  });

  expect(consoleErrors, 'console errors').toEqual([]);
  expect(failedRequests, 'failed requests').toEqual([]);
});
