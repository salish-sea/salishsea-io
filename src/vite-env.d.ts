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
  /** Where logged-out reads come from: `supabase` (default) or `static` (decision 056). */
  readonly VITE_READ_SOURCE?: string;
  readonly VITE_WRITE_SOURCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
