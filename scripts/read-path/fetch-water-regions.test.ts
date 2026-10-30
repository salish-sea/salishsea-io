import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import { placeListUrl, regionsUrl } from './fetch-water-regions.ts';

describe('regionsUrl', () => {
    test('reads the list the site\'s own style names, and the hash its name promises', () => {
        const style = JSON.parse(readFileSync(new URL('../../src/basemap-style.json', import.meta.url), 'utf8'));
        expect(regionsUrl(style).url).toMatch(/^https:\/\/tiles\.salishsea\.io\/places\/places-regions-[0-9a-f]{16}\.json$/);
        expect(regionsUrl(style).hash).toMatch(/^[0-9a-f]{16}$/);
    });

    test('refuses a style that names none, or one not named for its contents', () => {
        expect(() => regionsUrl({metadata: {'salishsea:places': {osm: 'x'}}})).toThrow(/no water regions/);
        expect(() => regionsUrl({metadata: {'salishsea:places': {regions: 'https://example.org/regions.json'}}})).toThrow(/no water regions/);
    });
});

describe('placeListUrl', () => {
    test('reads the OpenStreetMap place list the style names, where the landmarks are (decision 100)', () => {
        const style = JSON.parse(readFileSync(new URL('../../src/basemap-style.json', import.meta.url), 'utf8'));
        expect(placeListUrl(style, 'osm').url).toMatch(/^https:\/\/tiles\.salishsea\.io\/places\/places-osm-[0-9a-f]{16}\.json$/);
        expect(() => placeListUrl({metadata: {'salishsea:places': {regions: 'x'}}}, 'osm')).toThrow(/no OpenStreetMap places/);
    });
});
