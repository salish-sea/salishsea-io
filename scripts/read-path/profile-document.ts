/**
 * A prerendered profile page as a whole HTML document (decision 057).
 *
 * The document starts from the shell Vite builds for the page (dist/individual.html
 * and its siblings), so its head — the CSP, the icons, the root styles — has one
 * source, and a change to it reaches the prerendered pages too. Into it go the page's
 * own title, description, link-preview and canonical tags, and in place of the empty
 * custom element, the rendered content as a declarative shadow root: the same styles,
 * applied as a client-rendered element would have them, and no script needed to show it.
 *
 * Every substitution must match exactly once. A shell that has changed shape fails
 * the build rather than quietly producing a page with the generic title.
 *
 * The shell's own scripts go, if it has any (the whales shell's placeholder; the
 * profile shells have none, being templates only). What a page loads instead is its
 * islands — the map and the search, today — and only those it has an element for.
 */

import { render } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import type { CSSResult, TemplateResult } from 'lit';

export const SITE_ORIGIN = 'https://salishsea.io';

/** The nav's search field (GH #640): an island on every prerendered page, its own entry so a page without a map loads only it. */
export const SEARCH_ISLAND = 'src/site-search.ts';

export type PageHead = {
    title: string,
    description: string,
    /** Root-relative canonical path, e.g. /individuals/0010193/t065a. */
    path: string,
};

/**
 * A custom element the prerendered page upgrades in the browser, and the tags that
 * load its definition. The one client-side part of a profile page (decision 057).
 */
export type Island = {
    element: string,
    tags: string,
};

/** One entry of Vite's build manifest (dist/.vite/manifest.json). */
type ManifestChunk = {file: string, imports?: string[], css?: string[]};

/**
 * The tags that load a built entry, from Vite's manifest: its module script, a
 * preload for every chunk it imports, and its CSS, as Vite writes them into the
 * HTML pages it builds. Root-absolute, since the page answers at a nested path.
 */
export function islandFromManifest(manifest: Record<string, ManifestChunk>, entry: string, element: string): Island {
    const main = manifest[entry];
    if (!main) throw new Error(`Vite manifest: no entry ${entry}; was the site built?`);
    const preloads: string[] = [];
    const css = new Set(main.css ?? []);
    const seen = new Set<string>();
    const visit = (key: string) => {
        if (seen.has(key)) return;
        seen.add(key);
        const chunk = manifest[key];
        if (!chunk) throw new Error(`Vite manifest: ${entry} imports ${key}, which it doesn't list`);
        preloads.push(chunk.file);
        for (const file of chunk.css ?? []) css.add(file);
        for (const next of chunk.imports ?? []) visit(next);
    };
    for (const key of main.imports ?? []) visit(key);
    const tags = [
        `<script type="module" crossorigin src="/${escapeAttr(main.file)}"></script>`,
        ...preloads.map(file => `<link rel="modulepreload" crossorigin href="/${escapeAttr(file)}">`),
        ...[...css].map(file => `<link rel="stylesheet" crossorigin href="/${escapeAttr(file)}">`),
    ];
    return {element, tags: tags.join('\n    ')};
}

function escapeAttr(value: string): string {
    // & first, or the entities the others introduce would be escaped again.
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * A lit-html template as static HTML. Lit's server renderer marks every binding with
 * comments so a client can hydrate it; nothing here is hydrated — the only script on
 * the page is the map's — so they go.
 */
export function renderStatic(template: TemplateResult): string {
    return collectResultSync(render(template))
        .replace(/<!--\/?lit-part[^>]*-->/g, '')
        .replace(/<!--lit-node \d+-->/g, '');
}

function replaceOnce(html: string, pattern: RegExp, replacement: string, what: string): string {
    const matches = html.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
    if (matches?.length !== 1)
        throw new Error(`profile shell: expected exactly one ${what}, found ${matches?.length ?? 0}`);
    // A function, not a string: a string replacement treats `$&` and `$1` in the
    // content — a name, a description — as patterns.
    return html.replace(pattern, () => replacement);
}

export function renderDocument(
    shell: string,
    element: string,
    styles: CSSResult[],
    head: PageHead,
    body: TemplateResult,
    islands: Island[] = [],
): string {
    const title = `${head.title} · SalishSea.io`;
    const url = `${SITE_ORIGIN}${head.path}`;
    let html = shell;
    html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${escapeAttr(title)}</title>`, '<title>');
    html = replaceOnce(html, /<meta name="description" content="[^"]*">/,
        `<meta name="description" content="${escapeAttr(head.description)}">\n    <link rel="canonical" href="${escapeAttr(url)}">`,
        'description meta');
    html = replaceOnce(html, /<meta property="og:title" content="[^"]*">/,
        `<meta property="og:title" content="${escapeAttr(head.title)}">\n    <meta property="og:url" content="${escapeAttr(url)}">`,
        'og:title meta');
    html = replaceOnce(html, /<meta property="og:description" content="[^"]*">/,
        `<meta property="og:description" content="${escapeAttr(head.description)}">`, 'og:description meta');
    const content = renderStatic(body);
    // A prerendered page loads none of the shell's own scripts, only the islands it has
    // an element for, at the end of the head.
    const scripts = islands.filter(i => content.includes(`<${i.element}`)).map(i => `\n    ${i.tags}`).join('');
    html = html.replace(/\n\s*<link rel="modulepreload"[^>]*>/g, '');
    html = html.replace(/\n\s*<script type="module"[^>]*><\/script>/g, '');
    html = replaceOnce(html, /\s*<\/head>/, `${scripts}\n  </head>`, '</head>');
    const css = styles.map(s => s.cssText).join('\n');
    html = replaceOnce(html, new RegExp(`<${element}></${element}>`),
        `<${element}><template shadowrootmode="open"><style>${css}</style>${content}</template></${element}>`,
        `<${element}> element`);
    return html;
}
