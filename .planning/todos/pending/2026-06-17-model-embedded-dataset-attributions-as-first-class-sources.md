---
created: 2026-06-17T23:57:49.429Z
updated: 2026-06-18T23:00:00.000Z
title: Model collections and contributors as first-class attribution
area: database
resolves_phase: 11
files:
  - supabase/migrations/20260617203900_dwc_schema.sql
  - supabase/migrations/20260204013006_sightings_uses_contributors.sql
related:
  - .planning/notes/collections-and-contributors-model.md
  - .planning/seeds/orcasound-happywhale-direct-ingest.md
  - .planning/phases/999.1-collections-and-contributors/
---

## Problem

`maplify.sightings.comments` carries channel and observer attribution as free
text — a leading `[Source]` tag (~2,323 rows; e.g., `[Orca Network]` 2,239)
and/or a trailing `Submitted by ...` attribution. Today only the leading
bracket form ever gets surfaced (as part of the comment body), and the Phase 6
`dwc.occurrences` projection rolls every Maplify-sourced sighting under a
single "Maplify" bucket — hiding ~5,500+ attributions from `datasetName` /
`institutionCode` / `recordedBy`.

Phase 6 shipped on 2026-06-18 with this debt acknowledged. The v1.3 work to
clear it is scoped in [999.1-collections-and-contributors](../../phases/999.1-collections-and-contributors/).

## Solution

Decided 2026-06-18 (see [collections-and-contributors-model.md](../../notes/collections-and-contributors-model.md)).
Summary:

- **Three-layer model:** `organizations → collections → sightings`, plus
  `contributors` referenced from `sightings` independently. Graph, not
  polymorphism.
- **DwC export uses the aggregator pattern:** SalishSea.io is the institution
  (`institutionCode = "SalishSea"`, `rightsHolder = "SalishSea.io"`),
  `datasetName` describes the channel, `recordedBy` carries the contributor.
  Upstream orgs (Orca Network nonprofit) don't map to `institutionCode` —
  they live in our DB for UI credit only.
- **Ingest:** exact match (case-insensitive, trimmed) of bracket tag at write
  time. No alias table. No runtime fuzzy match.
- **Backfill:** one-time pass for existing rows, human-resolved for typo
  variants. Drop trailing "Submitted by ..." attributions that don't name a
  person. `sightings.comments` kept untouched as audit trail.

Ready to plan as v1.3 phase (or earlier if it slots into a v1.2.x cleanup).
