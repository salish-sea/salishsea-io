---
title: Direct ingest for OrcaSound and HappyWhale (and others)
trigger_condition: partner organization confirms resourcing and provides API access / data feed
planted_date: 2026-06-18
related:
  - .planning/notes/collections-and-contributors-model.md
  - .planning/phases/999.1-collections-and-contributors/
---

# Seed: Direct partner ingest

## When to act

When **OrcaSound, HappyWhale, or any other partner** confirms they will support
direct ingest (API access, data feed, or scheduled drop). The conversation has
already mentioned these two as likely candidates pending resourcing from their
side.

Indirect trigger: when product wants to retire Maplify entirely. Maplify-only
sightings can't be retired until direct ingest covers the channels Maplify
currently funnels.

## What's already in place

The `organizations` / `collections` model from
[999.1-collections-and-contributors](../phases/999.1-collections-and-contributors/)
is designed for this. Once that phase ships:

- Each new partner gets a row in `organizations` (their nonprofit / research
  consortium / company)
- Each ingest channel gets a row in `collections` with `kind` matching
  (`acoustic_feed` for OrcaSound, `research_dataset` for HappyWhale, etc.)
- New ingest writers point at the right `collection_id` at insert time
- No schema change needed per partner — only data rows + an ingest worker

## Design notes for future-you

- **Don't re-derive the collections model.** The note above and the 999.1
  phase artifacts contain the design rationale. Just slot in.
- **Don't recreate the `[Tag]` parsing path for partners.** Partners that
  authenticate and post directly to our API should set `collection_id`
  themselves (or by partner ID at the auth layer). The bracket-tag parser is a
  Maplify-only legacy concern.
- **DwC export should "just work"** — the aggregator pattern (SalishSea.io as
  institution) covers this. New `collections` rows automatically project as
  new `datasetName` values without changes to the DwC export logic.
- **Contributor identity is the only fresh question** — does the partner
  forward observer names? Do they have stable observer IDs we can use as
  `recordedByID`? Pin down before integration.

## Migration consideration

If we eventually retire Maplify, decide then whether to:

- Preserve `collections` rows with `kind = 'aggregator_ingest'` for audit
  (Maplify-era sightings still attributed correctly)
- Or rewrite Maplify-era `collection_id` to point at the same destination
  channels as the new direct ingest (cleaner DB, loses provenance)

Out of scope until both direct ingests are live.
