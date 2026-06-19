# Phase 9: Reference Table Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 9-reference-table-foundation
**Areas discussed:** Schema placement, Collection granularity, Collection natural key, Access model, Acronym seeding

---

## Schema placement

| Option | Description | Selected |
|--------|-------------|----------|
| public schema | Alongside contributors; same-schema FKs; PostgREST auto-exposed; simplest | ✓ |
| New `provenance` schema | Dedicated schema; cleaner separation but cross-schema FKs + extra USAGE/exposure config | |

**User's choice:** public schema
**Notes:** Consistent with where `public.contributors` already lives (which CONTRIB-01/02 extend).

---

## Collection granularity

| Option | Description | Selected |
|--------|-------------|----------|
| One collection each | One baseline collection per non-aggregator provider (iNaturalist / HappyWhale / Direct); defer finer | ✓ |
| Finer where data supports | Sub-divide iNat by project, HappyWhale by org now | |

**User's choice:** One collection each — with an important refinement.
**Notes:** User flagged that native `public.observations` records are often reposts of content also entered into Maplify/conserve.io, tagged the same way and by the same person. This means collections are a SHARED registry (a Direct repost resolves to the same collection as the Maplify version; only provider differs). `SalishSea.io Direct` becomes the fallback only for genuinely-original native posts. Verified native records have a free-text `body` (and `url`) but no Maplify-style `comments` column — native tag parsing is a Phase 11 concern. Captured as D-02/D-03/D-04.

---

## Collection natural key

| Option | Description | Selected |
|--------|-------------|----------|
| Stable slug + serial PK | Serial id PK + UNIQUE slug/code; readable Phase 11 dictionary; idempotent seed via ON CONFLICT(slug) | ✓ |
| Serial IDs only | Opaque numeric IDs; harder to review the resolver map and seed re-runs | |

**User's choice:** Stable slug + serial PK
**Notes:** Reinforced by the shared-registry decision — both the Maplify resolver and native-repost resolver in Phase 11 must reference the same collection rows by a stable key.

---

## Access model

| Option | Description | Selected |
|--------|-------------|----------|
| RLS + permissive SELECT policy | ENABLE RLS + USING(true) SELECT for anon/authenticated; matches contributors; satisfies Supabase linter | ✓ |
| Plain GRANT SELECT | dwc style; but a public table without RLS trips the linter | |

**User's choice:** RLS + permissive SELECT policy
**Notes:** Write access stays closed.

---

## Acronym seeding (surfaced during discussion)

| Option | Description | Selected |
|--------|-------------|----------|
| Only decoded collections now | Seed ~15 named collections; acronyms added in Phase 11; their rows resolve NULL until then | |
| Seed acronyms as stubs too | Placeholder rows for every distinct acronym now (slug=lowercased acronym, name=acronym, org NULL); Phase 11 fills in | ✓ |
| You decide | Defer to Claude | |

**User's choice:** Seed acronyms as stubs too
**Notes:** Claude flagged two derived implications, both folded into CONTEXT.md without re-asking: (1) stub-seeding does NOT conflict with RESOLVE-04 "no auto-create" — that rule governs the ongoing ingest resolver, not a one-time human-reviewed seed (D-07); (2) `collections.kind` must be nullable so un-decoded stubs carry NULL kind rather than a guessed value (D-09).

---

## Claude's Discretion

- Exact column lists for `organizations` and `providers` beyond id/slug/name.
- Seed mechanism: idempotent `INSERT … ON CONFLICT` inside the migration (preferred; `supabase/seed.sql` is dev-fetch only).
- Whether `providers` needs a kind/type column or is a fixed four-row enumeration.

## Deferred Ideas

- Cross-provider contributor unification (`contributor_links`, the `jmaughn` ≈ James Maughn case).
- Finer collection granularity for iNaturalist (per project) / HappyWhale (per org).
- Decoding acronym stubs (org + name + kind) — Phase 11 backfill.
- Populating ORCID values for native contributors — later.
- `source_url` → whole-occurrence importer (Layer 2) — seeded, out of milestone.
