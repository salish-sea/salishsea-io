# 009 — Taxonomic scope: PSEMP Marine Mammal Working Group

**Status:** accepted · **Decided:** 2026-07-02 · **Supersedes:** the "cetaceans only" scope of [001](001-product-framing.md)

## Decision

The **target** taxonomic scope is that of **PSEMP's Marine Mammal Working Group** (Puget Sound Ecosystem Monitoring Program) — Salish Sea **marine mammals** broadly (cetaceans, pinnipeds, mustelids), not cetaceans only. Which animals are in scope is a property of the *site's coverage*, not of the definition of an occurrence.

This is the *target*; **current** ingest is narrower.

## Current vs. target

- **Current ingest:** cetaceans + Lutrinae (otters). The live iNaturalist query fetches taxa `[152871 (Cetacea), 372843, 526556 (Lutrinae)]`.
- **Target:** the full PSEMP Marine Mammal Working Group scope. **Pinnipeds** (seals, sea lions) are in scope but **not yet ingested** — a known gap tracked as work items (iNaturalist and GBIF ingestion paths).

## Rationale

- Anchoring scope to an existing, authoritative regional working group gives a defensible, externally-recognized boundary instead of an ad-hoc species list — and it matches how the region's marine-mammal community already frames its remit.
- Lutrinae was previously recorded as a one-off "exception" to a cetaceans-only rule ([001](001-product-framing.md)). Under a marine-mammal scope, otters are simply **in scope**, not an exception — which removes the awkward special case.

## Rejected

- **Cetaceans only** (the original 001 framing) — too narrow; excludes pinnipeds and mustelids that are part of the same regional monitoring remit and that users in the Orca Network orbit also observe.
- **All marine life** (fish, seabirds, invertebrates) — dilutes curation, taxonomy, and community identity with no near-term payoff.

## Consequences

- PRODUCT.md states target-vs-current scope; [CONTEXT.md](../../CONTEXT.md) defines **Taxonomic scope** and no longer calls Lutrinae an exception.
- Extending ingest toward pinnipeds is planned work, not a scope question.
