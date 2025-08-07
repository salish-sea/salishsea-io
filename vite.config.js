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
    org: "beam-reach",
    project: "salishsea-io"
  })],

  server: {
    allowedHosts: ['peters-macbook-air.local'],
  },
});
