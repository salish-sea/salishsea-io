# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Link Shareability

**Shipped:** 2026-04-17
**Phases:** 2 | **Plans:** 7 | **Tasks:** 12

### What Was Built
- Copy-link button on occurrence summary cards producing clean `?o=<id>` URLs (no extra params), visible to all visitors regardless of login state
- Deep-link hydration on page load: sets date from occurrence's `observed_at` and centers map, with no browser history pollution
- Lambda@Edge viewer-request handler for bot detection and OG tag generation, fetching Supabase occurrence data with SSM-cached credentials
- CDK infrastructure stack: CloudFront + Lambda@Edge VIEWER_REQUEST, deployed to production replacing the previous static distribution
- Static branded fallback preview image for occurrences without openly-licensed photos

### What Worked
- TDD Wave 0 scaffold (plan 02-01 writing all tests in RED before implementation) caught multiple behavior specification issues early — license list, description format, missing OG fields
- GSD atomic commit discipline made the production deploy debugging (timeout, SSM key retention) straightforward to bisect
- Reusing the existing `VITE_SUPABASE_KEY` GitHub Actions secret rather than adding a new one kept the deploy workflow simple
- `fail-open` design for the Lambda@Edge handler (pass-through on any error) meant production never served 500s during rollout

### What Was Inefficient
- Infrastructure approach (Lambda@Edge vs CloudFront Functions) required research to resolve before Phase 2 could be planned — could have been investigated during Phase 1 in parallel
- Brief DNS outage during production cutover (had to delete old distribution before CDK could claim the alias) — a staged alias transfer would have been cleaner
- CDK upgrade required mid-phase (schema version mismatch) added unplanned friction to the deploy plan

### Patterns Established
- `buildShareUrl`: build share URLs from `origin + pathname` (not `href`) to strip existing query params
- History-safe hydration: bypass Lit property setters to avoid triggering `setQueryParams` side-effects during deep-link load
- `skipEvent: true` on `setView` prevents map-move handler from writing position to URL history
- Lambda@Edge SSM credential caching at module scope — one SSM call per cold start, verified by unit test
- Icon export pattern: `export const fooIcon = svg\`<path d='...'/>\`` from `icons.ts`, wrapped with `<svg>` at call site

### Key Lessons
1. CDK cannot create SSM SecureString values — use a placeholder at synth time and set the real value post-deploy via AWS Console or a separate `aws ssm put-parameter` command
2. `cloudfront.experimental.EdgeFunction` (not `lambda.Function`) is required for Lambda@Edge; regular Lambda functions can't be attached to CloudFront viewer-request events
3. AWS does not allow two CloudFront distributions to share a domain alias — plan for a brief outage or use a staged DNS handoff when replacing a distribution

### Cost Observations
- Model mix: ~100% sonnet (no opus or haiku sessions observed)
- Sessions: ~6 sessions across 44 days (most work clustered in two bursts: Phase 1 on 2026-03-04, Phase 2 on 2026-04-17)
- Notable: Phase 2 infra work required multiple fix commits post-deploy (timeout, SSM key retention, bot UA matching) — integration testing before deploy would have caught these

---

## Milestone: v1.1 — Partner Org Links

**Shipped:** 2026-04-18
**Phases:** 1 | **Plans:** 2 | **Tasks:** 4

### What Was Built
- `src/partners.csv` — plain CSV (name, url columns) editable by non-technical contributors; Vite `?raw` import bundles it at build time with no runtime fetch
- `src/partner-links.ts` — pure `injectPartnerLinks()` utility with case-insensitive matching, `[Org Name]` bracket handling, double-link prevention, longest-name-first ordering, and URL-safe regex (splits on existing links to avoid matching names inside URLs)
- `src/partner-links.test.ts` — 7 + 1 unit tests covering all behaviors including full marked + DOMPurify pipeline (PARTNER-04)
- `src/obs-summary.ts` integration — `injectPartnerLinks()` pre-processes body before `marked.parse`, custom link renderer adds `target="_blank" rel="noopener noreferrer"`, DOMPurify `ADD_ATTR` preserves attributes; also fixed pre-existing `target="_new"` bug and `onDelete` unhandled rejection

### What Worked
- TDD discipline (RED → GREEN) caught implementation gaps before integration — failing tests were a clear signal the module was ready to implement
- Planning a pure function with no DOM dependency made it fully testable in Node/jsdom without a browser
- Code review caught 3 pre-existing bugs (WR-01, WR-02) and one new edge case (WR-03, URL-safe regex) that automated tests hadn't caught

### What Was Inefficient
- REQUIREMENTS.md traceability table wasn't auto-updated by gsd-tools `phase complete` — required manual correction at milestone close
- `audit-open` gsd-tools command crashed with a ReferenceError — had to skip and verify artifacts manually

### Patterns Established
- `?raw` CSV import pattern: `import data from './file.csv?raw'` works without any Vite config changes; `vite-env.d.ts` provides TS types via `/// <reference types="vite/client" />`
- Single-pass combined regex for safe text injection: bracket + plain-name patterns in one regex avoids re-matching already-transformed text
- URL-safe substitution: split body on existing `[text](url)` patterns, only transform odd-indexed (non-link) segments
- Longest-name-first sort prevents short names (NOAA) matching inside longer names (NOAA Fisheries)

### Key Lessons
1. Pure functions with no DOM dependency are easy to test and compose — keep link injection pure, apply it at the call site in the component
2. Code review auto-fix is worth running after every phase — caught a pre-existing `target="_new"` bug unrelated to phase work that would have been a silent UX issue
3. Manual CSV editing as a non-technical interface works when the file is committed — no admin UI needed for a small, infrequently-updated lookup table

### Cost Observations
- Model mix: ~100% sonnet
- Sessions: 1 focused session (planning was done in prior sessions)
- Notable: Phase was planned across 2-3 prior context sessions (discuss → plan) and executed in one session end-to-end including code review fix and milestone close

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~6 | 2 | First milestone — baseline established |
| v1.1 | ~1 execution + 2-3 planning | 1 | Tight pure-function scope; code review fixed pre-existing bugs |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 15 unit + 2 E2E smoke | partial | 0 |
| v1.1 | 25 unit + 2 E2E smoke | partner-links fully covered | 0 |

### Top Lessons (Verified Across Milestones)

1. TDD (RED before implementation) surfaces behavior specification gaps before any code is written — confirmed in v1.0 and v1.1
2. Fail-open error handling in infrastructure handlers prevents production outages during rollout — v1.0
3. Pure functions with no DOM dependency are easy to compose and test — keep transformation logic separate from rendering — v1.1
4. Code review auto-fix catches pre-existing bugs unrelated to phase scope — run it every phase — v1.1
