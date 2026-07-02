# 006 — Provenance graph: provider · collection · organization · contributor

**Status:** accepted · **Decided:** v1.3 (2026-06-19 → 2026-06-24)

## Decision

Every sighting's provenance is modeled as four independent concepts — **provider** (how it reached us), **collection** (what channel), **organization** (what institution backs the channel), **contributor** (who observed) — as reference tables in `public` with FK columns directly on each source table. SalishSea.io publishes under the **aggregator pattern**. Definitions: [CONTEXT.md](../../CONTEXT.md); full model: [docs/data-provenance.md](../data-provenance.md).

## Key sub-decisions and rationale

- **Provider ≠ collection.** Maplify is a provider; Orca Network's FB group is a collection. A channel stays stable even if re-sourced through a different provider — so provider is per-record provenance, never a property of the collection. This killed `aggregator_ingest` as a `collection_kind` value.
- **Aggregator pattern:** `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"` fixed on every exported row; per-collection `datasetName`; upstream orgs credited only in EML `associatedParty`. Rejected: putting upstream org names in `institutionCode` (breaks GBIF's identifier triplet). This is the dominant pattern (Happywhale→OBIS-SEAMAP, iNaturalist, eBird).
- **FK columns on source tables (Option A).** Rejected: polymorphic provenance table (unenforceable FKs) and per-source join tables (extra JOINs, no gain). Precedent existed: `public.observations.contributor_id`, cross-schema `maplify.sightings.taxon_id`.
- **Resolution order:** `source_url` pattern → leading `[Tag]` bracket → trailing "Submitted by …" line → structured `source` code → NULL. A URL is unambiguous where present; comment parsing is fallback.
- **Exact-match resolution only** — human-curated dictionary including known misspellings; unmatched → NULL. Rejected: alias tables and fuzzy matching (perpetual maintenance surface, false positives) and auto-creating collections from unknown tags (junk rows).
- **Trailing "Submitted by … Trusted Observer" yields collection/org only, never contributor** — it names an org/trust tier; using it for `contributor_id` would silently corrupt ~2,740 rows.
- **`comments` is immutable during backfill** — bracket tags and attributions are the audit trail; strip at view-read time only.
- **nullable → backfill → constrain** sequencing; `collection_id` stays permanently nullable for Maplify rows that never resolve.
- **URL resolver is ingest-time pure TypeScript** (~20 lines), results stored as FKs; views read pre-resolved FKs. Rejected: DB stored procs (regex-per-row in views), URL-routing libraries (overkill for ~4 patterns).
- **One collection per external platform** for iNat/HappyWhale — per-project granularity adds complexity with no GBIF payoff.
- **Cross-provider contributor unification deferred** (the `jmaughn` iNat ≈ James Maughn native case is probable, not confirmed). A future `contributor_links` table is the extension point; never a shared FK on name similarity.
- **`recordedBy` for Maplify is a view-parsed name string** (regex, validated against the full 4,477-row trusted corpus), empty when no name — never an opaque source code.
- **SELECT grants ship in the table-creation migration** — Supabase RLS defaults silently zero out DwC JOINs otherwise.

## Reference

Design history with superseded parts: [docs/design-notes/provenance-graph-design.md](../design-notes/provenance-graph-design.md). Pitfall catalog: [docs/design-notes/dwca-attribution-pitfalls.md](../design-notes/dwca-attribution-pitfalls.md).
