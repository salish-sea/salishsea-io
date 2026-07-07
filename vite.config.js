import { sentryVitePlugin } from "@sentry/vite-plugin";
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Exactly one path segment after /individuals/ — the page's own module/asset
// requests resolve elsewhere and must not be swallowed by the rewrite.
function individualsRewrite(req, _res, next) {
  if (/^\/individuals\/[^/]+\/?(\?.*)?$/.test(req.url ?? '')) req.url = '/individual.html';
  next();
}

export default defineConfig({
  assetsInclude: ['**/*.geojson'],

  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about.html'),
        individual: resolve(__dirname, 'individual.html'),
      }
    },

    sourcemap: true
  },

  plugins: [
    {
      // In production this rewrite lives in the CloudFront viewer-request
      // Lambda@Edge (infra/lib/edge-handler): /individuals/<designation> is a
      // client-rendered page served from the individual.html shell.
      name: 'individuals-rewrite',
      configureServer(server) {
        server.middlewares.use(individualsRewrite);
      },
      configurePreviewServer(server) {
        server.middlewares.use(individualsRewrite);
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
    sentryVitePlugin({
      bundleSizeOptimizations: {
        excludeReplayShadowDom: true,
        excludeDebugStatements: true,
        excludeReplayIframe: true,
        excludeReplayWorker: true,
      },
      org: "beam-reach",
      project: "salishsea-io",
    }),
  ],

  server: {
    allowedHosts: ['peters-macbook-air.local'],
    port: 3131,
    strictPort: true,
  },
});
