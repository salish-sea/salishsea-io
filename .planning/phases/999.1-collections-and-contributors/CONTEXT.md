---
phase: 999.1
title: Collections and contributors
status: backlog
created: 2026-06-18
candidate_milestone: v1.3
---

# Phase 999.1 — Collections and contributors

Backlog candidate for v1.3. Promote via `/gsd-review-backlog` when v1.3 is
defined.

## Goal

Model the **channels** through which sightings arrive (`collections`) and the
**organizations** behind them as first-class entities, so the DwC-A export
can attribute observations correctly and the app can surface community + org
credit. Today every Maplify-sourced sighting rolls up under a single "Maplify"
bucket — hiding ~5,500+ attributions across Orca Network, Cascadia Research,
Whale Alert, HappyWhale, and others.

## Why now (or why next)

- v1.2 shipped the DwC-A export. It deliberately punted attribution quality —
  this phase clears that debt.
- OrcaSound and HappyWhale direct ingest is anticipated; this phase puts the
  graph in place so those integrations slot in without redesign.
- Long-term goal of retiring Maplify is unblocked by having a destination
  schema that doesn't assume Maplify as the pivot.

## Design decisions (already settled)

See [collections-and-contributors-model.md](../../notes/collections-and-contributors-model.md)
for full rationale. Summary:

- **Three-layer model:** `organizations → collections → sightings`, with
  `contributors` referenced independently from `sightings`.
- **DwC aggregator pattern:** SalishSea.io is the institution
  (`institutionCode = "SalishSea"`, `rightsHolder = "SalishSea.io"`),
  `datasetName` describes the channel, `recordedBy` carries the contributor.
- **Ingest:** exact-match resolution of bracket tags at write time. No alias
  table. No fuzzy match.
- **Backfill:** one-time pass for ~2,323 bracket-tagged rows. Drop trailing
  "Submitted by …" attributions that don't name a person. Keep `comments`
  untouched.

## In scope

- New `organizations` table
- New `collections` table with `kind` enum and nullable `organization_id` FK
- New columns on `maplify.sightings`: `collection_id` (FK, required for new
  rows post-deploy), `source_url` (nullable)
- Update `dwc.occurrences` projection to populate `datasetName`,
  `institutionCode`, `rightsHolder`, `recordedBy` per the aggregator pattern
- One-time backfill migration for existing bracket-tagged sightings
- Ingest path changes (Maplify mirror) to exact-match bracket tag → collection
- Seed data: ~15 canonical collections + their parent organizations

## Out of scope

- Direct ingest writers for OrcaSound / HappyWhale (separate phase, seeded at
  [orcasound-happywhale-direct-ingest.md](../../seeds/orcasound-happywhale-direct-ingest.md))
- Retiring Maplify entirely
- UI surfaces for org / collection pages (could split into a separate
  frontend phase if scope is large)
- Trust tier / data quality scoring on collections

## Open questions

- Does GBIF's `parentCollectionIdentifier` matter for our DwC-A?
  Tracked in [.planning/research/questions.md](../../research/questions.md).
- UI scope: separate phase or bundled? Decide during discuss-phase.

## Inputs

- Original todo: [.planning/todos/pending/2026-06-17-model-embedded-dataset-attributions-as-first-class-sources.md](../../todos/pending/2026-06-17-model-embedded-dataset-attributions-as-first-class-sources.md)
- Design note: [.planning/notes/collections-and-contributors-model.md](../../notes/collections-and-contributors-model.md)
- v1.2 Phase 6 artifacts (the `dwc.occurrences` projection this phase
  refines): [.planning/milestones/v1.2-phases/](../../milestones/v1.2-phases/)
