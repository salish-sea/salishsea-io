# 041 — iNaturalist history is backfilled to the beginning, through our own ingest, within iNat's recommended practices

**Status:** accepted · **Decided:** 2026-09-11 · **Applies:** [011](011-ingest-imperative-shell.md), [018](018-inat-id-keyset-pagination.md) · **Context:** the mirror began at 2025-01-01, which is why every haul-out page ([040](040-haul-out-sites-list-first.md)) and presence grid has twenty months of history when the source has twenty years.

## Decision

Every licensed, open-geoprivacy iNaturalist observation of an in-scope taxon in the fetch box is backfilled, as far back as observers have dated them, by walking date windows through the **same ingest function the cron uses** (`supabase/functions/ingest`), invoked as a curator does (its [README](../../supabase/functions/ingest/README.md)). Nothing new touches iNaturalist: the function's fetch, completeness rules and reconcile apply unchanged to each historical window.

The walk is [`scripts/backfill/inat-history.ts`](../../scripts/backfill/inat-history.ts). It exists so the depth of the mirror is a repeatable, recorded operation rather than a one-off: it cuts a range into windows, paces them, stops at the first failed window, and refuses to continue if a window deletes anything, because a historical window has nothing stored to reconcile against and should be pure upsert.

## What iNaturalist asks, and how this fits

iNaturalist's [API recommended practices](https://www.inaturalist.org/pages/api+recommended+practices) (revised 2025-02-27) and the API description say, in their words: throttled to a max of 100 requests a minute, please keep to 60 or fewer, and under 10,000 a day; a query needing more than 10,000 results "would be considered a bulk request, which are not best handled by the API"; for bulk, use the observation export tool, the weekly GBIF dataset, or the AWS Open Dataset; and, for fetching many records through the API, sort by id ascending and page with `id_above`, "essentially the same recommendation as above to change search parameters".

The fit, measured on 2026-09-11 with `per_page=0` preflight queries:

| Years | Observations in the fetch box | Window used |
|---|---|---|
| before 2010 | 1,561 | one per decade |
| 2010 to 2017 | 9,224 | one per year (largest 2,445) |
| 2018 to 2020 | 11,845 | one per quarter |
| 2021 to 2024 | 37,760 | one per month (largest about 2,000) |

About 62,000 observations in all, at 200 a page: roughly 350 requests, paced to at most one a second, spread over an hour. No window approaches 10,000 results, so none is a bulk request by iNat's definition; the sweep within a window is the `id_above` walk they recommend ([018](018-inat-id-keyset-pagination.md)); and the day's total is a small fraction of the daily allowance. The bulk alternatives were considered and rejected below.

## Why through the ingest, and not a bulk dataset

**The mirror must be one thing.** [008](008-source-schemas-are-upstream-mirrors.md) makes `inaturalist.observations` a mirror of what the API returns under one set of filters. A second loading path with its own filters, field set and licence handling would make the table two things, and the daily cron's reconcile would then delete or rewrite whatever the other path loaded differently. Loading history through the same function makes a 2012 row and a 2026 row indistinguishable in provenance.

**The volume is small.** 62,000 records is an afternoon at iNat's asked-for pace. The bulk routes exist for orders of magnitude more.

## Rejected

- **The AWS Open Dataset.** Bulk, monthly, CC-licensed observations only. It would need its own loader and would not carry `updated_at`, `public_positional_accuracy` or `orcid` the way the API projection does; it is the right tool at a scale we are far below.
- **GBIF's weekly dataset.** Research-grade only. Most pinniped and otter reports are not research grade, and those are the records [027](027-marine-mammal-scope-whale-centric-identity.md) values iNaturalist for.
- **The observation export tool.** A logged-in, hand-driven CSV; not repeatable from a script, and the same second-loader problem.
- **Widening the daily window instead.** The cron's ten-day window is sized for a few hundred records; a window that reaches 2005 would re-fetch 62,000 records nightly for no reason.

## What the first run found

The first walk (2026-09-11, runs 38701 to 38708) stopped itself at the 1970s window because that window deleted a row, and the script treats any deletion in a historical window as a fault. The row was observation 386594579, made at 4 pm Pacific on 1969-12-31: iNat dates it 1969-12-31, so the 1960s window fetched it and the 1970s window did not, but its UTC instant is 00:00 on 1970-01-01, inside the 1970s window's delete bound. The reconcile compared a UTC instant against a local-date fetch.

That is not a backfill quirk. The same bound in the daily cron had been deleting every evening's observations eleven days after they were made, since the edge-function cutover on 2026-06-26: production's first eight UTC hours of every day older than the rolling window held zero rows, against five to twenty-four for days inside it or before the cutover. About ten rows a day, some 800 in all, plus four to nine at each month boundary of the July manual backfill. The fix (`salish-34s`) reconciles only a window's interior, `[start + 1 day, end)` in UTC, which no time zone can straddle; the rolling window's next tick covers the edge days it leaves.

The order of operations therefore became: merge and deploy the fix, re-run windows from mid-June 2026 to today so the deleted evening rows come back (a pure upsert restores them), then walk the history. Until the fix is deployed the cron keeps deleting about ten rows a day, all of them recoverable the same way.

## Consequences

- The fetch box is still the Acartia extent, California to northern BC ([036](036-ingest-scope-killer-whales-range-wide.md)), so the backfill triples the Californian rows along with the Salish Sea ones: about 42,000 of the 62,000 lie outside the Salish Sea box. `salish-a4y.4` is the open decision on whether iNaturalist follows Maplify's scope rule; if it lands as a purge, the purge is one statement and this record does not change.
- The haul-out pages' presence grid, pinned to 2025 (`MIRROR_SINCE_YEAR` in `src/haulout-page.ts`), should be re-pinned or derived once the backfill has landed.
- A window's `ingest.runs` row carries `trigger = 'manual'`, so the heartbeat and the deploy gate are unaffected, and the backfill is auditable run by run.
