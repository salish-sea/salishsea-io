---
quick_id: 260702-i4d
title: Add sidebar value-proposition line encouraging sighting submissions
date: 2026-07-02
status: complete
commit: f014316
---

# Quick Task 260702-i4d: Summary

## What changed

`src/obs-panel.ts` — added a `.contribute-pitch` paragraph rendered
conditionally (`!this.user && !this.showForm`) immediately above the
`button[name=show]` ("Add a Sighting"):

> The public is our best source of data on how whales use these waters — add
> what you see. [Learn more.](/about.html)

Styled muted (`#444`, 0.875rem, line-height 1.4, no bespoke margin — it inherits
the panel's `gap: 1rem` flex spacing). The "Learn more." link uses the panel's
accent blue (`#1976d2`) with `white-space: nowrap`.

## Behavior

- **Logged-out visitors** see the pitch above the CTA button (motivation →
  action).
- **Signed-in users** never see it — the `userContext` gate hides it, so the
  ~2 known contributors aren't nagged.
- **Hidden while the form is open** (`showForm`) — no pitch mid-submission.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 195 passed, 11 skipped (unchanged from baseline; no new
  tests — pure presentational copy).
- Visual check in dev server (logged-out):
  - Busy day: pitch sits between date-nav and the button, above the occurrence
    cards. Reads cleanly.
  - Empty day: fills the otherwise-blank space between header and button —
    improves the empty state.
  - Portrait/full-width panel not captured (browser tooling rendered landscape
    regardless of window resize); low risk — a wider container only reduces
    wrapping for a plain block paragraph.

## Notes / follow-ups (unchanged, still deferred)

- Post-submission confirmation + personal "your contributions" view — deferred.
- Org/community research-impact story (the Orca Network hook) — blocked on
  partner discovery (talk to Garrett & Berta first).
- Live impact numbers ("N sightings in last night's archive") — future
  enhancement.
