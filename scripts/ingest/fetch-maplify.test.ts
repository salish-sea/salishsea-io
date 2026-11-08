import { afterEach, describe, expect, it, vi } from 'vitest';

import { acartiaExtent } from '../../src/extents.ts';
import { fetchMaplify } from './fetch-maplify.ts';

afterEach(() => vi.unstubAllGlobals());

// How it fetches, retries and fails is fetch-json.ts's, tested there.
describe('fetchMaplify', () => {
    it("asks for the window across Acartia's extent, and names Maplify when it fails", async () => {
        const urls: string[] = [];
        vi.stubGlobal('fetch', (url: string) => {
            urls.push(url);
            return Promise.resolve({
                ok: false, status: 403, body: { cancel: () => Promise.resolve() }, headers: { get: () => null },
            });
        });
        await expect(fetchMaplify({ start: '2026-06-29', end: '2026-07-09' }, () => {})).rejects.toThrow('Maplify HTTP 403');
        expect(urls).toEqual([
            `https://maplify.com/waseak/php/search-all-sightings.php?start=2026-06-29&end=2026-07-09&BBOX=${acartiaExtent.join(',')}`,
        ]);
    });
});
