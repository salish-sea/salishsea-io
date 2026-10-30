/**
 * Brings the basemap's water regions to the build (salish-fwyt.2), and its OpenStreetMap
 * place list, which says where the landmarks it names are (decision 100), from the URLs
 * the site's style names (src/basemap-style.json, `salishsea:places`.regions and .osm):
 *
 *   node scripts/read-path/fetch-water-regions.ts <basemap-style.json> <water-regions.json> [<places-osm.json>]
 *
 * Each URL is named for the list's contents (places-<key>-<the first 16 hex digits of
 * its SHA-256>.json, basemap decision 018), so a file already holding those contents is
 * left alone, and a download that doesn't match is refused. Written beside and renamed
 * over, so the derivation never reads half a list. A new basemap version moves the URLs,
 * which is how the build learns the lists changed.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { isRetryableStatus, MAX_ATTEMPTS, retryDelayMs } from '../ingest/retry.ts';

const sha16 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

const LISTS = {regions: 'water regions', osm: 'OpenStreetMap places', gazetteers: 'gazetteer places'} as const;
export type ListKey = keyof typeof LISTS;

/** A place list's URL and the hash its name promises; refuses a style that names none. */
export function placeListUrl(style: {metadata?: Record<string, unknown>}, key: ListKey): {url: string, hash: string} {
    const places = style.metadata?.['salishsea:places'] as Record<string, string> | undefined;
    const url = places?.[key];
    const hash = url?.match(/-([0-9a-f]{16})\.json$/)?.[1];
    if (!url || !hash) throw new Error(`the style names no ${LISTS[key]} list named for its contents: ${JSON.stringify(url)}`);
    return {url, hash};
}

export const regionsUrl = (style: {metadata?: Record<string, unknown>}) => placeListUrl(style, 'regions');

export async function fetchPlaceList(stylePath: string, key: ListKey, out: string): Promise<'unchanged' | 'fetched'> {
    const {url, hash} = placeListUrl(JSON.parse(readFileSync(stylePath, 'utf8')), key);
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
    const [style, regions, osm, ...rest] = process.argv.slice(2);
    if (!style || !regions || rest.length) {
        console.error('usage: fetch-water-regions.ts <basemap-style.json> <water-regions.json> [<places-osm.json>]');
        process.exit(2);
    }
    console.log(`water regions: ${await fetchPlaceList(style, 'regions', regions)}`);
    if (osm) console.log(`OpenStreetMap places: ${await fetchPlaceList(style, 'osm', osm)}`);
}
