---
phase: quick-260526-scf-add-taxon-id-526556-lutrinae-to-inatural
plan: "01"
subsystem: supabase/inaturalist
tags: [migration, inaturalist, lutrinae, otters]
dependency_graph:
  requires: []
  provides: [inaturalist.update_observations includes taxon 526556]
  affects: [cron:load-recent-inaturalist-observations]
tech_stack:
  added: []
  patterns: [Supabase SQL migration, CREATE OR REPLACE FUNCTION]
key_files:
  created:
    - supabase/migrations/20260526000000_inat_add_lutrinae.sql
  modified: []
decisions:
  - Applied migration via `supabase db query -f` against local Supabase (migration up reports "up to date" because the CLI reads from main repo worktree, not the agent worktree; direct file apply achieves equivalent verification)
  - Smoke call via DO block (PERFORM) avoids CLI void-return scan error (OID 2278), confirms no SQL error
metrics:
  duration: ~5 min
  completed: "2026-05-27T03:28:28Z"
  tasks_completed: 2
  files_created: 1
---

# Quick Task 260526-scf: Add taxon id 526556 (Lutrinae) to iNaturalist observations query — Summary

**One-liner:** New migration redefines `inaturalist.update_observations` to fetch taxon_ids `[152871, 372843, 526556]`, adding Lutrinae (otters) alongside existing cetacean taxa.

## What Was Done

- **Before:** `inaturalist.update_observations` passed `array[152871, 372843]` to `inaturalist.fetch_observation_page`
- **After:** Passes `array[152871, 372843, 526556]` — taxon 526556 is Lutrinae (river/sea otters)
- Migration file: `supabase/migrations/20260526000000_inat_add_lutrinae.sql`
- No other functions, schedules, or migrations were modified

## Verification Results

- `grep -E "array\[152871,\s*372843,\s*526556\]"` — found in migration file
- `pg_get_functiondef('inaturalist.update_observations(date,date)'::regprocedure) ~ '526556'` returns `true` after apply
- `DO $$ BEGIN PERFORM inaturalist.update_observations(current_date - 1, current_date); END $$;` returns `DO` (no SQL error)
- Existing cron schedule `load-recent-inaturalist-observations` unchanged

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 — Create migration | 6dac3a6 | feat(260526-scf-01): add taxon 526556 (Lutrinae) to inaturalist.update_observations |

## Deviations from Plan

None — plan executed exactly as written.

## Notes

Production deployment occurs when changes are pushed to `main` (auto-deploys via GitHub Actions). This task does not push. After merging, the next cron execution will include Lutrinae observations. Closes GitHub issue #267.

## Self-Check

- [x] `supabase/migrations/20260526000000_inat_add_lutrinae.sql` exists
- [x] Commit 6dac3a6 exists
- [x] Function definition contains 526556 (verified against local Supabase)

## Self-Check: PASSED
