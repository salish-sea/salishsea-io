/// <reference types="vite/client" />

declare module '*.geojson' {
  import type { FeatureCollection } from 'geojson';
  const value: FeatureCollection;
  export default value;
}

// No VITE_* variables: the build reads none, so strict typing makes a stray
// import.meta.env.VITE_… a type error rather than a silent undefined.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}
