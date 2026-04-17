---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 02-rich-previews 02-01-PLAN.md (test scaffolds in RED state)
last_updated: "2026-04-17T18:30:09.331Z"
last_activity: 2026-04-17 -- Phase 02 execution started
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 7
  completed_plans: 3
  percent: 43
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.
**Current focus:** Phase 02 — rich-previews

## Current Position

Phase: 02 (rich-previews) — EXECUTING
Plan: 1 of 5
Status: Executing Phase 02
Last activity: 2026-04-17 -- Phase 02 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-occurrence-links P02 | 15 | 2 tasks | 2 files |
| Phase 02-rich-previews P01 | 15 | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Pending: Occurrence link encodes only occurrence ID — date/position derived from occurrence on load
- Pending: Rich preview infrastructure approach — static SPA can't serve dynamic meta tags without help (Lambda@Edge or CloudFront Functions under investigation)
- [Phase 01-occurrence-links]: Bypass date setter during hydration (use this.#date + fetchOccurrences) to avoid writing ?d= to browser history
- [Phase 01-occurrence-links]: Use setView with skipEvent:true to prevent map-move from writing ?x=/?y=/?z= to history on deep-link load
- [Phase 01-occurrence-links]: Silent fallback on unknown occurrence ID: if !occurrence return without error
- [Phase 01-occurrence-links]: URL encodes only ?o=<id> built from origin+pathname (not href) to strip existing query params
- [Phase 01-occurrence-links]: Copy-link button placed outside when(this.user || editable) gate — visible to all visitors per LINK-01
- [Phase 02-rich-previews]: jest.config.js updated to include lib/ in roots so edge-handler tests discovered alongside implementation
- [Phase 02-rich-previews]: Open license photos: only cc0 and cc-by are open; all others fall back to branded image
- [Phase 02-rich-previews]: Fail-open: Lambda@Edge handler returns pass-through request (not 500) on any Supabase or SSM error

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 2 approach is unresolved: static SPA architecture means crawler bots won't execute JS; need research into Lambda@Edge vs CloudFront Functions for meta tag injection before Phase 2 can be planned

## Session Continuity

Last session: 2026-03-05T02:31:19.161Z
Stopped at: Completed 02-rich-previews 02-01-PLAN.md (test scaffolds in RED state)
Resume file: None
