---
phase: 03-partner-org-hyperlinking
plan: "01"
subsystem: ui
tags: [vite, typescript, regex, csv, vitest]

# Dependency graph
requires: []
provides:
  - "src/partners.csv — CSV data file with partner org name/URL pairs editable without TypeScript changes"
  - "src/partner-links.ts — CSV parser and injectPartnerLinks() pure utility function"
  - "src/partner-links.test.ts — 7 passing unit tests covering all partner link injection behaviors"
affects:
  - "03-02-PLAN.md — uses injectPartnerLinks import and partners export from this plan"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vite ?raw import for bundled CSV data (static top-level import, parsed at module load)"
    - "Per-org single-pass combined regex handling bracket pattern and plain name in one pass"
    - "Longest-name-first sort to prevent partial name matches"
    - "Guard check for [Name]( before any substitution to prevent double-linking"

key-files:
  created:
    - src/partners.csv
    - src/partner-links.ts
    - src/partner-links.test.ts
  modified: []

key-decisions:
  - "Use Vite ?raw static top-level import for partners.csv — no build plugin, no runtime fetch, parsed once at module load"
  - "Single-pass combined regex per org handles [Org Name] bracket pattern and plain name without double-substitution"
  - "Longest-name-first sort prevents NOAA matching inside NOAA Fisheries"
  - "Link text always uses canonical CSV name regardless of match casing (brand capitalization preserved)"

patterns-established:
  - "Pattern: ?raw CSV import — import data from './file.csv?raw' works without any Vite config changes; vite-env.d.ts provides TS types"
  - "Pattern: single-pass regex for safe text injection — combine bracket and plain-name patterns in one regex to avoid re-matching already-transformed text"

requirements-completed:
  - PARTNER-01
  - PARTNER-02
  - PARTNER-03
  - PARTNER-05
  - PARTNER-06

# Metrics
duration: 5min
completed: 2026-04-18
---

# Phase 3 Plan 01: Partner Link Injection Module Summary

**Pure CSV-driven link injection utility using Vite ?raw import and single-pass combined regex with case-insensitive matching, bracket handling, and double-link prevention**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-18T03:20:00Z
- **Completed:** 2026-04-18T03:25:55Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 3

## Accomplishments

- Created `src/partners.csv` with 3 initial partner orgs (Orca Network, OrcaSound, NOAA Fisheries) — editable by non-technical contributors without touching TypeScript
- Implemented `src/partner-links.ts` with CSV parser and `injectPartnerLinks()` pure utility covering all edge cases: case-insensitive matching, bracket pattern handling, double-link prevention, longest-name-first ordering
- All 7 unit tests pass covering PARTNER-01 through PARTNER-03, PARTNER-05, PARTNER-06, and the longest-match-first edge case

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CSV data file and write failing tests (RED)** - `609d82d` (test)
2. **Task 2: Implement partner-links.ts to make all tests pass (GREEN)** - `8b9499a` (feat)

_TDD plan: test commit followed by feat commit per RED/GREEN protocol._

## TDD Gate Compliance

- RED gate: `609d82d` (test commit) — tests failed as expected, module did not exist
- GREEN gate: `8b9499a` (feat commit) — all 7 tests pass

## Files Created/Modified

- `src/partners.csv` — Partner org name-to-URL lookup data; header row `name,url`; plain text editable by contributors
- `src/partner-links.ts` — CSV parser (parsePartnersCSV) and link injection (injectPartnerLinks, injectOrgLink); exports `injectPartnerLinks` and `partners`
- `src/partner-links.test.ts` — 7 unit tests with `// @vitest-environment jsdom` environment declaration; covers all 5 requirements in this plan plus longest-match-first edge case

## Decisions Made

- Vite `?raw` static top-level import chosen over Vite plugin or build-time JSON transform — simpler, no config changes, synchronous, identical output
- Single-pass combined regex per org (bracket pattern + plain name in one pass) prevents double-substitution artifacts — key insight from RESEARCH.md Pattern 3
- Link text always uses canonical CSV name regardless of matched casing: brand capitalization preserved across case-insensitive matches
- All occurrences of an org name per body are linked (not just the first) — `g` flag used

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None — `partners.csv` contains real partner orgs; `injectPartnerLinks` is fully functional.

## Threat Flags

None — no new network endpoints or trust boundaries introduced. Security considerations documented in RESEARCH.md (DOMPurify config, tab-napping mitigation via rel="noopener noreferrer") are handled in Plan 02 integration.

## Next Phase Readiness

- `injectPartnerLinks(body)` and `partners` exports are ready for Plan 02 integration
- Plan 02 adds: import in `obs-summary.ts`, DOMPurify `ADD_ATTR` config, PARTNER-04 (target/rel) test
- No blockers or concerns

---
*Phase: 03-partner-org-hyperlinking*
*Completed: 2026-04-18*
