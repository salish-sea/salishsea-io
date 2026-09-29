/**
 * The document a prerendered profile ships as: the shell's head with the page's own
 * tags, and its content in a declarative shadow root.
 */

import { describe, expect, test } from 'vitest';
import { css, html } from 'lit';

import { renderDocument } from './profile-document.ts';

const SHELL = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
    <title>Individual — SalishSea.io</title>
    <meta name="description" content="Profile of an individual whale.">
    <meta property="og:site_name" content="SalishSea.io">
    <meta property="og:title" content="Individual — SalishSea.io">
    <meta property="og:description" content="Profile of an individual whale.">
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

    test('none of the client-rendered page\'s scripts', () => {
        const doc = render();
        expect(doc).not.toContain('<script');
        expect(doc).not.toContain('modulepreload');
    });

    test('the content in a declarative shadow root, with its styles, and no hydration markers', () => {
        const doc = render();
        expect(doc).toMatch(/<individual-page><template shadowrootmode="open"><style>:host \{ display: block; \}<\/style><main><h1>Tl&#39;uk &quot;\$&amp;&quot; &lt;b&gt;<\/h1><\/main><\/template><\/individual-page>/);
        expect(doc).not.toMatch(/<!--\/?lit-/);
    });

    test('a shell that has changed shape fails, rather than ship the generic title', () => {
        expect(() => renderDocument(SHELL.replace('<individual-page></individual-page>', ''), 'individual-page', [], HEAD, html``))
            .toThrow(/exactly one <individual-page> element/);
    });
});
