/**
 * Smoke test in Mobile Safari, in Apple's iOS Simulator (.github/workflows/ios-safari-smoke.yml).
 * Chromium accepted what Safari on iOS 27 refused: the legacy zone name PST8PDT threw
 * while the app's first script read its URL, and the page stayed white on iPhones for
 * eleven days (SALISHSEA-IO-44) while the Chromium smoke test passed.
 *
 *   SIMULATOR_UDID=… node e2e/ios-safari-smoke.ts [https://salishsea.io]
 *
 * Each page is opened in the booted simulator's Safari, given time to load, and
 * screenshotted; it passes when the page area isn't blank, which is the symptom that
 * failure had. No WebDriver: Apple's safaridriver couldn't attach to iOS 27's simulated
 * Safari on GitHub's runner (2026-10-22), and a screenshot needs only the simulator.
 * iOS 26.5's simulator accepted PST8PDT, so the iOS version matters; the workflow boots
 * the newest one the runner has. macOS-only: it reads the screenshot through sips.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = (process.argv[2] ?? 'https://salishsea.io').replace(/\/$/, '');
const udid = process.env['SIMULATOR_UDID'];
const shots = path.join(import.meta.dirname, 'screenshots');

/**
 * Below this share of non-white pixels the page is taken as blank. The white page gave
 * exactly 0; the map about 0.55, and a profile page, mostly text on white, about 0.055.
 */
export const BLANK_BELOW = 0.01;

const CHECKS = [
    // Today, with no date in the URL: the page that went white.
    {name: 'map-today', path: '/'},
    // A busy day, so the sightings themselves load and render.
    {name: 'map-sightings', path: '/?d=2026-09-29'},
    // A prerendered profile page.
    {name: 'profile', path: '/individuals/0010193/T065A'},
];

/**
 * The share of the page area that isn't near-white, from a 24- or 32-bit BMP (what sips
 * writes): the band between the status bar and Safari's address bar, every fourth pixel.
 */
export function inkFraction(bmp: Buffer): number {
    const offset = bmp.readUInt32LE(10);
    const width = bmp.readInt32LE(18);
    const height = Math.abs(bmp.readInt32LE(22));
    const bytes = bmp.readUInt16LE(28) / 8;
    const stride = Math.ceil(width * bytes / 4) * 4;
    let ink = 0, seen = 0;
    for (let y = Math.floor(height * 0.08); y < height * 0.85; y += 4)
        for (let x = 0; x < width; x += 4) {
            const i = offset + y * stride + x * bytes;
            // BGR(A); the band is near enough symmetric top to bottom that the row order doesn't matter
            if (Math.min(bmp[i]!, bmp[i + 1]!, bmp[i + 2]!) < 235) ink++;
            seen++;
        }
    return seen === 0 ? 0 : ink / seen;
}

const wait = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const simctl = (...args: string[]) => execFileSync('xcrun', ['simctl', ...args], {stdio: ['ignore', 'ignore', 'inherit']});

async function main(): Promise<void> {
    if (!udid) throw new Error('SIMULATOR_UDID names no simulator');
    mkdirSync(shots, {recursive: true});
    const scratch = mkdtempSync(path.join(tmpdir(), 'ios-smoke-'));
    // The first URL opened in a freshly booted simulator lands on Safari's start page.
    simctl('openurl', udid, 'https://example.com/');
    await wait(20);
    const failures: string[] = [];
    for (const check of CHECKS) {
        simctl('openurl', udid, `${base}${check.path}`);
        await wait(40);
        const png = path.join(shots, `ios-${check.name}.png`);
        simctl('io', udid, 'screenshot', png);
        const bmp = path.join(scratch, `${check.name}.bmp`);
        execFileSync('sips', ['-s', 'format', 'bmp', png, '--out', bmp], {stdio: 'ignore'});
        const ink = inkFraction(readFileSync(bmp));
        const line = `${check.name} (${check.path}): ${ink >= BLANK_BELOW ? 'ok' : 'BLANK'}, ${(ink * 100).toFixed(1)}% of the page drawn`;
        console.log(line);
        if (ink < BLANK_BELOW) failures.push(line);
    }
    if (failures.length > 0) {
        console.error(`Mobile Safari smoke failed:\n${failures.join('\n')}`);
        process.exit(1);
    }
}

if (import.meta.main) {
    await main();
}
