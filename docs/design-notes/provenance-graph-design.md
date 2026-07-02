---
title: Collections and contributors — attribution model
date: 2026-06-18
context: exploration session after v1.2 ship; backlog phase 999.1
---

# Collections and contributors

Captures the design decisions from the 2026-06-18 `/gsd-explore` session on
modeling embedded dataset attributions as first-class sources. Replaces the
"TBD options" framing in the original todo.

## Three-layer attribution

Every sighting carries up to three independently-attributable parties:

| Layer | What | Example | Required |
|-------|------|---------|----------|
| Organization | Credit-bearing institution | Orca Network (orcanetwork.org) | nullable |
| Collection (channel) | Venue the report came through | Orca Network Facebook group | required |
| Contributor | Individual observer | Howard Garrett (FB poster, app user) | nullable |

The community gets credit via the collection/org; the individual gets primary
credit via contributor. They are independent — many sightings will have one or
the other but not both.

## Domain shape (graph, not polymorphism)

```
organizations
  id, name, url, dwc_institution_code (informational), rights_holder_text

collections
  id, name, url, kind, organization_id (nullable FK → organizations)

sightings
  collection_id (required FK → collections)
  contributor_id (nullable FK → contributors)
  source_url (nullable; specific FB post / record URL when known)
  comments  -- preserved as-is, including original bracket tag (audit trail)
```

`collections.kind` enum (initial set):

- `facebook_group`
- `research_dataset`
- `acoustic_feed`
- `detector` (automated thermal / acoustic detection systems)
- `direct_app` (SalishSea.io's own submission UI)
- `aggregator_ingest` (Maplify, while it still exists)

## Why a graph, not a polymorphic table

Same Orca Network nonprofit is the org behind their Facebook group today, and
may be the org behind a direct API integration tomorrow. Modeling the org once
and pointing channels at it composes across ingest pipelines. Standalone FB
groups with no parent nonprofit set `organization_id = NULL` — no awkward case.

## DwC export — the aggregator pattern

Research finding from the session: **SalishSea.io is the institution as far as
GBIF is concerned.** This is the dominant pattern among aggregators
(Happywhale → OBIS-SEAMAP, iNaturalist, eBird).

| DwC field | Value |
|-----------|-------|
| `institutionCode` | `"SalishSea"` (fixed, our aggregator code) |
| `rightsHolder` | `"SalishSea.io"` at dataset level |
| `datasetName` | `"SalishSea.io — {collection.name}"` — split by channel |
| `recordedBy` | contributor name when known |
| `samplingProtocol` / `bibliographicCitation` | optional reference to org / FB group URL |

Consequence: the upstream org (Orca Network nonprofit) does **not** map directly
to `institutionCode` in DwC export. It lives in our DB for UI credit and
filtering, and surfaces in DwC export only as supplementary metadata
(`samplingProtocol` or `bibliographicCitation`). This is fine — GBIF treats us
as the publisher.

Reference: Happywhale on OBIS-SEAMAP IPT (zd_1764), iNaturalist Research-grade
Observations on GBIF.

## Ingest strategy

**Going forward:** exact match (case-insensitive, trimmed) of the bracket tag
against `collections.name`. Unmatched → `collection_id = NULL` + bracket tag
remains in `comments` (no auto-creation, no fuzzy match). Ops adds new
collections by hand when a new tag shows up.

**Existing data (~2,323 bracket-tagged + ~3,524 trailing):**

- Bracket-tagged: one-time backfill pass. Dictionary is small (~15 canonical
  tags); typo variants resolved by human eyeball, not by code. Sets
  `collection_id`, leaves `comments` untouched.
- Trailing "Submitted by ... Trusted Observer ..." attributions that name no
  person: **drop**, not interesting. Only retain when the trailing text names
  a human observer.

**No `collection_aliases` table.** `collections.name` is the only source of
truth. No `pg_trgm` runtime fuzzy matching.

## What this kills

- The "FB group with no institution" DwC awkwardness — gone (we're the
  institution)
- Maintaining an alias dictionary forever — gone (one-time backfill, exact
  match thereafter)
- Polymorphic source modeling — gone (it's a graph)
- Conflating channel-credit and observer-credit — gone (two independent FKs)

## Open questions

- Does GBIF's `parentCollectionIdentifier` matter for our DwC-A, or is that
  specific to Happywhale's OBIS-SEAMAP hosting arrangement?
- When migrating off Maplify, do we preserve the `aggregator_ingest`
  `collections.kind` rows for audit, or fold them into the direct ingest
  channels post-migration?

## Related artifacts

- The attribution-modeling todo and backlog phase 999.1 were promoted into the
  v1.3 milestone and shipped 2026-06-24 — this document is their design history
- Direct partner ingest (OrcaSound/HappyWhale): bd issue `salishsea-io-v5s`
- Pre-migration planning artifacts (v1.2 phase files, seeds, todos): git history
  under `.planning/`, removed in the 2026-07 GSD migration
