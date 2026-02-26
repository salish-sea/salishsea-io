# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts` (root level)
- Jest 5.9.3 used for CDK infrastructure tests (separate `infra/jest.config.js`)

**Assertion Library:**
- Vitest built-in `expect()` function

**Run Commands:**
```bash
npm test              # Run all vitest suites
npm run test -- --watch      # Watch mode (not explicitly in package.json but vitest supports)
npm run test -- --coverage   # Coverage mode (vitest supports)
```

## Test File Organization

**Location:**
- Co-located with implementation: test files sit in `src/` directory alongside source
- Test files: `src/segments.test.ts`, `src/identifiers.test.ts`, `src/constants.test.ts`
- Infrastructure tests: `infra/test/infra.test.ts` (placeholder/disabled)

**Naming:**
- `.test.ts` suffix for vitest files
- Module name prefix matching: `identifiers.test.ts` tests `identifiers.ts`

**File Structure:**
```
src/
├── identifiers.ts
├── identifiers.test.ts
├── segments.ts
├── segments.test.ts
├── constants.ts
├── constants.test.ts
└── [other source files]
```

## Test Structure

**Suite Organization:**

Vitest tests use `describe()` for grouping related tests and `test()` for individual cases:

```typescript
describe('occurrences2segments grouping', () => {
  test('produces expected grouping of occurrence IDs', () => {
    const actualGrouping = segments.map(s => s.occurrences.map(o => o.id));
    expect(actualGrouping).toEqual(expectedGrouping);
  });

  test('each segment occurrences are strictly increasing in time', () => {
    for (const seg of segments) {
      for (let i = 1; i < seg.occurrences.length; i++) {
        expect(seg.occurrences[i]!.observed_at_ms).toBeGreaterThan(seg.occurrences[i-1]!.observed_at_ms);
      }
    }
  });
});
```

**Patterns:**

1. **Setup at module level:** Test data and fixtures loaded once before all tests:
```typescript
function loadOccurrences(): Occurrence[] {
  const filePath = path.resolve(process.cwd(), 'test/occurrences.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Omit<Occurrence, 'observed_at_ms'>[];
  return raw.map(o => ({...o, observed_at_ms: Date.parse(o.observed_at)}));
}

const occurrences = loadOccurrences();
const segments = occurrences2segments(occurrences);
```

2. **Simple test structure:** Most tests are straightforward function calls with assertions:
```typescript
test('finds individual identifiers', () => {
  const table: [string, string[]][] = [
    ['[Orca Network] CRC 56 and CRC 356...', ['CRC56', 'CRC356', 'CRC2356']],
  ];
  for (const [input, expected] of table) {
    const actual = detectIndividuals(input);
    for (const id of expected) {
      expect(actual).toContain(id);
    }
    expect(actual.length).toBe(expected.length);
  }
});
```

3. **Table-driven tests:** Common pattern using `[input, expected]` tuples for parameterized testing:
```typescript
test('finds pod identifiers', () => {
  const table: [string, string | null][] = [
    ['[Orca Network] Likely T65A5...', 'T'],
  ];
  for (const [input, expected] of table) {
    const actual = detectPod(input);
    expect(actual).toBe(expected);
  }
});
```

4. **Baseline snapshot comparison:** Test data captured from current implementation:
```typescript
// Captured baseline grouping from current implementation (see segments.baseline.test.ts output)
const expectedGrouping: string[][] = [
  ["inaturalist:327709844"],
  ["inaturalist:327576383"],
  // ... more data
];
```

## Mocking

**Framework:** None currently used - all tests are integration-style

**Patterns:** No mocking observed in production tests. Tests directly call functions with real data.

**What to Mock:** Not applicable - codebase avoids mocking in current tests

**What NOT to Mock:** All external dependencies are tested as-is (file I/O, JSON parsing, date operations)

## Fixtures and Fixtures

**Test Data:**

```typescript
function loadOccurrences(): Occurrence[] {
  const filePath = path.resolve(process.cwd(), 'test/occurrences.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Omit<Occurrence, 'observed_at_ms'>[];
  return raw.map(o => ({...o, observed_at_ms: Date.parse(o.observed_at)}));
}
```

**Location:**
- Fixture data stored in `test/occurrences.json` (referenced in tests)
- Loaded at module scope in test files and reused across tests
- Data transformation applied during load (adding `observed_at_ms` field)

**Patterns:**
- Function-based data loading: `loadOccurrences()` wraps file I/O
- Type-safe casting: `as Omit<Occurrence, 'observed_at_ms'>[]`
- Data transformation during fixture setup

## Coverage

**Requirements:** Not enforced - no coverage configuration detected

**View Coverage:** Not available in current setup

**Observed Coverage:**
- Limited: 116 total lines of test code across 3 test files
- Testing focus: Pure functions only (`identifiers.ts`, `segments.ts`, `constants.ts`)
- No tests for LitElement components or browser APIs
- Infrastructure tests disabled (placeholder only)

## Test Types

**Unit Tests:**
- Scope: Pure functions with deterministic inputs/outputs
- Approach: Direct function calls with assertion chains
- Examples: `detectIndividuals()`, `occurrences2segments()`, `isExtent()`

**Integration Tests:**
- Scope: Function chains working together (e.g., `occurrences2segments()` → `segment2features()`)
- Approach: Validate output properties of dependent functions
- Example: `segment2travelLine()` test checks feature properties set by `segment2features()`

**E2E Tests:**
- Framework: Not used
- Component/UI testing: Not automated (LitElement components have no tests)
- Infrastructure testing: Disabled (placeholder only)

## Test Assertions

**Patterns Observed:**

1. **Equality assertions:**
```typescript
expect(actual.length).toBe(expected.length);
expect(line).toBe(expected);
expect(actualGrouping).toEqual(expectedGrouping);
```

2. **Containment assertions:**
```typescript
expect(actual).toContain(id);
```

3. **Truthiness assertions:**
```typescript
expect(features[0]?.get('isFirst')).toBe(true);
expect(features[features.length - 1]?.get('isLast')).toBe(true);
expect(line).not.toBeNull();
```

4. **Numeric comparisons:**
```typescript
expect(seg.occurrences[i]!.observed_at_ms).toBeGreaterThan(seg.occurrences[i-1]!.observed_at_ms);
```

## Environment Configuration

**Vitest Config:**

```typescript
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
    test: {
        // mode defines what ".env.{mode}" file to choose if exists
        env: loadEnv(mode, process.cwd(), ''),
    },
}));
```

**Environment Variables:**
- Tests can load mode-specific `.env.*` files via `loadEnv()`
- No special test-specific environment configuration currently used

## Test Data Organization

**Baseline Data:**
- Real-world occurrence data loaded from `test/occurrences.json`
- Expected grouping hardcoded as comment reference: `// Captured baseline grouping from current implementation...`
- Data represents ~20 occurrence groups from iNaturalist and Maplify sources

**Type Safety:**
- Fixture data cast to specific types: `as Omit<Occurrence, 'observed_at_ms'>[]`
- Missing required fields added during transformation
- Tests verify both structure and content

## Known Testing Gaps

**Not Tested:**
- LitElement components: No component tests exist (e.g., `sighting-form.ts`, `obs-map.ts`)
- Browser APIs: No jsdom or DOM-based tests
- Async operations: No tests for Supabase queries, file uploads, or Promise-based functions
- Error cases: No tests for error paths or exception handling
- Type transformations: No tests for database-to-form-data conversions (`observationToFormData()`)
- Infrastructure: CDK tests disabled/placeholder

**Why:**
- Test focus is on pure algorithmic functions
- Component testing deferred (likely due to complexity of OpenLayers/Lit integration)
- Supabase integration tested manually or in E2E

---

*Testing analysis: 2026-02-26*
