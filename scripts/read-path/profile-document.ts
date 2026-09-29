/**
 * A prerendered profile page as a whole HTML document (decision 057).
 *
 * The document starts from the shell Vite builds for the page (dist/individual.html
 * and its siblings), so its head — the CSP, the icons, the root styles — has one
 * source, and a change to it reaches the prerendered pages too. Into it go the page's
 * own title, description, link-preview and canonical tags, and in place of the empty
 * custom element, the rendered content as a declarative shadow root: the same styles,
 * applied the same way, as the client-rendered page has, and no script needed to show it.
 *
 * Every substitution must match exactly once. A shell that has changed shape fails
 * the build rather than quietly producing a page with the generic title.
 */

import { render } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import type { CSSResult, TemplateResult } from 'lit';

export const SITE_ORIGIN = 'https://salishsea.io';

export type PageHead = {
    title: string,
    description: string,
    /** Root-relative canonical path, e.g. /individuals/0010193/t065a. */
    path: string,
};

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
    // The shell loads the client-rendered page; a prerendered page loads none of it.
    // (The map's own script comes back with the map island.)
    html = replaceOnce(html, /\n\s*<script type="module"[^>]*><\/script>/, '', 'module script');
    html = html.replace(/\n\s*<link rel="modulepreload"[^>]*>/g, '');
    const css = styles.map(s => s.cssText).join('\n');
    html = replaceOnce(html, new RegExp(`<${element}></${element}>`),
        `<${element}><template shadowrootmode="open"><style>${css}</style>${renderStatic(body)}</template></${element}>`,
        `<${element}> element`);
    return html;
}
