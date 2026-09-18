# 044 — iNaturalist gets the same ingest scope rule as Maplify

**Status:** accepted · **Decided:** 2026-09-18 · **Extends:** [036](036-ingest-scope-killer-whales-range-wide.md) · **Applies:** [008](008-source-schemas-are-upstream-mirrors.md) · **Answers:** `salish-a4y.4`, the open question 036 left

## Decision

**Killer whales range-wide, everything else the Salish Sea — now for iNaturalist too.** A record is in scope if it sits under the genus *Orcinus*, or inside `salishSeaExtent` `[-126, 47, -122, 50.5]`. The rule is enforced at ingest in `isIngestable` ([scripts/ingest/inaturalist.ts](../../scripts/ingest/inaturalist.ts)), beside the same-named predicate the Maplify ingest has had since [036](036-ingest-scope-killer-whales-range-wide.md), and the 51,637 out-of-scope rows already held were purged in one pass ([migration 20260918210000](../../supabase/migrations/20260918210000_purge_out_of_scope_inaturalist.sql)).

The fetch box does not change. It stays `acartiaExtent` `[-136, 36, -120, 54]` — the southern end of the Southern Resident range, which is the whole reason it reaches California.

## The page of the feed that made the case

Before any aggregate, the fixture. `scripts/ingest/fixtures/inaturalist-observations.json` is six real records captured from the live `/observations` endpoint on 2026-07-05, kept because they exercise multiple photos, a null licence, a missing accuracy and an undated record. Nobody chose them for where they were. Here is where they were:

| observation | coordinates |
|---|---|
| 378550282 | -122.411, 37.811 — Pier 39, San Francisco, to three decimal places |
| 378610508 | -122.483, 37.822 — the San Francisco waterfront |
| 378638874 | -123.003, 37.700 — offshore, San Mateo County |
| 378638876 | -123.003, 37.700 — offshore, San Mateo County |
| 378638904 | -122.990, 37.635 — offshore, San Mateo County |
| 378638325 | -121.895, 36.608 — Monterey Bay |

**Six for six, none of them within 600 miles of the Salish Sea.** That is one arbitrary page of the feed we were storing verbatim. The test that used to assert "the fixture parses and one record is skipped" now asserts that the whole page is out of scope, which is a more honest thing for it to say.

## What it removes

Dry-run against production on 2026-09-18 with the migration's own predicate: **81,785 observations, 51,637 out of scope, 30,148 kept.** 63% of everything we held from iNaturalist, against 35% for Maplify. 905 killer whales outside the box are kept.

Where the doomed rows are:

| | rows |
|---|---:|
| California (below 42°N) | 42,493 |
| Oregon | 5,901 |
| north of the box (above 50.5°N) | 2,573 |
| west of the box (offshore) | 771 |
| south of the box (46.3–47°N) | 662 |
| east of the box (inland) | 138 |

And what they are — the largest groups, with what survives inside the box beside them:

| taxon | outside | inside |
|---|---:|---:|
| California Sea Lion | 12,807 | 2,625 |
| Pacific Harbor Seal | 8,997 | 6,430 |
| Harbor Seal | 5,755 | 4,936 |
| North American River Otter | 5,515 | 4,237 |
| Humpback Whale | 4,474 | 2,746 |
| Northern Elephant Seal | 4,374 | 344 |
| Steller Sea Lion | 1,530 | 2,617 |
| Gray Whale | 1,410 | 490 |
| Risso's Dolphin | 1,014 | 2 |
| Pacific White-sided Dolphin | 751 | 166 |
| Orca | 740 | 1,738 |
| Common Bottlenose Dolphin | 608 | 0 |

The bottom of that table is the argument in miniature. Risso's dolphins, bottlenose dolphins, common dolphins (245/2), northern right whale dolphins (222/3) and blue whales (213/1) are not Salish Sea animals that happen to be recorded elsewhere; they are Californian animals that our fetch box reached. **Pier 39 alone is 1,894 observations** — one tourist dock in San Francisco, more records than we hold for most Salish Sea species.

This is not a legacy backlog. **In the 30 days to 2026-09-18, 863 of 1,873 iNaturalist observations ingested were Californian** — 46% of the steady state.

## Why this and not the alternatives 036 left open

[036](036-ingest-scope-killer-whales-range-wide.md) named the argument for leaving iNaturalist wide, from [027](027-marine-mammal-scope-whale-centric-identity.md): its non-cetacean records are the archive's only unique non-cetacean contribution. **That argument survives the purge completely.** 17,563 pinniped and 4,787 otter records sit *inside* the Salish Sea box and are untouched — harbour seals at 11,366, river otters at 4,237, Steller sea lions at 2,617, California sea lions at 2,625. What goes is Californian pinnipeds, which were never a Salish Sea contribution in the first place. 027's claim was about *taxa*, and no taxon that matters loses its Salish Sea records.

The bead's third option — apply the box to cetaceans only, keep pinnipeds and otters wide — is backwards on the numbers. It would drop 10,946 cetaceans, including the Johnstone Strait humpbacks, and keep 40,687 Californian pinnipeds and otters: the least relevant records retained, the more relevant ones discarded.

Widening `salishSeaExtent` instead was considered and is worse than it looks. [022](022-regions-filter-data.md) and [023](023-region-framing-vs-filtering.md) fixed that box as *the* filter box, and 036 tied the ingest rule to it precisely so the map's Salish Sea region and the ingest scope can never disagree about where the Salish Sea ends; widening it changes what the map shows, not just what we hold. And it would do nothing about the 42,493 Californian records, which are the actual problem.

## The costs, stated plainly

- **2,573 records north of 50.5°N go.** That includes Johnstone Strait — Telegraph Cove sits at 50.55, -126.83, outside on both bounds — which is the Northern Residents' core summer habitat. Orcas there are kept by the killer-whale clause; the humpbacks and Steller sea lions beside them are not. This is the same cost [036](036-ingest-scope-killer-whales-range-wide.md) accepted for Maplify, and it is the strongest argument for eventually revisiting the box rather than the rule.
- **662 records just south of the box** — the Washington outer coast, Westport and Grays Harbor. Genuinely Pacific Northwest, not Salish Sea.
- **99,348 photo rows** travel with the observations.

Nothing breaks: `public.identifications` is empty in production, so no identification referenced a doomed row.

## Why the DwC-A does not enter into it

[036](036-ingest-scope-killer-whales-range-wide.md)'s purge shrank the published archive by ~14,000 records, and weighing that was part of its decision. Here there is nothing to weigh: [005](005-export-exclusion-src-01.md) excludes iNaturalist from the export because it self-publishes to GBIF, so all 51,637 rows were invisible to the archive. The archive's geographic bounding box and its coverage statements are unchanged.

## Two predicates, one rule

Maplify's `isKillerWhale` matches names with a regex, because Maplify ships free text and upstream coins orca names freely. iNaturalist ships a taxon id and a root→self ancestor chain, and we mirror the taxonomy, so its `isKillerWhale` asks whether the record sits under the genus *Orcinus* (41520). That is exact where the other is approximate, and it catches `Orcinus orca` and all three subspecies (`ater`, `orca`, `rectipinnus`) without naming any of them — a fourth would be caught the day iNaturalist coins it.

A record filed under a *retired* taxon is judged by the ancestry upstream shipped with it, not by its replacement's — the [032](032-retired-taxa-resolved-on-read.md) posture, that a stored id records what was claimed. It is safe here rather than merely consistent: the genus and all four descendants are active, so no retirement in the mirror can move a record across the boundary this predicate draws.

The purge migration walks `inaturalist.taxa` downward from the genus instead of reading ancestry, because ancestry is not a stored column; the recursive CTE produces the same closure the live predicate reads off `ancestor_ids`. Verified on a fresh reset against seven synthetic records covering both box corners inclusively, a Californian orca (kept), a Johnstone Strait Bigg's subspecies (kept) and the Johnstone sea lion beside it (dropped).

## The mislabel is gone

`SALISH_SEA_BBOX` was never the Salish Sea — it was the Acartia box under a name that says otherwise, and it had already misled [036](036-ingest-scope-killer-whales-range-wide.md)'s first draft into thinking iNaturalist fetched narrowly. It is now `FETCH_BBOX`, derived from `acartiaExtent` in [src/extents.ts](../../src/extents.ts), so the box has one definition shared with Maplify and the name cannot lie again.

## Consequences

- **The "Everywhere" region stops being mostly Californian.** [022](022-regions-filter-data.md) already defaults the map to the Salish Sea, so nothing visible by default changes; what changes is that "Everywhere" now means everywhere we cover.
- **[PRODUCT.md](../../PRODUCT.md), the [README](../../README.md) and [CONTEXT.md](../../CONTEXT.md) become true for the whole corpus.** They said the rule was "applied to Maplify" with iNaturalist pending; that qualifier is gone.
- **Reversible, and cheaply.** [041](041-inaturalist-history-backfilled.md) built the repeatable backfill driver precisely so the depth of the mirror is an operation rather than an event: re-widening is a predicate change plus a walk of about 425 requests. The fetch box never narrowed, so upstream still serves everything we dropped.
- **The next tick of the cron cannot undo it.** `isIngestable` runs at parse, so an out-of-scope record never reaches reconcile; inside the rolling window it would be a delete, which is the same answer.

## Rejected

- **Leave iNaturalist wide.** 63% of the mirror, 46% of the daily intake, and a spatial-scope statement that is only true for one of two sources. 027's argument for it survives the purge intact, so it is not paying for anything.
- **Cetaceans only.** Backwards on the numbers; see above.
- **Widen `salishSeaExtent`.** Changes the map's region filter, and misses the actual problem.
- **Narrow the fetch box.** [036](036-ingest-scope-killer-whales-range-wide.md) rejected this and the reason is unchanged: the width is what holds the Southern Residents on their winter coast run. It would also make the ingest's scope a property of a URL rather than of a predicate with tests.
- **Filter in `public.occurrences` instead of deleting.** 036's first draft, rejected there, and the reasons hold: it leaves the mirror 63% out of scope forever, and every consumer of `inaturalist.observations` that is not that view needs the clause separately.

## Reference

The rule and its rationale: [036](036-ingest-scope-killer-whales-range-wide.md). Mirror contract: [008](008-source-schemas-are-upstream-mirrors.md). Why the export is unaffected: [005](005-export-exclusion-src-01.md). Predicates and tests: [scripts/ingest/inaturalist.ts](../../scripts/ingest/inaturalist.ts), [scripts/ingest/inaturalist.test.ts](../../scripts/ingest/inaturalist.test.ts). One extent: [src/extents.ts](../../src/extents.ts).
