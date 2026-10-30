/**
 * Brings the basemap's water regions to the build (salish-fwyt.2), from the URL the
 * site's style names (src/basemap-style.json, `salishsea:places`.regions):
 *
 *   node scripts/read-path/fetch-water-regions.ts <basemap-style.json> <water-regions.json>
 *
 * The URL is named for the list's contents (places-regions-<the first 16 hex digits of
 * its SHA-256>.json, basemap decision 018), so a file already holding those contents is
 * left alone, and a download that doesn't match is refused. Written beside and renamed
 * over, so the derivation never reads half a list. A new basemap version moves the URL,
 * which is how the build learns the regions changed.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { isRetryableStatus, MAX_ATTEMPTS, retryDelayMs } from '../ingest/retry.ts';

const sha16 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** The regions list's URL and the hash its name promises; refuses a style that names none. */
export function regionsUrl(style: {metadata?: Record<string, unknown>}): {url: string, hash: string} {
    const places = style.metadata?.['salishsea:places'] as Record<string, string> | undefined;
    const url = places?.['regions'];
    const hash = url?.match(/-([0-9a-f]{16})\.json$/)?.[1];
    if (!url || !hash) throw new Error(`the style names no water regions list named for its contents: ${JSON.stringify(url)}`);
    return {url, hash};
}

export async function fetchWaterRegions(stylePath: string, out: string): Promise<'unchanged' | 'fetched'> {
    const {url, hash} = regionsUrl(JSON.parse(readFileSync(stylePath, 'utf8')));
    if (existsSync(out) && sha16(readFileSync(out)) === hash) return 'unchanged';
    for (let attempt = 1; ; attempt++) {
        // A stalled server fails the task, which the next build retries, rather than holding up this one.
        const response = await fetch(url, {signal: AbortSignal.timeout(60_000)});
        if (response.ok) {
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (sha16(bytes) !== hash) throw new Error(`${url}: its contents don't match its name (${sha16(bytes)})`);
            writeFileSync(`${out}.part`, bytes);
            renameSync(`${out}.part`, out);
            return 'fetched';
        }
        if (attempt >= MAX_ATTEMPTS || !isRetryableStatus(response.status)) throw new Error(`${url}: ${response.status}`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs(attempt)));
    }
}

if (import.meta.main) {
    const [style, out] = process.argv.slice(2);
    if (!style || !out) {
        console.error('usage: fetch-water-regions.ts <basemap-style.json> <water-regions.json>');
        process.exit(2);
    }
    console.log(`water regions: ${await fetchWaterRegions(style, out)}`);
}
