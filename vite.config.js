import { sentryVitePlugin } from "@sentry/vite-plugin";
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { brotliCompressSync, constants as zlib } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The commit this bundle is built from, for the `release` on a feedback report
// (decision 039) and on Sentry's events. Written to dist/release.json and read
// at runtime (src/release.ts), never compiled in: in the bundle it would change
// every hashed file on every commit (salish-xv35.14). GITHUB_SHA in CI; git
// locally; 'unknown' in a tarball with no checkout, which must not fail the
// build.
function releaseSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  } catch {
    return 'unknown';
  }
}

// The chunk a module belongs to when it comes from one of the libraries every map
// page loads up front, by npm package name; null leaves it to Rolldown. Exported
// for vite-config.test.ts.
export const VENDOR_CHUNKS = [
  ['vendor-sentry', name => name.startsWith('@sentry/')],
  ['vendor-ol', name => ['ol', 'rbush', 'quickselect'].includes(name)],
  ['vendor-lit', name => ['lit', 'lit-html', 'lit-element'].includes(name) || name.startsWith('@lit/')],
  ['vendor-form', name => name.startsWith('@tanstack/')],
  ['vendor-dompurify', name => name === 'dompurify'],
  ['vendor-temporal', name => name === 'temporal-polyfill'],
];
/** What precompress-brotli writes a .br for: text the browser fetches. Not source maps. */
const BROTLI_TYPES = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.xml', '.txt', '.webmanifest', '.geojson']);

export function vendorChunk(id) {
  const at = id.lastIndexOf('node_modules/');
  if (at < 0) return null;
  const [scope, rest] = id.slice(at + 'node_modules/'.length).split('/');
  const name = scope.startsWith('@') ? `${scope}/${rest}` : scope;
  return VENDOR_CHUNKS.find(([, matches]) => matches(name))?.[0] ?? null;
}

// The whales page's shell, client-rendered until the build has written the page.
function whalesRewrite(req, _res, next) {
  if (/^\/whales\/?(\?.*)?$/.test(req.url ?? '')) req.url = '/whales.html';
  next();
}

// A profile page in development (salish-9uu.10): the page the read-path build
// prerendered, from the export directory READ_PATH_DIR names, as Caddy serves it in
// production (fly/Caddyfile). Its islands load from the source rather than the build's
// hashed files, which this server doesn't have. A page the build hasn't written, or a
// path no build writes — a designation, which the redirect server answers in
// production — is the not-published page. The shells are the build's templates, not
// pages: there is nothing to client-render.
const PROFILE_PAGE_RE = /^\/(individuals|matrilines|populations|pods|haulouts)\/(\d{1,9})(\/[^/?]*)?\/?(\?.*)?$/;
const PROFILE_FAMILY_RE = /^\/(individuals|matrilines|populations|pods|haulouts)(\/|$)/;

export function devProfilePage(html) {
  return html
    .replace(/<script type="module" crossorigin src="\/assets\/(map-island|site-search)-[^"]+\.js"><\/script>/g,
      '<script type="module" src="/src/$1.ts"></script>')
    .replace(/\s*<link rel="(modulepreload|stylesheet)" crossorigin href="\/assets\/[^"]+">/g, '')
    .replace(/\s*upgrade-insecure-requests;?/g, '');
}

// `fromSource`: in `vite` the islands load from the source; `vite preview` serves the
// build, whose own hashed files the page may name.
export const prerenderedProfiles = ({fromSource}) => function prerenderedProfiles(req, res, next) {
  const url = req.url ?? '';
  if (!PROFILE_FAMILY_RE.test(url)) return next();
  const match = url.match(PROFILE_PAGE_RE);
  const root = process.env.READ_PATH_DIR;
  const file = match && root && realpathOrNull(resolve(root, 'profiles', match[1], `${match[2]}.html`));
  if (!file || !statSync(file).isFile()) {
    req.url = '/not-published.html';
    return next();
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const html = readFileSync(file, 'utf8');
  res.end(fromSource ? devProfilePage(html) : html.replace(/\s*upgrade-insecure-requests;?/g, ''));
};

// The read-path build's files (decision 056), served at /read-path/ from a
// build's export directory when READ_PATH_DIR names one — for developing the
// frontend locally. In production the host serves them.
// A missing file is a real 404, not Vite's SPA fallback: the frontend reads a
// 404 as a day with no sightings, and a 200 of index.html would be a parse error.
function realpathOrNull(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function readPathFiles(req, res, next) {
  const root = process.env.READ_PATH_DIR;
  const prefix = '/read-path/';
  if (!root || !req.url?.startsWith(prefix)) return next();
  const rel = decodeURIComponent(req.url.slice(prefix.length).split('?')[0]);
  // Containment is checked on real paths, so a symlink inside the directory
  // cannot serve a file outside it.
  const file = realpathOrNull(resolve(root, rel));
  if (!file || !file.startsWith(realpathSync(root) + sep) || !statSync(file).isFile()) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(readFileSync(file));
}

/**
 * The map page's first data request, started with the HTML rather than after the
 * scripts have run: the day's file waits on the manifest, so this takes a round trip
 * out of the chain (decision 056).
 */
function preloadReadPathManifest() {
  return {
    name: 'preload-read-path-manifest',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      if (!ctx.path.endsWith('/index.html')) return html;
      return [{tag: 'link', attrs: {rel: 'preload', href: '/read-path/manifest.json', as: 'fetch', crossorigin: true}, injectTo: 'head'}];
    },
  };
}

/**
 * A Brotli copy beside every text file in the build, which Caddy serves to a browser
 * that accepts it (fly/Caddyfile, `precompressed br`). Caddy can't compress Brotli on
 * the fly, so without these CloudFront got gzip, about 17% larger.
 */
function precompressBrotli() {
  let outDir;
  return {
    name: 'precompress-brotli',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      const walk = dir => readdirSync(dir, {withFileTypes: true})
        .flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
      for (const file of walk(outDir)) {
        if (!BROTLI_TYPES.has(extname(file))) continue;
        const raw = readFileSync(file);
        if (raw.length < 1024) continue;
        writeFileSync(`${file}.br`, brotliCompressSync(raw, {params: {[zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: raw.length}}));
      }
    },
  };
}

export default defineConfig({
  assetsInclude: ['**/*.geojson'],

  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about.html'),
        individual: resolve(__dirname, 'individual.html'),
        matriline: resolve(__dirname, 'matriline.html'),
        ecotype: resolve(__dirname, 'ecotype.html'),
        haulout: resolve(__dirname, 'haulout.html'),
        whales: resolve(__dirname, 'whales.html'),
        'not-published': resolve(__dirname, 'not-published.html'),
        'not-in-catalog': resolve(__dirname, 'not-in-catalog.html'),
        // The map on a prerendered profile page, its only script (decision 057).
        // Not an HTML page, so the read-path build finds its files through the
        // manifest below, and writes the tags for them itself.
        'map-island': resolve(__dirname, 'src/map-island.ts'),
        // The search field in the nav (GH #640), an island on every prerendered page.
        'site-search': resolve(__dirname, 'src/site-search.ts'),
      },
      output: {
        // The libraries the pages load up front get chunks of their own, so a deploy
        // that changes only our code leaves them cached: hashed files are served
        // immutable for a year. Left to itself, Rolldown put our read-path.ts into
        // Sentry's chunk and part of OpenLayers into main, so a one-line edit
        // re-downloaded both. Libraries loaded lazily (exifreader, marked) are not
        // listed: a group would pull them into the first load.
        // Split each library by sharing: the modules more than one entry uses, and the
        // ones only the map page's editing tools use. One chunk per library handed the
        // profile pages' map island all of OpenLayers' editing modules, 30 KB they
        // never run (decision 057 keeps those pages light).
        codeSplitting: {groups: [
          {name: vendorChunk, minShareCount: 2, priority: 1},
          {name: id => vendorChunk(id) && `${vendorChunk(id)}-map`},
        ]},
      },
    },

    // dist/.vite/manifest.json: which built files each entry needs.
    manifest: true,

    sourcemap: true
  },

  plugins: [
    {
      // In production Caddy routes these (fly/Caddyfile).
      name: 'profile-pages',
      configureServer(server) {
        server.middlewares.use(prerenderedProfiles({fromSource: true}));
        server.middlewares.use(whalesRewrite);
      },
      configurePreviewServer(server) {
        server.middlewares.use(prerenderedProfiles({fromSource: false}));
        server.middlewares.use(whalesRewrite);
      },
    },
    {
      name: 'read-path-files',
      configureServer(server) {
        server.middlewares.use(readPathFiles);
      },
      configurePreviewServer(server) {
        server.middlewares.use(readPathFiles);
      },
    },
    {
      name: 'release-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'release.json',
          source: JSON.stringify({release: releaseSha()}) + '\n',
        });
      },
    },
    {
      name: 'strip-csp-upgrade-insecure-requests-in-dev',
      apply: 'serve',
      transformIndexHtml(html) {
        return html.replace(/\s*upgrade-insecure-requests;?/g, '');
      },
    },
    {
      // Emit sitemap.xml at build time so <lastmod> tracks the deploy date instead
      // of a hand-maintained constant that silently goes stale. The site rebuilds
      // and redeploys on every push to main, so the build date is an honest
      // freshness signal for the (otherwise static) index.html and about.html shells.
      name: 'generate-sitemap',
      apply: 'build',
      generateBundle() {
        const lastmod = new Date().toISOString().slice(0, 10);
        const pages = [
          { loc: 'https://salishsea.io/', changefreq: 'daily', priority: '1.0' },
          { loc: 'https://salishsea.io/about.html', changefreq: 'monthly', priority: '0.5' },
          { loc: 'https://salishsea.io/whales', changefreq: 'daily', priority: '0.6' },
        ];
        const urls = pages.map(p => `  <url>
    <loc>${p.loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`,
        });
      },
    },
    {
      // Inline the tiny global stylesheet into <style> so it isn't a render-blocking
      // request. CSP allows it (style-src has 'unsafe-inline'). Only touches CSS that
      // has a <link> in index.html (main.css); JS-loaded CSS like OpenLayers' is untouched.
      name: 'inline-critical-css',
      apply: 'build',
      enforce: 'post',
      transformIndexHtml(html, ctx) {
        if (!ctx?.bundle) return html;
        let out = html;
        for (const [fileName, asset] of Object.entries(ctx.bundle)) {
          if (asset.type !== 'asset' || !fileName.endsWith('.css')) continue;
          const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const linkRE = new RegExp(`<link[^>]*href="[^"]*${escaped}"[^>]*>`);
          if (!linkRE.test(out)) continue;
          const css = typeof asset.source === 'string'
            ? asset.source
            : Buffer.from(asset.source).toString('utf8');
          out = out.replace(linkRE, `<style>${css}</style>`);
          delete ctx.bundle[fileName];
        }
        return out;
      },
    },
    preloadReadPathManifest(),
    sentryVitePlugin({
      // The plugin would otherwise write the release into every chunk, which is
      // the per-commit churn release.json exists to avoid. It still names the
      // release it uploads source maps under; debug ids, which are content
      // hashes, are what match them to a chunk.
      release: {inject: false},
      bundleSizeOptimizations: {
        excludeReplayShadowDom: true,
        excludeDebugStatements: true,
        excludeReplayIframe: true,
        excludeReplayWorker: true,
      },
      org: "beam-reach",
      project: "salishsea-io",
    }),
    precompressBrotli(),
  ],

  server: {
    allowedHosts: ['peters-macbook-air.local'],
    port: 3131,
    strictPort: true,
  },
});
