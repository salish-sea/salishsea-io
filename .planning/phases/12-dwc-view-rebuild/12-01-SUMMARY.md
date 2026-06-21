---
phase: 12-dwc-view-rebuild
plan: "01"
subsystem: database
tags: [postgres, supabase, regex, dwc, maplify, recordedBy]

# Dependency graph
requires:
  - phase: 12-dwc-view-rebuild
    provides: Phase 12 context, D-03 census requirement, Wave 2 regex shape
provides:
  - Read-only census snippet for Maplify trusted comments parenthetical patterns
  - Validated recordedBy extraction regex grounded in full prod corpus (4477 trusted rows)
  - Committed census output TSV confirming 1900 kept names, 2151 NULL, 353 comma-NULLed, 82 ID-NULLed
affects:
  - 12-02 (Wave 1 migration — collection backfill)
  - 12-03 (Wave 2 migration — DwC view with recordedBy)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-only census snippet with PROD-ONLY header comment documenting that local db reset has no Maplify data"
    - "Two-query census pattern: (a) extraction census, (b) NULL-out audit — same pattern as Phase 11 bracket-tag census"

key-files:
  created:
    - supabase/snippets/12_comments_census.sql
    - .planning/phases/12-dwc-view-rebuild/maplify_trusted_comments_census.tsv
  modified: []

key-decisions:
  - "recordedBy regex `^\\[[^\\]]+\\]\\s+.+?\\(([^()]+)\\)` validated against full prod corpus — no extension needed for Wave 2"
  - "1900 rows keep a real observer name; 2151 have no bracket tag so recordedBy = NULL (correct per D-02)"
  - "353 comma-rows NULL out via `~ ','` guard; 82 ID-credit rows NULL out via `~ '^IDs?\\s'` guard — both guards confirmed necessary"
  - "A few low-volume group/listener attributions (Orca Network, OrcaHello & human listeners, Orcasound listener <name>) are acceptable as recordedBy — not garbage"

patterns-established:
  - "Census-before-migrate: validate regex against full prod corpus before any Wave migration embeds it (D-03 discipline)"
  - "Prod-run snippets carry no credentials — DSN supplied at operator run time via env var"

requirements-completed: [ATTR-01]

# Metrics
duration: 15min (census + human verify)
completed: 2026-06-21
---

# Phase 12 Plan 01: Maplify Comments Census Summary

**Read-only SQL census validates `^\[[^\]]+\]\s+.+?\(([^()]+)\)` regex against 4477 prod trusted rows — 1900 real observer names kept, 2435 NULLed via bracket-tag absence or guards; no Wave 2 extension needed**

## Performance

- **Duration:** ~15 min (snippet authoring + prod run + human verification)
- **Started:** 2026-06-21T19:00:00Z (estimated)
- **Completed:** 2026-06-21T19:39:07Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments

- Authored `supabase/snippets/12_comments_census.sql` as a read-only two-query census (extraction census + NULL-out audit) embedding the exact Wave 2 recordedBy regex
- Ran census against full prod corpus (4477 trusted Maplify rows) via `npx supabase db query --linked` (Management API, read-only)
- Confirmed regex extracts real observer names with zero garbage in the kept set; committed output as `maplify_trusted_comments_census.tsv`
- Validated both NULL-out guards are necessary: 353 comma rows, 82 ID-credit rows correctly excluded

## Census Results (Full Prod Corpus)

| Category | Count | Disposition |
|----------|-------|-------------|
| Total trusted Maplify rows | 4477 | — |
| `recordedBy` kept (single observer name) | 1900 | real names; 0 garbage in kept set |
| NULL — no bracket tag / no parenthetical | 2151 | correct per D-02 |
| NULLed by `~ ','` comma guard | 353 | multi-name lists (e.g. "Howard Garrett, Alisa Schulman-Janiger") |
| NULLed by `~ '^IDs?\\s'` ID-credit guard | 82 | identification credits (e.g. "ID Rachel Haight") |

**Low-volume acceptable group attributions in kept set:** Orca Updates, Orca Behavior Institute, Orca Network, OrcaHello & human listeners, "Orcasound listener \<name>" — treated as valid `recordedBy` values, not garbage.

## Wave 2 Regex (Validated — No Extension Needed)

```sql
(regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1]
```

Applied to: `split_part(comments, '<br>', 1)` — headline segment only (not full comments string, which can contain spurious parens in attribution lines).

NULL-out guards (CASE/WHERE in view):
- `~ ','` — multi-name lists → NULL
- `~ '^IDs?\s'` — ID-credit prefixes → NULL

## Task Commits

1. **Task 1: Author read-only census snippet** — `296da06` (feat)
2. **Task 2: Run census against prod + human verification** — `e3a7ecc` (chore)

## Files Created/Modified

- `supabase/snippets/12_comments_census.sql` — Read-only D-03 census snippet; two queries: (a) extraction census, (b) NULL-out audit; embeds exact Wave 2 regex; PROD-ONLY header with run instructions and no credentials
- `.planning/phases/12-dwc-view-rebuild/maplify_trusted_comments_census.tsv` — Committed census output from prod (4477 trusted rows; 1900 kept / 2151 NULL / 435 NULLed by guards)

## Decisions Made

- **recordedBy regex needs no Wave 2 extension.** The full prod corpus confirms the two existing guards (`~ ','` and `~ '^IDs?\\s'`) cover all non-name parenthetical shapes at material volume. The snippet's query (a) is the exact regex Wave 2 will embed.
- **Group/listener attributions are acceptable `recordedBy`.** Orca Network, OrcaHello & human listeners, and similar low-volume values are legitimate attribution, not garbage — no additional NULL-out guard warranted.
- **Census run via Management API** (`npx supabase db query --linked`), not the IPv4 session pooler documented in the snippet's header. The snippet's psql DSN comment remains valid for future manual runs; the prod query was equivalent.

## Deviations from Plan

None — plan executed exactly as written. The census confirmed the pre-existing regex hypothesis; no regex extension was required.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The recordedBy extraction regex is fully validated against prod. Wave 2 (12-03) can embed `(regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1]` with the two NULL-out guards without further research.
- Wave 1 (12-02) is independent of this census — it handles `collection_id` backfill, not `recordedBy`.
- No blockers.

---

*Phase: 12-dwc-view-rebuild*
*Completed: 2026-06-21*

## Self-Check: PASSED

- [x] Both prior commits verified: `296da06` (snippet), `e3a7ecc` (census TSV)
- [x] `supabase/snippets/12_comments_census.sql` exists and is read-only (no DDL confirmed by grep)
- [x] `.planning/phases/12-dwc-view-rebuild/maplify_trusted_comments_census.tsv` exists and is committed
- [x] SUMMARY records: snippet is read-only, embeds exact Wave 2 regex, census run against prod, 1900/2151/353/82 counts, regex needs no extension
- [x] requirements-completed: [ATTR-01]
