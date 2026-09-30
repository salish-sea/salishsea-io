/**
 * Where every profile lives, for what finds the pages rather than renders them
 * (decision 057, step 5).
 *
 *   EXPORT_DIR=… node scripts/read-path/profile-index.ts <snapshot.duckdb> <dist>
 *
 * Writes three files into $EXPORT_DIR:
 *
 * - redirects.json: each profile kind's designations, folded, mapped to the canonical
 *   address. A legacy or typed link (/individuals/T65A, /matrilines/T065As) is
 *   redirected from this by scripts/read-path/redirect.ts, with no database lookup:
 *   the same answers the Lambda@Edge function gives on AWS by asking PostgREST.
 * - sitemap.xml: the site's own pages, as Vite writes them into <dist>/sitemap.xml,
 *   and after them every published profile.
 * - catalog-codes.json: the rows the map's sighting cards link designations from
 *   (src/individual-links.ts), in the shape its Supabase query returns, so a sighting
 *   that mentions T065A links to her page while the database is unreachable.
 *
 * Only subjects the profile build writes a page for are listed (profiles.ts's
 * filters: an animal or a group with a register identifier, every haul-out site), so
 * neither file points at a page that isn't there.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import * as path from 'node:path';

import { ecotypePath, hauloutPath, individualPath, matrilinePath } from '../../src/catalog.ts';
import { designationKey, type Redirects } from './redirect-keys.ts';
import { SITE_ORIGIN } from './profile-document.ts';
import { readSnapshot, type Doc, type Tables } from './snapshot-tables.ts';
import type { CatalogCodeRows } from '../../src/individual-links.ts';

const TABLES = ['individuals', 'designations', 'social_groups', 'haulouts'] as const;
type IndexTables = Pick<Tables, (typeof TABLES)[number]>;

export { designationKey, matrilineKey, type Redirects } from './redirect-keys.ts';

const byId = (a: Doc, b: Doc) => a['id'] - b['id'];

// The canonical paths, from the columns each needs.
const individualAt = (i: Doc) => individualPath({entity_id: i['entity_id'], primary_designation: i['primary_designation']});
const matrilineAt = (g: Doc) => matrilinePath({entity_id: g['entity_id'], designation: g['designation']});
const ecotypeAt = (g: Doc) => ecotypePath({entity_id: g['entity_id'], designation: g['designation']});
const hauloutAt = (h: Doc) => hauloutPath({id: h['id'], name: h['name']});

/**
 * Which designation row wins when two animals' codes fold alike: the animal the code
 * is primary for, then the one it is current for, then the lower individual id, then
 * the lower row id — never row order. Most preferred first.
 */
function byPrecedence(a: Doc, b: Doc): number {
    const rank = (d: Doc) => [d['is_primary'] ? 0 : 1, d['status'] === 'current' ? 0 : 1, d['individual_id'], d['id']];
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3];
}

export function buildRedirects(t: IndexTables): Redirects {
    const individuals = new Map(t.individuals.filter(i => i['entity_id']).map(i => [i['id'], i]));
    // Every code an animal has carried, current or not: a link made with a superseded
    // code still names the animal. Should two animals ever share a folded code, the
    // one it is primary for wins, then the current one, then the lower id — never row
    // order.
    const ranked = [...t.designations].sort(byPrecedence);
    const out: Redirects = {individuals: {}, matrilines: {}, ecotypes: {}};
    for (const d of ranked) {
        const individual = individuals.get(d['individual_id']);
        const key = designationKey(d['code']);
        if (individual && !Object.hasOwn(out.individuals, key))
            out.individuals[key] = individualAt(individual);
    }
    for (const g of [...t.social_groups].filter(g => g['entity_id']).sort(byId)) {
        const into = g['kind'] === 'matriline' ? out.matrilines : g['kind'] === 'ecotype' ? out.ecotypes : null;
        const key = designationKey(g['designation']);
        if (into && !Object.hasOwn(into, key))
            into[key] = g['kind'] === 'matriline' ? matrilineAt(g) : ecotypeAt(g);
    }
    return out;
}

/**
 * What src/individual-links.ts's Supabase query returns: every designation with the
 * individual carrying it, and the matriline and ecotype designations. Every row, as
 * that query has no filter. Designations run least preferred first: the lookup keeps
 * the last row for a folded code, so where two animals' codes fold alike the one the
 * redirects choose wins here too.
 */
export function buildCatalogCodes(t: IndexTables): CatalogCodeRows {
    const individuals = new Map(t.individuals.map(i => [i['id'], i]));
    return {
        designations: [...t.designations].sort((a, b) => byPrecedence(b, a)).map(d => {
            const i = individuals.get(d['individual_id']);
            return {code: d['code'], individual: i ? {entity_id: i['entity_id'], primary_designation: i['primary_designation']} : null};
        }),
        groups: [...t.social_groups].sort(byId)
            .filter(g => g['kind'] === 'matriline' || g['kind'] === 'ecotype')
            .map(g => ({kind: g['kind'], designation: g['designation'], entity_id: g['entity_id']})),
    };
}

/** Every published profile's canonical path, in a fixed order. */
export function profilePaths(t: IndexTables): string[] {
    const individuals = t.individuals.filter(i => i['entity_id']).sort(byId).map(individualAt);
    const groups = t.social_groups.filter(g => g['entity_id']).sort(byId);
    const matrilines = groups.filter(g => g['kind'] === 'matriline').map(matrilineAt);
    const ecotypes = groups.filter(g => g['kind'] === 'ecotype').map(ecotypeAt);
    const haulouts = [...t.haulouts].sort(byId).map(hauloutAt);
    return [...ecotypes, ...matrilines, ...individuals, ...haulouts];
}

function escapeXml(s: string): string {
    return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Vite's sitemap with the profiles after its own entries. A profile carries no
 * <lastmod>: the build knows when it last rendered a page, not when the page last
 * changed, and a date that moves every hour says nothing.
 */
export function buildSitemap(viteSitemap: string, paths: string[]): string {
    const close = '</urlset>';
    const at = viteSitemap.lastIndexOf(close);
    if (at < 0 || viteSitemap.indexOf(close) !== at)
        throw new Error('dist/sitemap.xml: expected exactly one </urlset>');
    const urls = paths.map(p => `  <url>\n    <loc>${escapeXml(SITE_ORIGIN + p)}</loc>\n    <changefreq>weekly</changefreq>\n  </url>\n`).join('');
    return viteSitemap.slice(0, at) + urls + viteSitemap.slice(at);
}

/** Written beside and renamed over, so a reader never sees half a file. */
async function writeAtomically(file: string, content: string): Promise<void> {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, content);
    await rename(tmp, file);
}

export async function main(): Promise<void> {
    const [snapshot, dist] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !dist || !exportDir) {
        console.error('usage: EXPORT_DIR=… profile-index.ts <snapshot.duckdb> <dist>');
        process.exit(2);
    }
    const tables = await readSnapshot(snapshot, s => s.tables(TABLES));
    const redirects = buildRedirects(tables);
    const paths = profilePaths(tables);
    const sitemap = buildSitemap(await readFile(path.join(dist, 'sitemap.xml'), 'utf8'), paths);
    await writeAtomically(path.join(exportDir, 'redirects.json'), JSON.stringify(redirects));
    await writeAtomically(path.join(exportDir, 'sitemap.xml'), sitemap);
    await writeAtomically(path.join(exportDir, 'catalog-codes.json'), JSON.stringify(buildCatalogCodes(tables)));
    const counts = Object.entries(redirects).map(([k, v]) => `${Object.keys(v).length} ${k}`).join(', ');
    console.log(`redirects.json: ${counts}; sitemap.xml: ${paths.length} profiles`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
