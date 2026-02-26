# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- TypeScript 5.9.3 - Full codebase including frontend and infrastructure
- JavaScript (Module) - Vite build system and tooling scripts

**Secondary:**
- YAML - ESLint configuration (`.eslintrc.yml`)
- JSON - Configuration files and type definitions

## Runtime

**Environment:**
- Node.js ^24.10 (currently 24.13 per `.nvmrc`)

**Package Manager:**
- npm - Primary package manager with lockfile present (`package-lock.json`)

## Frameworks

**Core:**
- Lit 3.3.2 - Web components framework for UI
- Vite 7.3.1 - Build tool and dev server (port 3131)
- Vitest 4.0.18 - Testing framework with watch mode support

**Build/Dev:**
- @sentry/vite-plugin 4.8.0 - Error tracking integration plugin
- html-validate 10.7.0 - HTML validation for built artifacts
- TypeScript compiler - Strict mode with experimental decorators enabled

**Infrastructure:**
- AWS CDK 2.215.0 - Infrastructure as Code for AWS deployment
- ts-node 10.9.2 - TypeScript execution for Node scripts

## Key Dependencies

**Critical:**
- @supabase/supabase-js 2.92.0 - PostgreSQL database and auth client
- @supabase/auth-js 2.92.0 - Authentication module extracted from main SDK
- @sentry/browser 10.38.0 - Error tracking and monitoring in browser

**Maps & Geospatial:**
- ol (OpenLayers) 10.7.0 - Interactive map rendering
- @turf/bearing 7.3.3 - Bearing calculation utilities
- @turf/distance 7.3.3 - Distance calculation utilities
- @turf/helpers 7.2.0 - GeoJSON feature helpers
- geo-coordinates-parser 1.7.4 - Coordinate parsing

**Form Handling:**
- @tanstack/lit-form 1.23.21 - Type-safe form management for Lit components
- zod 4.3.6 - Schema validation and runtime type checking

**UI & Media:**
- marked 17.0.2 - Markdown parsing
- dompurify 3.3.1 - HTML sanitization
- exifreader 4.36.0 - EXIF metadata extraction from photos
- fast-xml-parser 5.3.5 - XML parsing for KML/Maps data

**Utilities:**
- uuid 13.0.0 - UUID generation for file paths and identifiers
- @formatjs/intl-datetimeformat 7.2.0 - Date/time formatting
- temporal-polyfill 0.3 - Temporal API polyfill
- @lit/context 1.1.6 - Context provider for Lit components
- @lit/task 1.0.3 - Task management for async operations

**Supabase Integration:**
- @supabase/sentry-js-integration 0.3.0 - Bridge between Supabase and Sentry

## Configuration

**Environment:**
- Vite env variables: `VITE_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`
- Configured via `import.meta.env` pattern (client-side only, VITE_ prefix required)
- Mode-dependent .env files supported by Vitest

**Build:**
- `vite.config.js` - Main build configuration with Sentry plugin
- `vitest.config.ts` - Test runner configuration
- `tsconfig.json` - TypeScript compiler options with:
  - Target: ES2023
  - Strict mode enabled
  - noUnusedLocals/noUnusedParameters enforcement
  - experimentalDecorators support
  - Bundler mode with isolatedModules

**Development:**
- `.nvmrc` - Node version pinning (24.13)
- `.editorconfig` - Cross-editor configuration
- `.vscode/` - VS Code workspace settings

## Platform Requirements

**Development:**
- Node.js >= 24.10
- npm or compatible package manager
- Supabase account with project credentials
- Google OAuth application credentials
- Sentry project for error tracking

**Production:**
- AWS account (Deployment target: us-west-2, Account: 648183724555)
- Supabase PostgreSQL database instance
- Supabase Storage bucket for media uploads
- Sentry DSN configured (Org: beam-reach, Project: salishsea-io)
- Google OAuth setup for authentication

**Browser Requirements:**
- Modern browsers supporting ES2023 (Safari, Chrome, Firefox, Edge)
- WebGL support for interactive maps
- Web Workers support
- Fetch API

## Build Artifacts

**Output:**
- `dist/` directory with bundled assets
- Source maps enabled for production debugging
- HTML validation performed on output
- CSP inline hash verification (`bin/verify-csp-inline-hash.mjs`)

**Optimization:**
- Tree-shaking via Vite rollup
- Source maps for debugging production issues
- Sentry source map uploads via Vite plugin

---

*Stack analysis: 2026-02-26*
