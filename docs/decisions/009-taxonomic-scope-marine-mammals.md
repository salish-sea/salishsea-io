# 009 — Taxonomic scope: PSEMP Marine Mammal Working Group

**Status:** accepted · **Decided:** 2026-07-02 · **Supersedes:** the "cetaceans only" scope of [001](001-product-framing.md)

## Decision

The taxonomic scope is that of **PSEMP's Marine Mammal Working Group** (Puget Sound Ecosystem Monitoring Program) — Salish Sea **marine mammals** broadly (cetaceans, pinnipeds, mustelids), not cetaceans only. Which animals are in scope is a property of the *site's coverage*, not of the definition of an occurrence.

## Ingest coverage

The live iNaturalist query already fetches the full marine-mammal scope — taxa `[152871 (Cetacea), 372843 (Phocoidea — all pinnipeds: seals, sea lions, walrus), 526556 (Lutrinae — otters)]` (`inaturalist.update_observations`). No downstream taxonomic filter narrows this. Prod carries thousands of pinniped records (e.g. ~2,150 California sea lions, ~1,800 harbor seals, ~530 Steller sea lions as of 2026-07-03), so pinnipeds are **ingested and surfaced today**, not a gap.

Remaining coverage work is about *completeness across sources* (e.g. inbound GBIF), not a taxonomic hole.

## Rationale

- Anchoring scope to an existing, authoritative regional working group gives a defensible, externally-recognized boundary instead of an ad-hoc species list — and it matches how the region's marine-mammal community already frames its remit.
- Lutrinae was previously recorded as a one-off "exception" to a cetaceans-only rule ([001](001-product-framing.md)). Under a marine-mammal scope, otters are simply **in scope**, not an exception — which removes the awkward special case.

## Rejected

- **Cetaceans only** (the original 001 framing) — too narrow; excludes pinnipeds and mustelids that are part of the same regional monitoring remit and that users in the Orca Network orbit also observe.
- **All marine life** (fish, seabirds, invertebrates) — dilutes curation, taxonomy, and community identity with no near-term payoff.

## Consequences

- PRODUCT.md and [CONTEXT.md](../../CONTEXT.md) define **Taxonomic scope** as the marine-mammal remit and no longer call Lutrinae an exception.
- Cetaceans, pinnipeds, and mustelids are all ingested via iNaturalist today; there is no pinniped ingestion gap to close.
