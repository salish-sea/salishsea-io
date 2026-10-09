import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error vite.config.js is plain JavaScript with no declarations
import { devProfilePage, prerenderedProfiles, vendorChunk } from './vite.config.js';

// pnpm puts a package at node_modules/.pnpm/<name>@<version>/node_modules/<name>/…,
// so the name is read after the last node_modules/, not the first.
const pnpm = (name: string, file = 'index.js') =>
  `/repo/node_modules/.pnpm/${name.replace('/', '+')}@1.0.0/node_modules/${name}/${file}`;

describe('vendorChunk', () => {
  it.each([
    ['ol', 'vendor-ol'],
    ['rbush', 'vendor-ol'],
    ['lit-html', 'vendor-lit'],
    ['@lit/reactive-element', 'vendor-lit'],
    ['@sentry/browser', 'vendor-sentry'],
    ['@tanstack/form-core', 'vendor-form'],
    ['dompurify', 'vendor-dompurify'],
    ['temporal-polyfill', 'vendor-temporal'],
  ])('puts %s in %s', (name, chunk) => {
    expect(vendorChunk(pnpm(name))).toBe(chunk);
  });

  it('reads the package, not a directory inside it', () => {
    expect(vendorChunk(pnpm('ol', 'layer/Vector.js'))).toBe('vendor-ol');
  });

  it('leaves our own code to Rolldown', () => {
    expect(vendorChunk('/repo/src/read-path.ts')).toBeNull();
    expect(vendorChunk('/repo/src/sentry.ts')).toBeNull();
  });

  it('leaves libraries loaded on demand to Rolldown, so they stay out of the first load', () => {
    expect(vendorChunk(pnpm('exifreader'))).toBeNull();
    expect(vendorChunk(pnpm('marked'))).toBeNull();
  });

  it('does not take a package whose name merely starts like a listed one', () => {
    expect(vendorChunk(pnpm('olive'))).toBeNull();
    expect(vendorChunk(pnpm('lit-something'))).toBeNull();
  });
});

describe('devProfilePage', () => {
  // A prerendered page names the build's hashed files (scripts/read-path/profile-document.ts),
  // which the dev server doesn't have; in development its islands load from the source.
  const built = `<meta http-equiv="Content-Security-Policy" content="
      default-src 'self';
      upgrade-insecure-requests;
    ">
    <script type="module" crossorigin src="/assets/map-island-Bx1_9z.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-ol-map-D3m.js">
    <link rel="stylesheet" crossorigin href="/assets/map-island-C4.css">
    <script type="module" crossorigin src="/assets/site-search-a1B2.js"></script>
  </head>`;

  it('loads each island from its source, drops the built preloads and styles, and lets http stay http', () => {
    const dev = devProfilePage(built);
    expect(dev).toContain('<script type="module" src="/src/map-island.ts"></script>');
    expect(dev).toContain('<script type="module" src="/src/site-search.ts"></script>');
    expect(dev).not.toContain('/assets/');
    expect(dev).not.toContain('upgrade-insecure-requests');
  });
});

describe('prerenderedProfiles, in development', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  // What the middleware does with one request: the page it served, or where it sent the request on.
  const serve = (url: string) => {
    const req = {url};
    let body: string | null = null;
    const res = {setHeader: () => {}, end: (b: string) => { body = b; }};
    let passed = false;
    prerenderedProfiles({fromSource: true})(req, res, () => { passed = true; });
    return {body: body as string | null, passed, url: req.url};
  };

  it('serves the page a local build wrote, slug or none, and leaves other paths alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'read-path-'));
    mkdirSync(join(dir, 'profiles', 'individuals'), {recursive: true});
    writeFileSync(join(dir, 'profiles', 'individuals', '0010193.html'), '<p>T065A</p>');
    vi.stubEnv('READ_PATH_DIR', dir);
    expect(serve('/individuals/0010193/T065A').body).toBe('<p>T065A</p>');
    expect(serve('/individuals/0010193').body).toBe('<p>T065A</p>');
    expect(serve('/about.html')).toEqual({body: null, passed: true, url: '/about.html'});
  });

  it('answers a page no build wrote, and a designation, with the not-published page', () => {
    vi.stubEnv('READ_PATH_DIR', mkdtempSync(join(tmpdir(), 'read-path-')));
    expect(serve('/matrilines/0002163/T065As')).toEqual({body: null, passed: true, url: '/not-published.html'});
    expect(serve('/individuals/T65A')).toEqual({body: null, passed: true, url: '/not-published.html'});
  });
});
