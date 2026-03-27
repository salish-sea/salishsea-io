import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
    test: {
        // mode defines what ".env.{mode}" file to choose if exists
        env: loadEnv(mode, process.cwd(), ''),
        exclude: ['e2e/**', 'infra/**', 'node_modules/**'],
    },
}));
