# 036 — Ingest scope: killer whales range-wide, everything else the Salish Sea

**Status:** accepted · **Decided:** 2026-08-30 · **Applies:** [008](008-source-schemas-are-upstream-mirrors.md) · **Reconciles with:** [022](022-regions-filter-data.md), [023](023-region-framing-vs-filtering.md) · **Touches:** [027](027-marine-mammal-scope-whale-centric-identity.md)

## Decision

**We consume killer whales from their full range, and everything else only from the Salish Sea and the Strait of Juan de Fuca.** This record applies the rule to Maplify; iNaturalist fetches the same wide box and is not yet filtered (see Consequences). A Maplify record is in scope if it is a killer whale of any kind, or if it falls inside `salishSeaExtent` — `[-126, 47, -122, 50.5]`, the same box the map's Salish Sea region filters on. The rule is enforced at ingest, in `isIngestable` ([scripts/ingest/maplify.ts](../../scripts/ingest/maplify.ts)), and the records already held that fail it were purged in one pass ([migration 20260830200000](../../supabase/migrations/20260830200000_purge_out_of_scope_maplify.sql)).

The fetch box does not change. It stays `acartiaExtent` `[-136, 36, -120, 54]`, central California to northern BC.

## Why the fetch reaches California at all

The bbox is not an accident of copying Acartia's boundaries. It is the southern end of the Southern Resident range — the winter coast run to Monterey Bay — and the whole reason to fetch that far is to hold the Residents when they are there. Narrowing the bbox to the Salish Sea would be the simplest possible scope, and it would throw away the one thing the width was for. Any future change to the fetch extent has to replace that, not just shrink it.

## Why "killer whales" and not "Southern Residents"

Because Southern Residents cannot be told apart at ingest. Of the 299 orca records outside the Salish Sea in the live feed on 2026-08-28, six said "Southern Resident"; the rest said "Killer Whale (Orca)" with no ecotype, and no upstream field reliably carries one. Our own ecotype and pod identification happens later, from the report text, and only for a fraction of records. So the implementable rule is *killer whales*, said plainly, and the Southern Resident intent is served by keeping all orcas rather than by identifying them. A Californian Bigg's or offshore record is kept too; that is the cost of not being able to tell, and it is small (242 orca records outside the box in production, of 40,792).

## What it removes

Measured against production on 2026-08-30, before the purge: 40,792 Maplify rows, 26,404 inside the Salish Sea box, 14,388 outside. Of the outside rows, 242 were killer whales and **14,146 were not** — 35% of everything we held from Maplify. The largest groups:

| outside the Salish Sea, not orca | rows |
|---|---:|
| Humpback (both spellings) | 6,970 |
| Gray Whale (all spellings) | 3,206 |
| Unspecified / Unknown / Other / Unidentified | 2,950 |
| Fin / Finback Whale | 501 |
| Blue Whale | 235 |

None of the 14,146 was referenced by a `public.identifications` row. One worked example: a "Humpback" at `-121.9, 36.8` — Monterey Bay — reported through Whale Alert, correctly identified, honestly located, and nothing to do with a Salish Sea sightings site.

## Where the filter goes, and why it changed

The first draft of this decision put the filter in the `public.occurrences` view and deleted nothing. Two premises drove that: reconcile deletes any stored id in the rolling window that is not in the fetch, so filtering before reconcile would delete ~174 in-window records on the first run and leave a corpus with out-of-region records before a date and none after; and the `dwc` export reads `public.occurrences`, so filtering there changes what the archive publishes.

The owner relaxed both on 2026-08-28: nobody consumes the DwC-A export yet, and deleting records is acceptable at this stage. Without those costs the simpler design wins, and it is the design the codebase already has a precedent for:

- **`isIngestable` is a pure predicate over a normalized sighting** — unit-testable, no SQL, and it stops the data arriving rather than hiding it after the fact. The view-side filter would have been a fourth level of dependency on a view that is already three deep, and every consumer of `maplify.sightings` that is not `public.occurrences` (the `dwc` constituent that reads the mirror directly) would have needed the same clause separately.
- **The mirror was already a filtered subset.** `isIngestable` drops the `rwsas` and `wras` sources today, and [CONTEXT.md](../../CONTEXT.md) records that `wras` was "filtered + purged" — filter at ingest, one-time delete of what was already held. Scope filtering is the same move, not a new departure from [008](008-source-schemas-are-upstream-mirrors.md). 008's claim is that mirror *columns* carry upstream semantics and must not leak; it does not require the mirror to hold every row upstream returned for a box we chose to ask about. What upstream returned is recoverable — the API still serves it.
- **The purge keeps the corpus consistent.** Without it, "we hold Californian humpbacks" would be true up to 2026-08-30 and false after, which is worse than either answer alone.

## One extent, not two

The Salish Sea box is defined once, in [src/extents.ts](../../src/extents.ts), a dependency-free module the ingest core can import under Deno; `src/constants.ts` re-exports it for the map. [022](022-regions-filter-data.md) chose that box for the *filter* precisely because the tighter `salishSRKWExtent` silently drops the Strait of Georgia north of 49.5 and the western Strait of Juan de Fuca, and [023](023-region-framing-vs-filtering.md) kept that while letting the *framing* differ. Ingest scope is a filter in 022's sense — a promise about what exists — so it uses the filter box, and the map's Salish Sea region and the ingest rule can never disagree about where the Salish Sea ends. The fetch box is likewise `acartiaExtent` from the same module rather than a string literal.

## Consequences

- **The "Everywhere" region loses its Maplify non-orcas beyond the Salish Sea** but keeps iNaturalist's (see below). [022](022-regions-filter-data.md) already defaulted the map to the Salish Sea, so nothing visible by default changes.
- **The DwC-A shrinks by ~14,000 Maplify records.** The archive's geographic bounding box stays the Acartia box — killer whales genuinely range across it — but its description now says what is inside it: orcas range-wide, other marine mammals the Salish Sea only. Rights-policy [§6.5](../rights-policy.md#65-coverage-fields--derived-vs-stated) and [027](027-marine-mammal-scope-whale-centric-identity.md)'s coverage statements are about *taxonomic* coverage and stand.
- **[CONTEXT.md](../../CONTEXT.md), [PRODUCT.md](../../PRODUCT.md) and the [README](../../README.md)** no longer say spatial scope "matches Acartia's boundaries"; they state the two-part rule, and that it is applied to Maplify today.
- **iNaturalist is untouched, and holds the same problem.** Its fetch box is the *same* Acartia box (`SALISH_SEA_BBOX` in [scripts/ingest/inaturalist.ts](../../scripts/ingest/inaturalist.ts) is mislabelled), with no place filter, so it brings in Californian humpbacks, sea lions and otters exactly as Maplify did — [009](009-taxonomic-scope-marine-mammals.md) counts ~2,150 California sea lions. After this deploy a Maplify humpback in Monterey Bay is purged while the iNaturalist humpback beside it stays. This record states the rule and applies it to Maplify; whether iNaturalist gets the same rule — the same predicate over its observations, plus a purge — is open, and carried by `salish-a4y.4`. The argument for is symmetry; the argument against is that iNaturalist's non-cetacean records are the archive's only unique non-cetacean contribution ([027](027-marine-mammal-scope-whale-centric-identity.md)), and the Californian ones are still marine mammals somebody photographed. HappyWhale ingest is off.
- **Reversible.** Widening the scope again is a predicate change plus a backfill from an API that still serves the history; the fetch box never narrowed.

## Rejected

- **Narrow the fetch bbox to the Salish Sea.** Simplest, and it discards the Southern Residents' coastal range, which is what the width is for.
- **Filter to Southern Residents.** Not implementable: the ecotype is almost never in the record.
- **Filter in `public.occurrences`, delete nothing.** The first draft; see above. Right under the constraints it assumed, unnecessary once they were relaxed, and it leaves the mirror holding 35% out-of-scope rows forever.
- **Filter in the `dwc` schema only.** Fixes what we publish, not what we hold, and the map's Everywhere region would keep showing it.
