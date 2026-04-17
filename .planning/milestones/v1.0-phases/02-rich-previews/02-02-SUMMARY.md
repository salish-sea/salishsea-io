---
phase: 02-rich-previews
plan: 02
subsystem: infra
tags: [lambda-edge, cloudfront, open-graph, aws-sdk, ssm, tdd, typescript]

# Dependency graph
requires:
  - 02-01  # Failing test scaffold (RED state) created by plan 01
provides:
  - "Lambda@Edge viewer-request handler (infra/lib/edge-handler/index.ts)"
  - "All 10 edge-handler unit tests GREEN"
  - "@aws-sdk/client-ssm as production dependency for Lambda bundle"
affects:
  - 02-03  # CDK stack plan will wire this handler into CloudFront distribution

# Tech tracking
tech-stack:
  added:
    - "@aws-sdk/client-ssm (moved from devDependencies to dependencies — bundled in Lambda)"
  patterns:
    - "Module-scope credential caching: supabaseUrl/supabaseKey survive warm Lambda invocations"
    - "Fail-open error handling: catch block returns request pass-through, never 500"
    - "OPEN_LICENSES allowlist: only cc0 and cc-by are permitted for og:image"
    - "Intl.DateTimeFormat for date/time formatting (no extra packages needed)"
    - "escapeHtml for & \" < > in all dynamic attribute values before HTML interpolation"

key-files:
  created: []
  modified:
    - "infra/lib/edge-handler/index.ts"
    - "infra/package.json"
    - "infra/package-lock.json"

key-decisions:
  - "Only cc0 and cc-by are open licenses — cc-by-sa excluded (was wrong in prior skeleton)"
  - "SSM parameter names: /salishsea/supabase-url and /salishsea/supabase-anon-key (WithDecryption: true)"
  - "Generic preview includes og:site_name, og:type, og:url, og:title — no description or image"
  - "Description format: '{count} {species}s · {time}' using Intl.DateTimeFormat locale formatting"
  - "twitter:card uses name= attribute, not property= (Twitter Cards spec)"

# Metrics
duration: ~15min
completed: 2026-04-17
---

# Phase 2 Plan 02: Lambda@Edge Handler Implementation Summary

**Lambda@Edge viewer-request handler with bot detection, SSM credential caching, Supabase REST fetch, and OG tag generation — all 10 unit tests GREEN**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-04-17T18:34:10Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Moved `@aws-sdk/client-ssm` from devDependencies to production dependencies so it is bundled in the Lambda@Edge deployment artifact
- Rewrote `infra/lib/edge-handler/index.ts` to pass all 10 unit tests, correcting multiple bugs in the prior skeleton implementation
- 10 unit tests pass GREEN covering: bot detection, pass-through, generic preview, occurrence preview (title/description/image), license filtering (cc0 pass, cc-by pass, cc-by-nc fall back), empty photos fallback, all-non-open-license fallback, not-found fallback, fail-open error handling, SSM caching

## Task Commits

1. **Task 1: Install @aws-sdk/client-ssm as production dep** — `f7742fe` (chore)
2. **Task 2: Implement Lambda@Edge handler** — `b31da40` (feat)

## Files Created/Modified

- `infra/lib/edge-handler/index.ts` — Lambda@Edge handler with bot detection, SSM caching, Supabase fetch, OG HTML generation
- `infra/package.json` — @aws-sdk/client-ssm moved to dependencies
- `infra/package-lock.json` — lockfile updated

## Decisions Made

- `cc-by-sa` removed from OPEN_LICENSES — only `cc0` and `cc-by` are allowed per locked user decision
- SSM parameter for the anon key corrected to `/salishsea/supabase-anon-key` (with `WithDecryption: true`)
- Generic preview HTML includes `og:site_name`, `og:type`, `og:url` per spec (prior skeleton omitted these)
- Description format corrected to `"{count} {species}s · {time}"` with Intl time formatting

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] OPEN_LICENSES incorrectly included cc-by-sa**
- **Found during:** Task 2
- **Issue:** Prior skeleton had `new Set(['cc0', 'cc-by', 'cc-by-sa'])`. The locked user decision (RESEARCH.md, plan behavior spec) states only cc0 and cc-by are open. cc-by-sa requires share-alike which creates legal obligations for re-use.
- **Fix:** Changed OPEN_LICENSES to `['cc0', 'cc-by']` (array for `.includes()` check)
- **Files modified:** infra/lib/edge-handler/index.ts
- **Commit:** b31da40

**2. [Rule 1 - Bug] SSM parameter name wrong**
- **Found during:** Task 2
- **Issue:** Prior skeleton used `/salishsea/supabase-key` — the plan specifies `/salishsea/supabase-anon-key` (SecureString with `WithDecryption: true`)
- **Fix:** Corrected both the parameter name and added `WithDecryption: true` to the SecureString fetch
- **Files modified:** infra/lib/edge-handler/index.ts
- **Commit:** b31da40

**3. [Rule 1 - Bug] Description format missing time component and pluralization**
- **Found during:** Task 2
- **Issue:** Prior skeleton produced `"3 Orca"` instead of the locked format `"3 Orcas · 2:32 PM"`. The test `toContain('3 Orca')` passed due to substring matching but the format was wrong.
- **Fix:** Added Intl.DateTimeFormat time formatting and plural `${species}s` as specified
- **Files modified:** infra/lib/edge-handler/index.ts
- **Commit:** b31da40

**4. [Rule 1 - Bug] Generic preview missing og:site_name, og:type, og:url**
- **Found during:** Task 2
- **Issue:** Plan behavior spec and code examples show generic preview must include `og:site_name`, `og:type`, `og:url` — the prior skeleton emitted only `og:title`.
- **Fix:** `genericPreviewTags()` now returns all four required tags
- **Files modified:** infra/lib/edge-handler/index.ts
- **Commit:** b31da40

**5. [Rule 1 - Bug] BOT_AGENTS list incomplete**
- **Found during:** Task 2
- **Issue:** Prior skeleton was missing `baiduspider`, `bluesky`, and `google-snippet` from the required bot detection list specified in the plan.
- **Fix:** Added all missing entries per plan's `BOT_AGENTS` spec
- **Files modified:** infra/lib/edge-handler/index.ts
- **Commit:** b31da40

## Known Stubs

None — the handler is fully wired. The fallback image URL `https://salishsea.io/preview.jpg` references an asset that must be uploaded to S3 as part of the deploy workflow, but the handler logic itself is complete.

## Threat Flags

None — no new network endpoints or auth paths introduced beyond what the plan specifies. SSM credentials are read-only at cold start; no user-controlled data touches IAM or SSM paths.

## TDD Gate Compliance

This plan is `type: tdd`. The RED gate (test scaffold) was created in plan 02-01. This plan implements GREEN. Gate sequence:
- RED commit: `dd9d1e1` (from plan 02-01)
- GREEN commit: `b31da40` (this plan)

Both gates present in git history.

## Self-Check: PASSED

- infra/lib/edge-handler/index.ts — FOUND
- infra/package.json — FOUND
- .planning/phases/02-rich-previews/02-02-SUMMARY.md — FOUND
- Commit f7742fe (chore: SSM prod dep) — FOUND
- Commit b31da40 (feat: handler implementation) — FOUND
