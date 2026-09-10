/// <reference types="vite/client" />

declare module '*.geojson' {
  import type { FeatureCollection } from 'geojson';
  const value: FeatureCollection;
  export default value;
}

interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_BASE_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * The commit this bundle was built from, injected by vite.config.js.
 *
 * Sentry's plugin already works one out for its own events, but feedback must
 * not depend on Sentry — that dependency is the thing decision 039 removes —
 * so the release is defined independently. 'unknown' outside a git checkout.
 */
declare const __RELEASE__: string;
