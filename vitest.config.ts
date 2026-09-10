import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
    // vite.config.js derives this from git for the real bundle; the test run
    // has no build, so name it for what it is rather than shipping a fallback
    // inside the component just to keep tests happy.
    define: {
        __RELEASE__: JSON.stringify('test'),
    },
    test: {
        // mode defines what ".env.{mode}" file to choose if exists
        env: loadEnv(mode, process.cwd(), ''),
        exclude: ['e2e/**', 'infra/**', 'node_modules/**'],
    },
}));
