# Codebase Concerns

**Analysis Date:** 2026-02-26

## Tech Debt

**Large form component needing refactoring:**
- Issue: `sighting-form.ts` is 816 lines, handling form state, photo uploads, coordinate parsing, field validation, and Supabase operations all in one component
- Files: `src/sighting-form.ts`
- Impact: Difficult to test, maintain, and modify; mixing presentation logic with data operations
- Fix approach: Extract TanStack form setup into separate hook/controller, photo upload logic into service, coordinate parsing into utility, Supabase operations into data layer

**Unmaintained ArcGIS map source:**
- Issue: Comment in code explicitly notes unmaintained source
- Files: `src/obs-map.ts` (line 121-122)
- Impact: Map reference layer may become unavailable or degraded without notice; no fallback if service fails
- Fix approach: Identify maintained alternative XYZ tile source or implement service degradation with fallback layer

**Type unsafe Supabase RPC calls:**
- Issue: Using `as any` type cast for RPC function parameters and responses
- Files: `src/sighting-form.ts` (line 146)
- Impact: Runtime type mismatches could occur; IDE will not catch schema changes; difficult to refactor when database schema changes
- Fix approach: Generate and use proper TypeScript types for RPC functions via `supabase gen types` command

**DOM purification with type safety issue:**
- Issue: Creating DOMPurify with `window as any` cast
- Files: `src/obs-summary.ts` (line 18)
- Impact: Type checking bypassed, potential security implications if initialization changes
- Fix approach: Import proper type definitions for window or use type-safe window context

## Known Bugs

**String error thrown instead of Error object:**
- Bug: Event handler throws string literal instead of Error instance
- Files: `src/salish-sea.ts` (line 228)
- Trigger: User creates event with invalid CustomEvent data structure; `instanceof CustomEvent` check fails
- Impact: Error handling code that expects Error objects will not work correctly; error message won't have stack trace
- Workaround: Current code throws `"oh no"` - will still propagate but less informative than Error instance

## Security Considerations

**Unvalidated coordinate input:**
- Risk: User-provided coordinates parsed via `geo-coordinates-parser` library without bounds validation before sending to database
- Files: `src/sighting-form.ts` (lines 130-135)
- Current mitigation: Bounds validation exists but error message is wrong (line 135 says "latitude" when checking longitude)
- Recommendations: Fix validation error messages; add database-level constraints; validate coordinates are on water (not land)

**Photo upload path traversal consideration:**
- Risk: File names from user uploads are included in storage path
- Files: `src/photo-attachment.ts` (line 48)
- Current mitigation: Regex strips suspicious characters `replace(/[^-a-z0-9\._]/gi, '_')`
- Recommendations: Use UUID-only filenames instead of sanitizing user input; validate file MIME types; set upload size limits

**Exif data exposure:**
- Risk: Photo EXIF data (which may contain location, device info) is extracted and potentially stored
- Files: `src/photo-attachment.ts` (lines 15-29)
- Current mitigation: Only latitude/longitude extracted and used for feature location
- Recommendations: Explicitly strip EXIF data before upload; inform users about EXIF data collection; provide option to remove EXIF

**Supabase auth token handling:**
- Risk: Auth token stored in localStorage and used for API calls
- Files: `src/identity.ts`, `src/supabase.ts`
- Current mitigation: Supabase client library handles token management
- Recommendations: Ensure HttpOnly cookies configured on Supabase if available; audit localStorage usage; implement logout on tab close

## Performance Bottlenecks

**Inefficient occurrence segment imputation:**
- Problem: `imputeSegmentFrom()` has O(n²) complexity when matching occurrences to create segments
- Files: `src/segments.ts` (lines 53-82)
- Cause: For each candidate, function iterates through candidates list; algorithm filters candidates in place without indexing
- Improvement path: Use spatial indexing (R-tree) to find nearby candidates; pre-filter by time window before distance calculation

**Unoptimized map layer rendering:**
- Problem: Travel style function recalculates imputed positions on every zoom level change
- Files: `src/style.ts` (lines 176-202)
- Cause: `travelStyle()` recalculates opacity, circles, and text positions every time resolution changes
- Improvement path: Cache calculated styles per zoom level; debounce resolution changes; move circle calculations to feature properties

**Debounced map updates could lose final state:**
- Problem: Map position update debounce uses 500ms timeout which could expire during navigation
- Files: `src/salish-sea.ts` (lines 247-250)
- Cause: User rapid navigation followed by page close could lose final map position
- Improvement path: Flush pending updates on window unload; use `visibilitychange` event to force updates

## Fragile Areas

**Coordinate system transformations:**
- Files: Multiple imports of `fromLonLat` and `toLonLat` from OpenLayers
- Why fragile: Projection mismatches silently produce wrong map positions; no validation that coordinates are in expected format
- Safe modification: Centralize projection code in utility functions; add assertions that validate coordinate ranges after transformation
- Test coverage: Limited test coverage on projection-dependent code; `segments.test.ts` focuses on distance logic not coordinate transforms

**Occurrence data structure assumptions:**
- Files: `src/occurrence.ts`, `src/segments.ts`, `src/style.ts`
- Why fragile: Code assumes `occurrence.location` always has `lat`/`lon` properties; assumes `observed_at_ms` exists and is numeric
- Safe modification: Use TypeScript type guards; add runtime validation; fail fast with descriptive errors
- Test coverage: No tests for invalid occurrence structures; property access not guarded

**Edit state management:**
- Files: `src/obs-panel.ts`, `src/sighting-form.ts`
- Why fragile: Form visibility and data state separated; no single source of truth for "which observation is being edited"
- Safe modification: Consolidate edit state to single observable; use reactive patterns to sync form visibility with data
- Test coverage: No integration tests for form visibility transitions

**Error handling in async chains:**
- Files: `src/salish-sea.ts` (lines 210-214)
- Why fragile: Promise chain with `.then()` doesn't handle intermediate failures; if `getContributor()` fails, `fetchLastOwnOccurrence()` won't run but no error is logged
- Safe modification: Use async/await with try/catch blocks; add comprehensive error logging
- Test coverage: No tests for auth state change error scenarios

## Scaling Limits

**Fixed tile server URLs:**
- Current capacity: Two ArcGIS base map tile URLs hardcoded
- Limit: If either service becomes unavailable, map degradation occurs with no fallback
- Scaling path: Implement tile layer fallback system; consider using tile service with better SLA; add monitoring for tile service health

**Single Supabase project dependency:**
- Current capacity: All data operations go through single Supabase instance
- Limit: No geographic redundancy; database connection pooling not configured
- Scaling path: Implement read replicas if available; add connection retry logic with exponential backoff; use data caching layer

**Client-side segment imputation:**
- Current capacity: Segments calculated in browser for all occurrences in view
- Limit: With large occurrence datasets (>1000 per day), browser performance degrades
- Scaling path: Move segment imputation to database or serverless function; implement pagination/windowing for occurrence data

## Dependencies at Risk

**temporal-polyfill as production dependency:**
- Risk: Temporal API is not yet standardized; polyfill may have breaking changes or maintenance gaps
- Impact: Date/time handling throughout codebase depends on unstable library; major version bump could break date parsing
- Migration plan: Pin version strictly; create abstraction layer for date operations; monitor Temporal proposal status; plan migration to native Temporal when standardized

**@tanstack/lit-form v1 with early adoption:**
- Risk: TanStack Form Lit integration is relatively new; may have undiscovered bugs or API changes
- Impact: Form handling is complex; breaking changes would require significant refactoring
- Migration plan: Monitor releases; add integration tests for form behavior; evaluate alternatives (Lit native form libraries)

## Missing Critical Features

**No pagination for occurrence data:**
- Problem: All occurrences for a date loaded into memory; no limit on query size
- Blocks: Cannot efficiently handle dates with hundreds or thousands of observations
- Recommendation: Implement viewport-based lazy loading or date-range chunking

**No offline mode:**
- Problem: App requires continuous connectivity; no service worker or local caching
- Blocks: Users cannot view previously loaded observations if connection drops
- Recommendation: Implement service worker with cache-first strategy for map tiles and observation data

**No undo/redo for observation edits:**
- Problem: Form state not tracked; users cannot undo accidental changes before submission
- Blocks: Data integrity issues; users must manually re-enter complex observation data on mistakes
- Recommendation: Implement command pattern or transaction-based editing

## Test Coverage Gaps

**Map rendering and styling untested:**
- What's not tested: OpenLayers layer configuration, style function outputs, map interactions
- Files: `src/obs-map.ts`, `src/style.ts`
- Risk: Refactoring style functions could break map rendering silently; projection changes could go unnoticed
- Priority: High - visual regressions are user-visible and hard to debug

**Form submission flow untested:**
- What's not tested: Full form submission including validation, photo uploads, database saves
- Files: `src/sighting-form.ts`
- Risk: Form errors won't be caught until manual testing; validation changes could allow invalid data
- Priority: High - form is core user-facing feature

**Authentication state transitions untested:**
- What's not tested: Login/logout flow, auth state change event handling, contributor fetching
- Files: `src/salish-sea.ts`, `src/identity.ts`
- Risk: Auth bugs could block user access; credential handling issues won't be caught
- Priority: High - security and access control critical

**Error scenarios untested:**
- What's not tested: Network failures, API errors, invalid data from database, Supabase operation failures
- Files: All async operations
- Risk: Error paths execute only in production; users could see generic or confusing error messages
- Priority: Medium - impacts user experience during failures

---

*Concerns audit: 2026-02-26*
