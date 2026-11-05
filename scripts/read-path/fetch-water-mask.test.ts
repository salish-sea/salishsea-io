import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import { fetchWaterMask, waterMaskUrls } from './fetch-water-mask.ts';

const sha16 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const style = (water?: unknown) => ({metadata: water ? {'salishsea:water': water} : {}});

describe('waterMaskUrls', () => {
    test('is null for a style that names no mask, so the build goes without', () => {
        expect(waterMaskUrls(style())).toBeNull();
    });

    test("the site's own style names a mask and its grid, each by its contents (basemap 2026.11.1 on)", () => {
        const urls = waterMaskUrls(JSON.parse(readFileSync(new URL('../../src/basemap-style.json', import.meta.url), 'utf8')));
        expect(urls?.mask.url).toMatch(/^https:\/\/tiles\.salishsea\.io\/water\/water-mask-[0-9a-f]{16}\.png$/);
        expect(urls?.grid.url).toMatch(/^https:\/\/tiles\.salishsea\.io\/water\/water-mask-[0-9a-f]{16}\.json$/);
    });

    test('reads both files and the hashes their names promise', () => {
        expect(waterMaskUrls(style({mask: 'https://x.org/water-mask-0123456789abcdef.png', grid: 'https://x.org/water-mask-fedcba9876543210.json'}))).toEqual({
            mask: {url: 'https://x.org/water-mask-0123456789abcdef.png', hash: '0123456789abcdef'},
            grid: {url: 'https://x.org/water-mask-fedcba9876543210.json', hash: 'fedcba9876543210'},
        });
    });

    test('refuses a name that does not carry the contents\' hash', () => {
        expect(() => waterMaskUrls(style({mask: 'https://x.org/water-mask.png', grid: 'https://x.org/g-0123456789abcdef.json'}))).toThrow(/water mask/);
    });
});

describe('fetchWaterMask', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'water-mask-'));
    const png = new Uint8Array([1, 2, 3]), json = new Uint8Array([123, 125]);
    const stylePath = path.join(dir, 'style.json');
    writeFileSync(stylePath, JSON.stringify(style({mask: `https://x.org/m-${sha16(png)}.png`, grid: `https://x.org/g-${sha16(json)}.json`})));

    test('is absent when the style names none, and fetched then unchanged when it does', async () => {
        const empty = path.join(dir, 'empty.json');
        writeFileSync(empty, JSON.stringify(style()));
        expect(await fetchWaterMask(empty, path.join(dir, 'a.png'), path.join(dir, 'a.json'))).toBe('absent');

        const get = vi.fn(async (url: string | URL | Request) => new Response(String(url).endsWith('.png') ? png : json));
        vi.stubGlobal('fetch', get);
        try {
            const out = [path.join(dir, 'm.png'), path.join(dir, 'm.json')] as const;
            expect(await fetchWaterMask(stylePath, ...out)).toBe('fetched');
            expect(readFileSync(out[0])).toEqual(Buffer.from(png));
            expect(await fetchWaterMask(stylePath, ...out)).toBe('unchanged');
            expect(get).toHaveBeenCalledTimes(2);
        } finally { vi.unstubAllGlobals(); }
    });

    test('refuses a download that is not what its name says', async () => {
        vi.stubGlobal('fetch', async () => new Response(new Uint8Array([9, 9])));
        try {
            await expect(fetchWaterMask(stylePath, path.join(dir, 'bad.png'), path.join(dir, 'bad.json'))).rejects.toThrow(/don't match its name/);
        } finally { vi.unstubAllGlobals(); }
    });
});
