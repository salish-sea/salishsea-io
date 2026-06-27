import { sentryVitePlugin } from "@sentry/vite-plugin";
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  assetsInclude: ['**/*.geojson'],

  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      }
    },

    sourcemap: true
  },

  plugins: [
    {
      name: 'strip-csp-upgrade-insecure-requests-in-dev',
      apply: 'serve',
      transformIndexHtml(html) {
        return html.replace(/\s*upgrade-insecure-requests;?/g, '');
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
