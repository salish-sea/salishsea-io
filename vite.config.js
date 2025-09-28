import { sentryVitePlugin } from "@sentry/vite-plugin";
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        auth_redirect: resolve(__dirname, 'auth_redirect.html'),
      }
    },

    sourcemap: true
  },

  plugins: [sentryVitePlugin({
    bundleSizeOptimizations: {
      excludeReplayShadowDom: true,
      excludeDebugStatements: true,
      excludeReplayIframe: true,
      excludeReplayWorker: true,
    },
    org: "beam-reach",
    project: "salishsea-io",
    sendDefaultPii: true,
  })],

  server: {
    allowedHosts: ['peters-macbook-air.local'],
    port: 3131,
    strictPort: true,
  },
});
