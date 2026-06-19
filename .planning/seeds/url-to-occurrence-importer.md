---
title: Derive a whole occurrence from a source_url (URL → record importer)
trigger_condition: the providers/collections/contributors graph (v1.3) has shipped, AND there is appetite for a new inbound ingest path (e.g. ops wants to add a sighting by pasting a link, or a partner exposes per-record URLs)
planted_date: 2026-06-19
related:
  - .planning/v1.3-EXECUTIVE-SUMMARY.md
  - .planning/notes/collections-and-contributors-model.md
  - .planning/seeds/orcasound-happywhale-direct-ingest.md
---

# Seed: URL → occurrence importer (source_url Layer 2)

## The idea

Given a `source_url` (an iNaturalist observation URL, a HappyWhale encounter
URL, a Facebook group post, a Whale Alert record), **fetch and map the full
occurrence** — not just resolve its channel, but pull in species, date,
location, photos, and observer, creating/updating a sighting.

This is the natural extension of v1.3's **Layer 1** (which only *derives the
provider + collection* from a `source_url` via a URL-pattern registry). Layer 2
turns that registry into an actual importer.

## When to act

After v1.3 ships the provider/collection/contributor graph. Trigger when:

- Ops wants a "paste a link to add a sighting" path, or
- A partner exposes stable per-record URLs we want to one-shot import, or
- It becomes the cleaner way to onboard a Facebook group (paste post URLs)
  versus the Maplify aggregator path.

## Why it slots in cleanly after v1.3

- The URL-pattern registry (domain/path → provider + collection) already exists
  from Layer 1 — Layer 2 adds a per-provider *fetcher + field mapper* behind it.
- `source_url` is already a first-class column on the sighting.
- The aggregator DwC pattern already covers whatever new collections appear.
- Contributor identity resolution is shared with the v1.3 work.

## Design notes for future-you

- **One fetcher per provider domain.** iNaturalist and HappyWhale have public
  APIs keyed by the id in their URLs; Facebook posts likely need manual/assisted
  capture (no clean API). Don't assume one generic scraper.
- **Reuse, don't re-derive, the resolution registry** from v1.3 Layer 1.
- **Dedupe against existing records** — a pasted URL may already be ingested via
  the provider's batch path (iNat/HappyWhale already pull thousands of rows).
  Match on `source_url` / provider id before inserting.
- **Respect SRC-01** — importing an iNat/HappyWhale record for *internal* use is
  fine, but it still must not be re-exported to GBIF (they self-publish).
- Contributor identity is the recurring open question (the `jmaughn` ≈
  James Maughn cross-provider case) — see the v1.3 exec summary.

## Out of scope until triggered

A general-purpose web scraper, OG-tag heuristics for arbitrary domains, or
auto-import without a human confirm step. Start with the providers whose URL
schemes we already understand.
