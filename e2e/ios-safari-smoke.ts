/**
 * Smoke test in Mobile Safari, in Apple's iOS Simulator (.github/workflows/ios-safari-smoke.yml). Chromium accepted what Safari refused: the
 * legacy zone name PST8PDT threw while the app's first script read its URL, and the
 * page stayed white on every iPhone for eleven days (SALISHSEA-IO-44) while the
 * Chromium smoke test passed. This drives Safari itself, through Apple's safaridriver,
 * which speaks WebDriver and can run Safari in a simulator.
 *
 *   node e2e/ios-safari-smoke.ts [https://salishsea.io]
 *
 * Expects safaridriver listening on WEBDRIVER_URL (default http://localhost:4444).
 * Plain WebDriver over fetch, so it needs nothing installed beyond Node.
 *
 * An error thrown while a page's scripts load can't be caught from here once the page
 * has loaded, so each check is that the page rendered what only a working app renders.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] ?? 'https://salishsea.io').replace(/\/$/, '');
const driver = process.env['WEBDRIVER_URL'] ?? 'http://localhost:4444';
const shots = path.join(import.meta.dirname, 'screenshots');

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
    const response = await fetch(`${driver}${route}`, {
        method,
        headers: body === undefined ? {} : {'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json() as {value: T & {error?: string, message?: string}};
    if (!response.ok) throw new Error(`${method} ${route}: ${json.value?.error ?? response.status} ${json.value?.message ?? ''}`);
    return json.value;
}

/** How many elements match `selector`, looking inside every shadow root on the page. */
const DEEP_COUNT = `
    const selector = arguments[0];
    const count = root => [...root.querySelectorAll('*')]
        .reduce((n, el) => n + (el.shadowRoot ? count(el.shadowRoot) : 0), root.querySelectorAll(selector).length);
    return count(document);`;

type Check = {name: string, path: string, selector: string, what: string};

const CHECKS: Check[] = [
    // Today, with no date in the URL: the page that went white, at the line that threw.
    {name: 'map-today', path: '/', selector: 'obs-panel', what: "the map's panel"},
    // A busy day, so the sightings themselves have to arrive and render.
    {name: 'map-sightings', path: '/?d=2026-09-29', selector: 'obs-summary', what: 'a sighting in the panel'},
    // A prerendered profile page, whose script adds the page's map.
    {name: 'profile', path: '/individuals/0010193/T065A', selector: 'h1', what: "the profile's heading"},
];

async function main(): Promise<void> {
    mkdirSync(shots, {recursive: true});
    const {sessionId, capabilities} = await call<{sessionId: string, capabilities: Record<string, unknown>}>('POST', '/session', {
        capabilities: {alwaysMatch: {
            browserName: 'Safari', platformName: 'iOS',
            'safari:useSimulator': true, 'safari:deviceType': 'iPhone',
        }},
    });
    console.log(`Safari ${capabilities['browserVersion']} on ${capabilities['platformName']} ${capabilities['safari:platformVersion'] ?? ''}`);
    const failures: string[] = [];
    try {
        for (const check of CHECKS) {
            await call('POST', `/session/${sessionId}/url`, {url: `${base}${check.path}`});
            let found = 0;
            for (let waited = 0; waited < 60_000 && found === 0; waited += 1000) {
                found = await call<number>('POST', `/session/${sessionId}/execute/sync`, {script: DEEP_COUNT, args: [check.selector]});
                if (found === 0) await new Promise(resolve => setTimeout(resolve, 1000));
            }
            const png = await call<string>('GET', `/session/${sessionId}/screenshot`);
            writeFileSync(path.join(shots, `ios-${check.name}.png`), Buffer.from(png, 'base64'));
            const line = `${check.name} (${check.path}): ${found > 0 ? `ok, ${found} × ${check.selector}` : `no ${check.what} within a minute`}`;
            console.log(line);
            if (found === 0) failures.push(line);
        }
    } finally {
        await call('DELETE', `/session/${sessionId}`).catch(() => {});
    }
    if (failures.length > 0) {
        console.error(`Mobile Safari smoke failed:\n${failures.join('\n')}`);
        process.exit(1);
    }
}

if (import.meta.main) {
    await main();
}
