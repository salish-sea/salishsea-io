---
title: Make the sighter's contribution visible (thin UI over v1.3 provenance)
trigger_condition: a community-uptake milestone is started (post Orca Network discovery), AND there is appetite for a sighter-facing surface that rewards logging on the site
planted_date: 2026-06-29
related:
  - .planning/notes/community-uptake-orca-network-partnership.md
  - .planning/PROJECT.md
---

# Seed: make the sighter's contribution visible

## The idea

Give a sighter visible, immediate proof that **their observation counts** —
that it landed in the canonical record and feeds the scientific/open-data
pipeline (Acartia → WRAS, the nightly DwC-A → GBIF). E.g. after logging:
"Your sighting is now part of the Salish Sea record — it'll appear in tonight's
DarwinCore Archive," plus a personal view of "your contributions" on the map.

This is the **"it counts for something" (#4)** motive from the uptake
exploration, rendered as a sighter-facing surface.

## Why it's cheap

The hard part is **already built.** The v1.2 DwC-A export and the v1.3
provenance graph (provider · collection · organization · contributor +
per-sighting FKs, real `recordedBy`, `recordedByID`/ORCID emit) mean the
contribution is *already real and attributable*. What's missing is only the
**thin UI layer that makes it legible to the person who logged it** — there's no
new pipeline to build.

## Two audiences, one storytelling muscle

This is half of a single capability: **make the research impact of community
observations legible.** Point it at two audiences:

- **The individual sighter** (#4) — "your sighting is now part of the record /
  feeds research."
- **The org and community** (#2) — "the observations from *this organization and
  these people* are feeding science." Critically, partners like Orca Network are
  probably **completely unaware** their sightings ever reach GBIF/research today
  (the Acartia → WRAS plumbing is invisible). Telling that story is unsolved and
  differentiated — see the strategy note's "offer reframe."

So this is **not merely a reinforcer** — for the partnership it may be a primary
hook, because it gives an org real, felt recognition for decades of work nobody
has surfaced. Sequence after the map is populated (a lone contribution feels
lonely) and after the Orca Network direction is confirmed.

## Open design questions

- What's the unit of visible reward — a per-sighting confirmation, a running
  "your contributions" count, a personal map layer, or all three?
- Does it tie to auth identity (Google sign-in) and the `contributor` record, so
  a regular sees their *cumulative* contribution over time?
- How loud should it be? Mission-driven shore regulars may prefer understated
  legitimacy over gamified badges.
