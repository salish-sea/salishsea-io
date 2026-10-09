/**
 * The document a prerendered profile ships as: the shell's head with the page's own
 * tags, and its content in a declarative shadow root.
 */

import { describe, expect, test } from 'vitest';
import { css, html } from 'lit';

import { islandFromManifest, renderDocument } from './profile-document.ts';

const SHELL = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
    <title>Individual — SalishSea.io</title>
    <meta name="description" content="Profile of an individual whale.">
    <meta property="og:site_name" content="SalishSea.io">
    <meta property="og:title" content="Individual — SalishSea.io">
    <meta property="og:description" content="Profile of an individual whale.">
    <link rel="icon" href="/favicon.svg">
    <script type="module" crossorigin src="/assets/individual-abc.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/sentry-def.js">
  </head>
  <body>
    <individual-page></individual-page>
  </body>
</html>`;

const HEAD = {
    title: 'Tl\'uk "$&" <b>',
    description: 'Female, born 1986 · Names & family of Tl\'uk.',
    path: '/individuals/0010193/T065A',
};

const render = () => renderDocument(SHELL, 'individual-page', [css`:host { display: block; }`], HEAD,
    html`<main><h1>${HEAD.title}</h1></main>`);

describe('renderDocument', () => {
    test('the page\'s own title, description, preview and canonical tags, escaped', () => {
        const doc = render();
        expect(doc).toContain('<title>Tl\'uk &quot;$&amp;&quot; &lt;b&gt; · SalishSea.io</title>');
        expect(doc).toContain('<meta name="description" content="Female, born 1986 · Names &amp; family of Tl\'uk.">');
        expect(doc).toContain('<link rel="canonical" href="https://salishsea.io/individuals/0010193/T065A">');
        expect(doc).toContain('<meta property="og:url" content="https://salishsea.io/individuals/0010193/T065A">');
        expect(doc).toContain('<meta property="og:title" content="Tl\'uk &quot;$&amp;&quot; &lt;b&gt;">');
        expect(doc).not.toContain('Individual — SalishSea.io');
    });

    test('the shell\'s other head content stays', () => {
        expect(render()).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`);
    });

    test('none of the shell\'s own scripts', () => {
        const doc = render();
        expect(doc).not.toContain('<script');
        expect(doc).not.toContain('modulepreload');
    });

    test('the content in a declarative shadow root, with its styles, and no hydration markers', () => {
        const doc = render();
        expect(doc).toMatch(/<individual-page><template shadowrootmode="open"><style>:host \{ display: block; \}<\/style><main><h1>Tl&#39;uk &quot;\$&amp;&quot; &lt;b&gt;<\/h1><\/main><\/template><\/individual-page>/);
        expect(doc).not.toMatch(/<!--\/?lit-/);
    });

    test('an island\'s tags at the end of the head, in place of the shell\'s script, only when the page has its element', () => {
        const island = {element: 'individual-map', tags: '<script type="module" src="/assets/map.js"></script>'};
        const withMap = renderDocument(SHELL, 'individual-page', [], HEAD,
            html`<individual-map src="/read-path/x.links.json"></individual-map>`, [island]);
        expect(withMap).toContain('<link rel="icon" href="/favicon.svg">\n    <script type="module" src="/assets/map.js"></script>\n  </head>');
        expect(withMap).not.toContain('individual-abc.js');
        const without = renderDocument(SHELL, 'individual-page', [], HEAD, html`<p>No sightings.</p>`, [island]);
        expect(without).not.toContain('<script');
    });

    test('a shell that has changed shape fails, rather than ship the generic title', () => {
        expect(() => renderDocument(SHELL.replace('<individual-page></individual-page>', ''), 'individual-page', [], HEAD, html``))
            .toThrow(/exactly one <individual-page> element/);
    });
});

describe('islandFromManifest', () => {
    const MANIFEST = {
        'src/map-island.ts': {file: 'assets/map-island-A.js', imports: ['_map-B.js'], css: ['assets/island-C.css']},
        '_map-B.js': {file: 'assets/map-B.js', imports: ['_ol-D.js', '_lit-E.js']},
        '_ol-D.js': {file: 'assets/ol-D.js', imports: ['_lit-E.js'], css: ['assets/ol-F.css']},
        '_lit-E.js': {file: 'assets/lit-E.js'},
        'src/main.ts': {file: 'assets/main-G.js', imports: ['_lit-E.js']},
    };

    test('the entry\'s script, a preload per chunk it reaches once each, and their CSS', () => {
        expect(islandFromManifest(MANIFEST, 'src/map-island.ts', 'individual-map')).toEqual({
            element: 'individual-map',
            tags: [
                '<script type="module" crossorigin src="/assets/map-island-A.js"></script>',
                '<link rel="modulepreload" crossorigin href="/assets/map-B.js">',
                '<link rel="modulepreload" crossorigin href="/assets/ol-D.js">',
                '<link rel="modulepreload" crossorigin href="/assets/lit-E.js">',
                '<link rel="stylesheet" crossorigin href="/assets/island-C.css">',
                '<link rel="stylesheet" crossorigin href="/assets/ol-F.css">',
            ].join('\n    '),
        });
    });

    test('an entry the site wasn\'t built with fails the build', () => {
        expect(() => islandFromManifest(MANIFEST, 'src/other.ts', 'x')).toThrow(/no entry src\/other\.ts/);
    });
});
