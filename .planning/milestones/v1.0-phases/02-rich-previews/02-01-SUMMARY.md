---
phase: 02-rich-previews
plan: 01
subsystem: testing
tags: [jest, ts-jest, lambda-edge, cloudfront, cdk, aws-sdk, open-graph, tdd]

# Dependency graph
requires: []
provides:
  - "Failing jest test scaffold for Lambda@Edge OG handler (9 unit tests, RED state)"
  - "Failing CDK assertion test scaffold for InfraStack (3 tests, RED state)"
  - "jest.config.js updated to discover tests in infra/lib/ as well as infra/test/"
  - "@aws-sdk/client-ssm installed as dev dependency for SSM mock support"
affects:
  - 02-rich-previews/02-02  # Implementation plan will make these tests GREEN

# Tech tracking
tech-stack:
  added:
    - "@aws-sdk/client-ssm (dev dep for jest mock in edge-handler tests)"
  patterns:
    - "TDD Wave 0 scaffold: write failing tests before implementation exists"
    - "Jest mock of @aws-sdk/client-ssm with per-test mockImplementation for SSM caching test"
    - "CloudFront viewer-request event helper makeEvent(userAgent, querystring)"
    - "CDK assertions Template API for infrastructure synthesis testing"

key-files:
  created:
    - "infra/lib/edge-handler/index.test.ts"
    - "infra/test/infra.test.ts"
  modified:
    - "infra/jest.config.js"
    - "infra/package.json"

key-decisions:
  - "jest.config.js updated to include lib/ in roots so edge-handler tests are discovered alongside implementation"
  - "All photos with non-open licenses (cc-by-nc, cc-by-nd, cc-by-sa, cc-by-nc-sa, cc-by-nc-nd, none, null) fall back to branded image — only cc0 and cc-by are open"
  - "Fail-open: handler returns request (pass-through) on any Supabase or SSM error rather than a 500"
  - "SSM credentials cached in module scope — test verifies SSM called exactly once for 2 invocations"

patterns-established:
  - "Pattern 1: TDD Wave 0 — write scaffold tests describing all required behaviors before any implementation. RED is correct."
  - "Pattern 2: makeEvent helper builds CloudFront viewer-request events for unit testing edge handlers"
  - "Pattern 3: jest.requireMock() pattern for accessing mock internals in per-test SSM caching verification"

requirements-completed:
  - PREV-01
  - PREV-02
  - PREV-03

# Metrics
duration: 15min
completed: 2026-03-04
---

# Phase 2 Plan 01: Rich Previews Test Scaffold Summary

**Jest test scaffolds for Lambda@Edge bot detection and OG tag generation (9 unit tests) and CDK InfraStack assertions (3 tests), all in RED state awaiting implementation**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-04T00:00:00Z
- **Completed:** 2026-03-04T00:15:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created 9 failing jest unit tests for the Lambda@Edge OG handler covering bot detection, occurrence-specific tags, license filtering, fallback, not-found, and fail-open behavior
- Created 3 failing CDK assertion tests verifying InfraStack synthesizes a Lambda function, CloudFront Distribution, and VIEWER_REQUEST Lambda@Edge association
- Updated jest.config.js to discover tests from both `test/` and `lib/` directories
- Installed `@aws-sdk/client-ssm` as dev dependency so SSM can be mocked in tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Edge handler unit test scaffold** - `dd9d1e1` (test)
2. **Task 2: CDK stack assertion test scaffold** - `2459a1b` (test)

## Files Created/Modified
- `infra/lib/edge-handler/index.test.ts` - 9 jest unit tests describing Lambda@Edge handler behavior (RED state)
- `infra/test/infra.test.ts` - 3 CDK assertion tests replacing the vitest placeholder (RED state)
- `infra/jest.config.js` - Added `lib/` to test roots so edge-handler tests are discovered
- `infra/package.json` - Added `@aws-sdk/client-ssm` as dev dependency for SSM mock support

## Decisions Made
- Updated `jest.config.js` to include `<rootDir>/lib` in roots (deviation from plan: plan assumed tests would run without this, but jest only looked in `test/`)
- Test file uses `jest.requireMock()` to access `SSMClient` mock constructor for the SSM caching verification test
- Replaced the vitest `import { test } from 'vitest'` placeholder with pure jest imports as the plan required

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated jest.config.js to include lib/ in test roots**
- **Found during:** Task 1 (Edge handler unit test scaffold)
- **Issue:** jest.config.js had `roots: ['<rootDir>/test']` only. The plan places the edge-handler test at `infra/lib/edge-handler/index.test.ts` which is outside the test root, so jest would not discover it.
- **Fix:** Added `'<rootDir>/lib'` to the `roots` array in jest.config.js
- **Files modified:** infra/jest.config.js
- **Verification:** `cd infra && npm test -- --testPathPattern=edge-handler` runs the test file
- **Committed in:** dd9d1e1 (Task 1 commit)

**2. [Rule 3 - Blocking] Installed @aws-sdk/client-ssm**
- **Found during:** Task 1 (Edge handler unit test scaffold)
- **Issue:** Test file mocks `@aws-sdk/client-ssm` which was not in package.json — ts-jest would fail to resolve the import even though jest.mock() was used
- **Fix:** Ran `npm install --save-dev @aws-sdk/client-ssm` in infra/
- **Files modified:** infra/package.json, infra/package-lock.json
- **Verification:** TypeScript compiles (would compile once index.ts exists); SSM mock resolves
- **Committed in:** dd9d1e1 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both fixes necessary for jest to discover and compile the test file. No scope creep — jest.config.js and the SSM package are in the plan's files_modified list.

## Issues Encountered
- The existing `infra/test/infra.test.ts` had `import { test } from 'vitest'` which is incompatible with the ts-jest configuration. Replaced entirely with jest-native CDK assertion tests per the plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both test files are in RED state and ready for Plan 02 (implementation) to make them GREEN
- `infra/lib/edge-handler/index.ts` must be created implementing `export const handler`
- `infra/lib/infra-stack.ts` must be filled in with CloudFront Distribution + Lambda@Edge EdgeFunction constructs
- Open question from RESEARCH.md still applies: CDK ownership of existing CloudFront distribution (reconstruct vs import) must be resolved in Plan 02

---
*Phase: 02-rich-previews*
*Completed: 2026-03-04*
