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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
