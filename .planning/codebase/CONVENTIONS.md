# Coding Conventions

**Analysis Date:** 2026-02-26

## Naming Patterns

**Files:**
- Kebab case for typescript files: `user-location-control.ts`, `sighting-form.ts`, `photo-attachment.ts`, `drawing-context.ts`
- Test files use `.test.ts` suffix: `identifiers.test.ts`, `segments.test.ts`, `constants.test.ts`

**Functions:**
- Camel case for function names: `detectIndividuals()`, `occurrences2segments()`, `compactMap()`, `fetchLastOwnOccurrence()`
- Descriptive verb-noun pattern: `detectPod()`, `segment2features()`, `canEdit()`, `occurrence2feature()`
- Helper/internal functions may use simple names: `coord()`, `normalizeIndividual()`, `imputeSegmentFrom()`

**Variables:**
- Camel case for variables and parameters: `lat`, `lon`, `meanTravelSpeed`, `expectedTravelSpeedKmph`
- Const declarations for immutable values: `const hour_in_ms = 60 * 60 * 1000;`
- Descriptive names preferred: `placed` (Set), `segments` (array), `occurrences` (array)
- Temporary/loop variables use short names: `i`, `t`, `u`, `idx`

**Types:**
- PascalCase for type names: `Occurrence`, `Segment`, `Contributor`, `License`, `OccurrencePhoto`
- Suffix `Data` for form/data transfer objects: `SightingFormData`
- Suffix `Event` for custom events: `CloneSightingEvent`, `EditSightingEvent`
- Suffix `Options` for object configuration: `TAXON_OPTIONS`, `DIRECTION_OPTIONS`

**Constants:**
- ALL_CAPS_SNAKE_CASE for module-level constants: `PHOTO_LICENSE_CHOICE_STORAGE_KEY`, `TAXON_CHOICE_STORAGE_KEY`, `TAXON_OPTIONS`, `DIRECTION_OPTIONS`
- Descriptive plural names for collections: `licenseCodes`, `travelSpeedKmH`

## Code Style

**Formatting:**
- ESLint with YAML configuration: `.eslintrc.yml`
- 2-space indentation (enforced by ESLint)
- No trailing spaces (enforced)
- End-of-file newline required (eol-last: error)
- TypeScript strict mode enabled

**Linting:**
- Rule: `eqeqeq: [error, allow-null]` - Strict equality except for null checks
- Rule: `indent: [error, 2, { MemberExpression: "off", SwitchCase: 1 }]` - 2-space indent, flexible member expressions
- Rule: `no-unused-vars: [error, { vars: all, args: none, ignoreRestSiblings: true }]` - No unused variables but args can be unused
- No prettier config - formatting via ESLint only

**TypeScript Strict Mode:**
- `strict: true` - Full strict mode enabled
- `noUnusedLocals: true` - All local variables must be used
- `noUnusedParameters: true` - All parameters must be used (no underscore escape)
- `noFallthroughCasesInSwitch: true` - Switch cases must have break/return
- `noUncheckedSideEffectImports: true` - Side-effect imports flagged
- `noUncheckedIndexedAccess: true` - Array/object access requires null checks
- `target: ES2023` - Modern JavaScript features available

## Import Organization

**Order:**
1. Node.js built-ins (e.g., `import fs from 'node:fs'`)
2. Third-party packages (e.g., `import { expect, test } from 'vitest'`)
3. Local imports (e.g., `import { detectIndividuals } from './identifiers.ts'`)

**Path Aliases:**
- No path aliases configured - all imports use relative paths starting with `./`
- Local imports always include `.ts` extension: `import type { Occurrence } from "./types.ts";`
- Type imports use `import type` when appropriate: `import type { Coordinate } from "ol/coordinate.js";`

**Module Imports:**
- Prefer named exports over default exports
- Re-export types from `database.types.ts` for database-generated types
- Use destructuring for selective imports: `import { css, html, LitElement } from "lit";`

## Error Handling

**Patterns:**
- `throw new Error()` with descriptive messages for fatal errors
- Include context in error messages: `throw new Error(\`Occurrence ${occurrence.id} missing location: ${JSON.stringify(occurrence.location)}\`)`
- Supabase errors unwrapped and thrown: `if (error) throw new Error(\`Couldn't fetch last occurrence: ${error.message || JSON.stringify(error)}\`);`
- Type guards for validation: `if (!lon || !lat) throw new Error(...)`
- Null/undefined coalescing with fallback values
- No try-catch blocks in observed code - errors propagate

## Logging

**Framework:** `console` methods only

**Patterns:**
- `console.debug()` for diagnostic information
- `console.info()` for informational messages
- No systematic logging framework - direct console usage

## Comments

**When to Comment:**
- Comments describe *why* code works a certain way, not *what* it does (code is self-documenting)
- URL references for external context: `// https://github.com/salish-sea/acartia/wiki/...`
- Preconditions noted before complex functions: `// Precondition: candidates all occur after start.`
- Intent clarification for non-obvious logic: `// How many radians to rotate a thing that was pointing east...`

**JSDoc/TSDoc:**
- Minimal JSDoc usage observed
- One-line JSDoc for type documentation: `/**\n *  [minx, miny, maxx, maxy]\n */`
- No parameter/return documentation in observed code

## Function Design

**Size:** Functions are typically small and focused (10-50 lines). Larger functions contain algorithmic logic (e.g., `imputeSegmentFrom` at ~30 lines)

**Parameters:**
- Prefer named parameters over positional when 2+ parameters
- Destructuring for object parameters: `export function occurrence2feature(occurrence: Occurrence): Feature<Point>`
- Type annotations always included
- `readonly` modifier used for immutable parameters: `detectPod(text: Readonly<string>)`

**Return Values:**
- Explicit return types always specified: `: Feature<Point>`
- Nullable returns indicated with `| null`: `fetchLastOwnOccurrence(...): Promise<Occurrence | null>`
- Union types for multiple possibilities: `Segment | null`
- Generic return types with proper constraints: `compactMap<T, U>(...): U[]`

## Module Design

**Exports:**
- Named exports preferred over default exports
- Type exports use `export type`: `export type Occurrence = ...`
- Constant exports at module level: `export const detectIndividuals = (text: Readonly<string>) => { ... }`
- Mix of function and constant exports per module

**Barrel Files:**
- `icons.ts` acts as icon export barrel (multiple icon exports)
- No central index.ts barrel observed - each module imports what it needs directly
- Supabase context re-exported with type: `export const supabase = () => { ... }`

## Async Patterns

**Promise Handling:**
- `async/await` used for promise chains
- No promise chaining observed
- Explicit `Promise<T>` return types: `async function fetchLastOwnOccurrence(...): Promise<Occurrence | null>`

## Type Patterns

**Type Composition:**
- Conditional types for database transformations: `SetNonNullableDeep<Database, ...>`
- Type override patterns: `OverrideProperties<Occurrence1, { location: LonLat; }>`
- Type guards with `is` keyword: `export function isExtent(input: number[]): input is Extent`
- Discriminated unions for state: `type Photo = UploadingPhoto | FailedUploadPhoto | UploadedPhoto | AttachedPhoto | RemovedPhoto;`

## Code Organization Patterns

**Single Responsibility:**
- Each module handles one concern: `identifiers.ts` for orca identification, `segments.ts` for segment grouping
- Utility functions isolated: `utils.ts` contains `compactMap()` only
- Constants grouped by domain: `constants.ts` has extents, licenses, travel speeds

**Coupling:**
- Loose coupling via exports - modules import what they need
- Domain types live in `types.ts` and are imported where needed
- Database types auto-generated in `database.types.ts`

---

*Convention analysis: 2026-02-26*
