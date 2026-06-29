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

## Why it's a reinforcer, not the lead

Per the uptake strategy note, #4 (contribution visibility) and #2 (data credit)
*reinforce* the lead offer (#1 delete-the-chore + #3 better tool); they don't
carry adoption on their own. So this seed is a **layer on top of** the
partnership play, best shipped once the map is populated (otherwise a lone
contribution feels lonely). Sequence it after the Orca Network direction is
confirmed.

## Open design questions

- What's the unit of visible reward — a per-sighting confirmation, a running
  "your contributions" count, a personal map layer, or all three?
- Does it tie to auth identity (Google sign-in) and the `contributor` record, so
  a regular sees their *cumulative* contribution over time?
- How loud should it be? Mission-driven shore regulars may prefer understated
  legitimacy over gamified badges.
