# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**Geospatial Data:**
- Orcasound API - Hydrophone feeds for listening locations
  - Endpoint: `https://live.orcasound.net/api/json/feeds`
  - SDK/Client: Fetch API (native)
  - Purpose: Fetch live hydrophone feed data with coordinates
  - Usage: `src/fetch-hydrophones.ts`

- Google Maps KML Export - Public maps for viewing locations
  - Endpoint: `https://www.google.com/maps/d/kml?forcekml=1&mid=1xIsepZY5h_8oA2nd6IwJN-Y7lhk`
  - SDK/Client: Fetch API with XMLParser
  - Purpose: Fetch whale viewing locations from shared Google Map
  - Usage: `src/fetch-viewing-locations.ts`

## Data Storage

**Databases:**
- Supabase PostgreSQL
  - Connection: `VITE_SUPABASE_URL` (client-side)
  - Client: `@supabase/supabase-js` 2.92.0
  - Database types: Auto-generated to `database.types.ts`
  - Tables: contributors, contributor_email_addresses, observation_photos, observations
  - Views: occurrences (materialized view with joined photo/taxon data)
  - Functions: upsert_observation (RPC endpoint)
  - Enums: license, travel_direction
  - Composite Types: lat_lng, lon_lat, taxon

**File Storage:**
- Supabase Storage - Media bucket
  - Bucket name: `media`
  - Access: Private with signed URLs via public getPublicUrl()
  - Organization: `{userId}/{sightingId}/{filename}` path structure
  - Usage: Photo uploads in `src/photo-attachment.ts`
  - Cache control: 3 days (max-age=259200)

**Caching:**
- Browser cache only - No Redis or memcached configured
- HTTP Cache-Control headers via Supabase Storage

## Authentication & Identity

**Auth Provider:**
- Google OAuth 2.0 via Google Sign-In (gsi)
  - Client ID: `129212631591-b6ba75aevcbifjpea2cap2vja91a6te8.apps.googleusercontent.com`
  - Script: `https://accounts.google.com/gsi/client`
  - Implementation: Google Sign-In One Tap UI in `index.html`
  - Token handling: ID token sent to Supabase

- Supabase Auth
  - Provider: `@supabase/auth-js` 2.92.0
  - Method: `signInWithIdToken()` for Google provider
  - Session management: Supabase-managed
  - User type: Exported from `src/identity.ts`
  - Usage: All authenticated operations via `supabase().auth.getUser()`

**User Profile:**
- Stored in `contributors` table
  - Fields: id, name, picture (nullable), editor flag, entity_id
  - Email addresses in separate `contributor_email_addresses` table

## Monitoring & Observability

**Error Tracking:**
- Sentry (Beam Reach organization)
  - DSN: `https://56ce99ce80994bab79dab62d06078c97@o4509634382331904.ingest.us.sentry.io/4509634387509248`
  - Organization: beam-reach
  - Project: salishsea-io
  - SDK: `@sentry/browser` 10.38.0
  - Integration: `@supabase/sentry-js-integration` 0.3.0
  - Configuration in: `src/sentry.ts`

**Sentry Integrations:**
- browserTracingIntegration - Performance monitoring (excludes Supabase /rest calls)
- breadcrumbsIntegration - User action tracking
- feedbackIntegration - In-app bug report form
- globalHandlersIntegration - Window error/rejection handlers
- linkedErrorsIntegration - Error chain context
- dedupeIntegration - Duplicate event prevention
- supabaseIntegration - Supabase operation tracing with options:
  - tracing: enabled
  - breadcrumbs: enabled
  - errors: enabled

**Logs:**
- Console-based only (console.debug, console.info)
- Sentry breadcrumbs capture user actions and errors

## CI/CD & Deployment

**Hosting:**
- AWS (Deployment)
  - Region: us-west-2
  - Account ID: 648183724555
  - Infrastructure: AWS CDK-managed (empty stack template at present)
  - Type: Static site hosting (S3 + CloudFront recommended based on architecture)

**CI Pipeline:**
- None configured - Manual deployment via AWS CDK
- Build command: `npm run build` triggers:
  1. TypeScript compilation (`tsc`)
  2. Vite bundling (`vite build`)
  3. HTML validation (`html-validate dist/**/*.html`)
  4. CSP hash verification

**Deployment Artifacts:**
- Infrastructure code: `infra/` directory (AWS CDK TypeScript)
- Built assets: `dist/` directory
- Source maps uploaded to Sentry via Vite plugin

## Environment Configuration

**Required env vars:**
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_KEY` - Supabase anonymous public key
- `VITE_BASE_URL` - Application base URL (optional, referenced in CSP)

**Secrets location:**
- Not detected - Environment variables managed externally
- Vite env file pattern: `.env`, `.env.local`, `.env.{mode}`, `.env.{mode}.local`
- Note: `index.html` contains hardcoded Google OAuth Client ID (public credential, not secret)

**Build Secrets:**
- Sentry DSN - Hardcoded in source (`src/sentry.ts`) - organization/project IDs are public
- Google OAuth Client ID - Hardcoded in HTML (public credential by design)

## Data Flows

**Sighting Submission:**
1. User signs in via Google OAuth in `index.html`
2. ID token received by `index.html` -> passed to `salish-sea.ts`
3. Supabase authenticates user with Google token
4. User submits observation form
5. Photos uploaded to Supabase Storage (`src/photo-attachment.ts`)
6. Observation record inserted to `observations` table via `upsert_observation` RPC
7. Photos linked via `observation_photos` table

**Map Data Loading:**
1. Initial load: Fetch hydrophones from Orcasound API
2. Initial load: Fetch viewing locations from Google Maps KML
3. Runtime: Query `occurrences` view from Supabase for whale sightings
4. Display: Render on OpenLayers map (`src/obs-map.ts`)

**Error Tracking:**
1. Client errors -> Captured by Sentry
2. Supabase operations -> Traced via `supabaseIntegration`
3. Performance metrics -> Captured by `browserTracingIntegration`
4. User feedback -> Collected via Sentry feedback widget

## Webhooks & Callbacks

**Incoming:**
- Google OAuth callback - Handled in `index.html` via `handleSignInWithGoogle` global function
  - Credential received -> Queued in `__pendingGSIResponses` if component not ready
  - Passed to `salish-sea` element when mounted

**Outgoing:**
- None detected - Application is read-only from backend perspective
- All writes go through Supabase client SDK authenticated calls

## Third-Party Services Summary

| Service | Type | Auth | Status |
|---------|------|------|--------|
| Supabase | Database + Auth | Key-based | Required |
| Google OAuth | Authentication | Public Client ID | Required |
| Google Maps | Data source | Public API | Optional (viewing locations) |
| Orcasound API | Data source | Public API | Optional (hydrophone feeds) |
| Sentry | Monitoring | DSN | Recommended |

---

*Integration audit: 2026-02-26*
