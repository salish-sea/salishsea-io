# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Web Components (Lit) + Map Visualization + Database-Driven Observation Portal

**Key Characteristics:**
- Component-based architecture using Lit web components with TypeScript
- Client-side reactive UI with state managed through Lit decorators and context providers
- MapServer integration via OpenLayers for interactive mapping and data visualization
- Supabase backend for authentication, data storage, and file uploads
- Functional composition for data transformation and segment analysis
- Context-based dependency injection for cross-component communication

## Layers

**Presentation Layer:**
- Purpose: Render UI and handle user interactions
- Location: `src/` (*.ts files defining Lit components)
- Contains: Web components (`salish-sea.ts`, `obs-map.ts`, `obs-panel.ts`, `obs-summary.ts`, `sighting-form.ts`, `login-button.ts`, `photo-attachment.ts`)
- Depends on: Data layer (types, identity, occurrence), utilities, styling
- Used by: Browser/HTML entry point (`index.html`)

**Map/Geospatial Layer:**
- Purpose: Handle map rendering, interactions, and spatial feature visualization
- Location: `src/obs-map.ts`, `src/style.ts`, `src/segments.ts`
- Contains: OpenLayers configuration, layer management, styling logic, travel line imputation
- Depends on: Data types, occurrence transformations, Turf.js for distance calculations
- Used by: Presentation layer components

**Business Logic Layer:**
- Purpose: Transform raw observations into displayable segments, handle identification detection
- Location: `src/segments.ts`, `src/identifiers.ts`, `src/direction.ts`
- Contains: Segment imputation (connecting related observations), individual/pod detection
- Depends on: Types, constants (species travel speeds)
- Used by: Map layer and presentation layer

**Data Access Layer:**
- Purpose: Query and mutate database, manage authentication, handle file uploads
- Location: `src/supabase.ts`, `src/identity.ts`, `src/occurrence.ts`, `src/photo-attachment.ts`
- Contains: Supabase client initialization, auth state management, occurrence queries, contributor lookups
- Depends on: Types (PatchedDatabase schema), environment variables
- Used by: Presentation and state management components

**Type/Contract Layer:**
- Purpose: Define TypeScript interfaces for type safety across layers
- Location: `src/types.ts`
- Contains: Occurrence, Contributor, License, TravelDirection, OccurrencePhoto types derived from Supabase schema
- Depends on: `database.types.ts` (auto-generated from Supabase)
- Used by: All other layers

## Data Flow

**Load Observations by Date:**

1. User changes date selector in `obs-panel.ts` or via URL parameters
2. `salish-sea.ts` catches 'date-selected' event and sets new date property
3. `salish-sea.ts.fetchOccurrences()` queries Supabase for observations matching date range (start of day to end of day PST8PDT)
4. Query returns array of `Occurrence` records with location, taxon, photos, identifiers
5. `receiveOccurrences()` updates internal sightings state and calls `obs-map.setOccurrences()`
6. `obs-map.ts` transforms Occurrence[] → Segment[] via `occurrences2segments()` (groups related observations by species and time)
7. Each Segment generates Feature objects (points) and travel lines (LineString)
8. Features added to OpenLayers Vector layers with styling based on occurrence properties
9. UI updates to show occurrences in both map and summary list

**Submit Observation (Sighting):**

1. User fills form in `sighting-form.ts` with species, location, time, photos
2. Photos optionally read EXIF metadata via `readExif()` for coordinates/date
3. Photos uploaded to Supabase storage via `uploadPhoto()` generating public URLs
4. Form submitted calls `supabase().from('occurrences').insert()`
5. 'sighting-saved' event dispatched with new Occurrence
6. `salish-sea.ts` focuses on new occurrence and refreshes observations for that date
7. Map and panel update with new sighting

**Focus/Select Occurrence:**

1. User clicks observation on map or in summary list
2. Fires 'focus-occurrence' event with Occurrence detail
3. `salish-sea.ts` updates focusedOccurrenceId and date
4. Query params updated to preserve state in URL (o=id param)
5. Map highlights selected feature with selectedObservationStyle
6. Panel scrolls to focused obs-summary element

**Map Navigation:**

1. User pans/zooms map via OpenLayers interactions
2. 'map-move' event fired with center and zoom
3. Debounced (500ms) update to URL query params (x, y, z)
4. Browser history updated so back/forward restores map position

**State Management:**

- Authentication state: managed by Supabase.auth.onAuthStateChange() → triggers user/contributor updates
- Date selection: reflected in component property and URL param (d=YYYY-MM-DD)
- Map position: stored in URL and component state (x, y, z)
- Focused occurrence: tracked as focusedOccurrenceId and URL param (o=id)
- Form state: managed by TanStackForm with localStorage persistence for license choice and taxon selection

## Key Abstractions

**Occurrence:**
- Purpose: Represents a single wildlife observation with location, time, species, photos
- Examples: `src/types.ts`, `src/occurrence.ts`
- Pattern: Type-safe wrapper around Supabase database row with computed fields (observed_at_ms, isFirst, isLast)

**Segment:**
- Purpose: Groups chronologically related observations of same species into travel chains
- Examples: `src/segments.ts`
- Pattern: Functional transformation using time/distance heuristics; imputes expected travel speeds for species

**Feature (OpenLayers):**
- Purpose: Wraps Occurrence data into geometric objects for rendering on map
- Examples: `src/occurrence.ts`, `src/segments.ts`
- Pattern: occurrence2feature converts Occurrence to Point Feature; segment2features and segment2travelLine generate features from segments

**Context (Lit):**
- Purpose: Inject dependencies across component tree without prop drilling
- Examples: `userContext`, `contributorContext`, `mapContext`, `drawingSourceContext` in `src/identity.ts`, `src/map-context.ts`, `src/drawing-context.ts`
- Pattern: @provide/@consume decorators from @lit/context

**Style (OpenLayers):**
- Purpose: Define visual rendering rules for occurrence features based on properties (time, species, direction, selection state)
- Examples: `src/style.ts`
- Pattern: Functions returning OpenLayers Style objects computed from feature properties

## Entry Points

**HTML Entry Point:**
- Location: `index.html`
- Triggers: Browser loads page
- Responsibilities: Sets up CSP headers, initializes Google Sign-In, imports main component

**Main Component:**
- Location: `src/salish-sea.ts` (customElement 'salish-sea')
- Triggers: Vite loads `src/salish-sea.ts` as module entry
- Responsibilities: Root component that orchestrates map, panel, authentication, state management, event delegation

**Map Component:**
- Location: `src/obs-map.ts` (customElement 'obs-map')
- Triggers: Rendered by salish-sea
- Responsibilities: Initializes OpenLayers map, manages layers/interactions, renders features, emits map-move events

**Panel Component:**
- Location: `src/obs-panel.ts` (customElement 'obs-panel')
- Triggers: Rendered by salish-sea
- Responsibilities: Displays observation summaries, handles date selection, renders sighting form in edit mode

## Error Handling

**Strategy:** Async/await with try-catch at component boundaries; Sentry integration for production error tracking

**Patterns:**
- `supabase().throwOnError()` terminates promise chain on database errors
- Photo upload failures caught in `photo-attachment.ts` with user-visible error state
- Sentry client initialized in production mode via `src/sentry.ts` with Supabase integration for DB error tracking
- Console.error logs fallback for auth and data fetch failures
- Form validation errors handled by TanStackForm with field-level error messages

## Cross-Cutting Concerns

**Logging:** Sentry client with browserTracingIntegration for performance monitoring; console.error for development

**Validation:**
- URL parameter validation in `salish-sea.ts.parseUrlParams()` with regex and extent checking
- Photo license choice persisted to localStorage with default fallback
- Zod used implicitly through types (no explicit runtime validation of user input)

**Authentication:**
- Google Sign-In via GSI (Google Sign-In) with credential callbacks
- Supabase auth session management with onAuthStateChange listener
- Contributor lookup via user_contributor junction table on auth state change
- Edit permissions checked via `occurrence.canEdit()` comparing contributor_id or editor flag

**Styling:** Global CSS in `src/index.css`; component styles via Lit's static styles; OpenLayers styles defined in `src/style.ts`

---

*Architecture analysis: 2026-02-26*
