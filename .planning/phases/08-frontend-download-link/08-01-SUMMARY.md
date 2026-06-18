---
phase: 08-frontend-download-link
plan: 01
subsystem: ui
tags: [temporal, intl, fetch, vitest, formatters, discriminated-union]

requires:
  - phase: 07-nightly-workflow-hosting
    provides: /dwca/salishsea-occurrences-v1.{zip,parquet} URLs with Content-Length + Last-Modified headers

provides:
  - src/download-info.ts — DownloadInfo discriminated union, formatBytes, formatRelativeTime, fetchArchiveMetadata
  - src/download-info.test.ts — 20 pure-function tests with injected clock and mocked fetch

affects:
  - 08-02 — Plan 02 imports all three helpers + DownloadInfo type from ./download-info.ts

tech-stack:
  added: []
  patterns:
    - "Injected Temporal.Instant now parameter for deterministic relative-time tests without vi.useFakeTimers"
    - "vi.spyOn(globalThis, 'fetch') in beforeEach + vi.restoreAllMocks() in afterEach for clean fetch mocking"
    - "Promise.allSettled for parallel HEAD requests with per-result status discrimination"

key-files:
  created:
    - src/download-info.ts
    - src/download-info.test.ts
  modified: []

key-decisions:
  - "formatBytes uses raw string interpolation (not Intl.NumberFormat) for sub-1024 byte values — integers need no decimal formatting"
  - "vi.spyOn created once in beforeEach with mockImplementation configured per-test — satisfies single-spy requirement while keeping test isolation"
  - "fetchSpy type annotation uses ReturnType<typeof vi.fn> to avoid TS2344 from the strict spyOn generic constraint"

patterns-established:
  - "Pattern: pure helper module (download-info.ts) tested independently of DOM/Lit — avoids dialog.showModal() complexity in unit tests"
  - "Pattern: DEFAULT_BASE module constant makes the base path grep-able for Plan 02 wiring tests"

requirements-completed:
  - DOWNLOAD-01

duration: 4min
completed: 2026-06-18
---

# Phase 8 Plan 01: Download-Info Helpers Summary

**Pure helper module `src/download-info.ts` with `formatBytes`, `formatRelativeTime`, `fetchArchiveMetadata`, and `DownloadInfo` discriminated union; 20 Vitest tests all green.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-18T19:23:29Z
- **Completed:** 2026-06-18T19:27:00Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments

- `DownloadInfo` discriminated union (`ok: true | false`) exported from `src/download-info.ts` — Plan 02 wiring layer can branch with `info.ok ? ... : ...` and TypeScript narrows `zipBytes`/`parquetBytes`/`lastModified` into scope only on the success arm.
- `formatBytes` with binary thresholds (1024^n) and decimal display via `Intl.NumberFormat` — returns plain string for sub-1024 values, formatted decimal for KB/MB/GB.
- `formatRelativeTime` with `Temporal.Instant`-injected `now` parameter for deterministic tests — buckets: minutes, hours, days, absolute date past 7-day threshold. Returns `''` for malformed headers (T-08-02 mitigation).
- `fetchArchiveMetadata` fires exactly two parallel HEADs via `Promise.allSettled`; `Number(...) || null` on `Content-Length` (T-08-01 mitigation); `lastModified` sourced from `.zip` response.
- 20 tests covering all formatter boundary values and 5 fetch scenarios (success, network reject, 503, missing Content-Length, default path assertion).

## Task Commits

1. **Task 1: Implement src/download-info.ts** — `044d17c` (feat)
2. **Task 2: Author src/download-info.test.ts** — `c66fa8e` (test)

## Files Created/Modified

- `/Users/rainhead/dev/salishsea-io/src/download-info.ts` — Three helpers + DownloadInfo type; DEFAULT_BASE = '/dwca/salishsea-occurrences-v1'
- `/Users/rainhead/dev/salishsea-io/src/download-info.test.ts` — 20 pure-function tests; no jsdom pragma; single `vi.spyOn(globalThis, 'fetch')` in beforeEach

## Formatter Boundary Values Exercised

| Input | Output |
|-------|--------|
| `formatBytes(0)` | `'0 B'` |
| `formatBytes(65)` | `'65 B'` |
| `formatBytes(1023)` | `'1023 B'` |
| `formatBytes(1024)` | `'1 KB'` |
| `formatBytes(1536)` | `'1.5 KB'` |
| `formatBytes(1024*1024)` | `'1 MB'` |
| `formatBytes(1.4*1024*1024)` | `'1.4 MB'` |
| `formatBytes(1024**3)` | `'1 GB'` |

| Relative offset | Output |
|----------------|--------|
| 30 minutes ago | `'updated 30 minutes ago'` |
| 6 hours ago | `'updated 6 hours ago'` |
| 24 hours ago | `'updated yesterday'` (numeric: 'auto') |
| 2 days ago | `'updated 2 days ago'` |
| exactly 7 days ago | `'updated YYYY-MM-DD'` (absolute) |
| 14 days ago | `'updated YYYY-MM-DD'` (absolute) |
| malformed | `''` |

## Spy-on-fetch Pattern for Plan 02 Reuse

```typescript
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

Each test calls `fetchSpy.mockImplementation(...)` to configure its own behavior. `vi.restoreAllMocks()` in `afterEach` prevents leakage into `src/salish-sea.test.ts`.

## Decisions Made

- `formatBytes` uses `${bytes} B` (plain string) for values below 1024, not `Intl.NumberFormat` — integers don't need decimal formatting.
- `fetchSpy` typed as `ReturnType<typeof vi.fn>` to avoid TypeScript error TS2344 from the strict generic constraint on `vi.spyOn<typeof globalThis, 'fetch'>`.
- Single `vi.spyOn` in `beforeEach` with per-test `mockImplementation` satisfies the plan's "exactly once" requirement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test expected '1,023 B' but formatBytes returns '1023 B' for sub-1024 values**
- **Found during:** Task 2 (first test run)
- **Issue:** Test case for `formatBytes(1023)` expected `'1,023 B'` (comma-formatted), but the implementation correctly uses plain `${bytes} B` for sub-1024 values — no `Intl.NumberFormat` needed for integers.
- **Fix:** Corrected the test expectation to `'1023 B'`.
- **Files modified:** `src/download-info.test.ts`
- **Committed in:** c66fa8e (Task 2 commit)

**2. [Rule 1 - Bug] TypeScript error TS2344 on vi.spyOn type parameter**
- **Found during:** Task 2 (tsc --noEmit after writing test)
- **Issue:** `ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>` fails with TS2344 — `'fetch'` does not satisfy the strict key constraint.
- **Fix:** Changed type annotation to `ReturnType<typeof vi.fn>` which is the correct generic type for a Vitest mock function.
- **Files modified:** `src/download-info.test.ts`
- **Committed in:** c66fa8e (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — wrong test expectation, wrong type annotation)
**Impact on plan:** Both trivial corrections; no functional scope change.

## Issues Encountered

None beyond the two Rule 1 auto-fixes documented above.

## Known Stubs

None — the module contains no hardcoded empty values or placeholder text that would flow to UI rendering. `fetchArchiveMetadata` returns real data from actual `fetch` calls.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. Same-origin HEAD requests are already covered by `connect-src 'self'` (RESEARCH Pitfall 3).

## Next Phase Readiness

- Plan 02 (UI wiring) can import `{ formatBytes, formatRelativeTime, fetchArchiveMetadata, type DownloadInfo }` from `./download-info.ts` without further refactor.
- The `DEFAULT_BASE = '/dwca/salishsea-occurrences-v1'` constant is grep-able from the wiring tests.
- The spy-on-fetch pattern above is directly reusable in `src/salish-sea.test.ts` for DOM-level tests of `onAboutClicked`.

---
*Phase: 08-frontend-download-link*
*Completed: 2026-06-18*
