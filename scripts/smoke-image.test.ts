/**
 * The smoke workflow runs in Playwright's image, which carries only the browser
 * build of its own version. A runner from any other version finds no browser and
 * fails every browser test, but only after a deploy, against production. A
 * Dependabot update moved the runner past the image once (#707).
 */

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test("the smoke workflow's Playwright image is the locked @playwright/test version", () => {
    const workflow = readFileSync('.github/workflows/smoke.yml', 'utf8');
    const lockfile = readFileSync('pnpm-lock.yaml', 'utf8');
    const image = workflow.match(/mcr\.microsoft\.com\/playwright:v([\d.]+)-/)?.[1];
    const locked = lockfile.match(/^ {2}'@playwright\/test@([\d.]+)':$/m)?.[1];
    expect(locked).toBeDefined();
    expect(image).toBe(locked);
});
