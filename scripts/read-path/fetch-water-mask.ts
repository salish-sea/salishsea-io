/**
 * Brings the basemap's water mask to the build (salish-20u7.2), from the URLs the site's
 * style names (src/basemap-style.json, `salishsea:water`.mask and .grid; basemap decision
 * 028):
 *
 *   node scripts/read-path/fetch-water-mask.ts <basemap-style.json> <water-mask.png> <water-mask.json>
 *
 * Fetched as the place lists are (fetch-water-regions.ts): each URL is named for its
 * file's contents, so a file already holding them is left alone and a download that
 * doesn't match is refused. Unlike the lists, the mask is optional: a style that doesn't
 * name one yet (basemap versions before decision 028) makes `fetchWaterMask` return
 * "absent" and write nothing. The command line exits 1 on it: the build's day files are
 * joined by sea on the mask (salish-20u7.3), so a build with no mask stops here rather
 * than quietly joining in a straight line.
 */
import { readFileSync } from 'node:fs';

import { fetchNamedFile } from './fetch-water-regions.ts';

type Style = {metadata?: Record<string, unknown>};

/** The picture's and the georeference's URLs and the hashes their names promise, or null when the style names no mask. */
export function waterMaskUrls(style: Style): {mask: {url: string, hash: string}, grid: {url: string, hash: string}} | null {
    const water = style.metadata?.['salishsea:water'] as Record<string, string> | undefined;
    if (!water) return null;
    const named = (key: 'mask' | 'grid', extension: string) => {
        const url = water[key];
        const hash = url?.match(new RegExp(`-([0-9a-f]{16})\\.${extension}$`))?.[1];
        if (!url || !hash) throw new Error(`the style's water ${key} isn't named for its contents: ${JSON.stringify(url)}`);
        return {url, hash};
    };
    return {mask: named('mask', 'png'), grid: named('grid', 'json')};
}

export async function fetchWaterMask(stylePath: string, pngOut: string, jsonOut: string): Promise<'unchanged' | 'fetched' | 'absent'> {
    const urls = waterMaskUrls(JSON.parse(readFileSync(stylePath, 'utf8')));
    if (!urls) return 'absent';
    // The picture first: a reader never sees a new georeference beside an old picture for long, and a build that finds
    // either missing or stale fetches again.
    const results = [
        await fetchNamedFile(urls.mask.url, urls.mask.hash, pngOut),
        await fetchNamedFile(urls.grid.url, urls.grid.hash, jsonOut),
    ];
    return results.includes('fetched') ? 'fetched' : 'unchanged';
}

if (import.meta.main) {
    const [style, png, json, ...rest] = process.argv.slice(2);
    if (!style || !png || !json || rest.length) {
        console.error('usage: fetch-water-mask.ts <basemap-style.json> <water-mask.png> <water-mask.json>');
        process.exit(2);
    }
    const result = await fetchWaterMask(style, png, json);
    console.log(`water mask: ${result}`);
    if (result === 'absent') {
        console.error(`${style} names no water mask (metadata "salishsea:water"): move the site to a basemap version that publishes one`);
        process.exit(1);
    }
}
