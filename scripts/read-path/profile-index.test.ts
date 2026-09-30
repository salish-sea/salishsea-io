/**
 * The profile index: what redirects a designation path, and what the sitemap lists.
 */

import { describe, expect, test } from 'vitest';

import { buildRedirects, buildSitemap, profilePaths } from './profile-index.ts';
import { redirectFor } from './redirect.ts';

const animal = (id: number, entityId: string | null, designation: string) =>
    ({id, entity_id: entityId, primary_designation: designation});
const code = (id: number, individualId: number, c: string, extra: Record<string, unknown> = {}) =>
    ({id, individual_id: individualId, code: c, is_primary: false, status: 'current', ...extra});

function tables() {
    return {
        individuals: [animal(2, 'SSA:0010002', 'T065A2'), animal(1, 'SSA:0010193', 'T065A'), animal(3, null, 'X1')],
        designations: [
            code(10, 1, 'T065A', {is_primary: true}),
            code(11, 1, 'AM25'),
            code(12, 2, 'T065A2', {is_primary: true}),
            code(13, 3, 'X1', {is_primary: true}),
            // A superseded code another animal now holds: the one it's primary for wins.
            code(14, 1, 'T65A2', {status: 'superseded'}),
        ],
        social_groups: [
            {id: 200, kind: 'ecotype', entity_id: 'SSA:0000002', designation: 'Biggs'},
            {id: 100, kind: 'matriline', entity_id: 'SSA:0002163', designation: 'T065A'},
            {id: 101, kind: 'matriline', entity_id: null, designation: 'T065A2'},
        ],
        haulouts: [{id: 510, name: 'Race Rocks'}, {id: 12, name: 'Protection Island'}],
    };
}

describe('buildRedirects', () => {
    const redirects = () => buildRedirects(tables());

    test('every code an animal has carried, folded, to its canonical page', () => {
        expect(redirects().individuals).toEqual({
            't65a': '/individuals/0010193/T065A',
            'am25': '/individuals/0010193/T065A',
            't65a2': '/individuals/0010002/T065A2',
        });
    });

    test('groups by their designation; none for a subject without a page', () => {
        expect(redirects().matrilines).toEqual({'t65a': '/matrilines/0002163/T065As'});
        expect(redirects().ecotypes).toEqual({'biggs': '/ecotypes/0000002/Biggs'});
    });

    test('depends on the data alone: shuffled rows give the same map', () => {
        const t = tables();
        for (const rows of Object.values(t)) rows.reverse();
        expect(JSON.stringify(buildRedirects(t))).toBe(JSON.stringify(redirects()));
    });
});

describe('redirectFor', () => {
    const redirects = buildRedirects(tables());

    test.each([
        ['/individuals/T065A', '/individuals/0010193/T065A'],
        ['/individuals/t65a/', '/individuals/0010193/T065A'],
        ['/individuals/AM25', '/individuals/0010193/T065A'],
        ['/individuals/T65A?d=2026-01-01&o=x', '/individuals/0010193/T065A?d=2026-01-01&o=x'],
        ['/matrilines/T065As', '/matrilines/0002163/T065As'],
        ['/matrilines/t65a', '/matrilines/0002163/T065As'],
        ['/ecotypes/Bigg%E2%80%99s', '/ecotypes/0000002/Biggs'],
    ])('%s → %s, folded as the register compares names', (url, target) => {
        expect(redirectFor(redirects, url)).toBe(target);
    });

    test.each([
        '/individuals/J35', '/individuals/X1', '/individuals/constructor', '/individuals/__proto__',
        '/individuals/%E0%A4', '/individuals/T065A/photos', '/haulouts/T065A', '/matrilines/T065A2s',
    ])('%s names nothing we publish', url => {
        expect(redirectFor(redirects, url)).toBeNull();
    });
});

describe('the sitemap', () => {
    const VITE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://salishsea.io/</loc>
  </url>
</urlset>
`;

    test("every published profile, and only those, after the site's own pages", () => {
        expect(profilePaths(tables())).toEqual([
            '/ecotypes/0000002/Biggs', '/matrilines/0002163/T065As',
            '/individuals/0010193/T065A', '/individuals/0010002/T065A2',
            '/haulouts/12/Protection-Island', '/haulouts/510/Race-Rocks',
        ]);
        const sitemap = buildSitemap(VITE, ['/ecotypes/0000002/Biggs']);
        expect(sitemap).toContain('<loc>https://salishsea.io/</loc>\n  </url>\n  <url>\n    <loc>https://salishsea.io/ecotypes/0000002/Biggs</loc>');
        expect(sitemap.endsWith('</urlset>\n')).toBe(true);
    });

    test('a Vite sitemap that has changed shape fails the build', () => {
        expect(() => buildSitemap('<urlset>', [])).toThrow(/exactly one <\/urlset>/);
    });
});
