# 041 — iNaturalist history is backfilled to the beginning, through our own ingest, within iNat's recommended practices

**Status:** accepted; both walks ran on 2026-09-18, see "What the walks landed" · **Decided:** 2026-09-11 · **Applies:** [011](011-ingest-imperative-shell.md), [018](018-inat-id-keyset-pagination.md) · **Context:** the mirror began at 2025-01-01, which is why every haul-out page ([040](040-haul-out-sites-list-first.md)) and presence grid has twenty months of history when the source has twenty years.

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

The first walk (2026-09-11, runs 38701 to 38708) stopped itself at the 1970s window because that window deleted a row, and the script treats any deletion in a historical window as a fault. The row was observation 386594579, which iNat dates 1969-12-31 at 4 pm Pacific — an epoch-zero artifact rather than a real 1969 sighting, as "What the walks landed" sets out, though that makes no difference to the mechanism. (The row is gone: [043](043-undated-observations-are-out-of-scope.md) treats an epoch-zero date as the undated record it is and drops it at ingest, so the 1960s window is now empty.) The 1960s window fetched it and the 1970s window did not, but its UTC instant is 00:00 on 1970-01-01, inside the 1970s window's delete bound. The reconcile compared a UTC instant against a local-date fetch.

That is not a backfill quirk. The same bound in the daily cron had been deleting every evening's observations eleven days after they were made, since the edge-function cutover on 2026-06-26: production's first eight UTC hours of every day older than the rolling window held zero rows, against five to twenty-four for days inside it or before the cutover. About ten rows a day, some 800 in all, plus four to nine at each month boundary of the July manual backfill. The fix (`salish-34s`) reconciles only a window's interior, `[start + 1 day, end)` in UTC, which no time zone can straddle; the rolling window's next tick covers the edge days it leaves.

The order of operations therefore became: merge and deploy the fix, re-run windows from mid-June 2026 to today so the deleted evening rows come back (a pure upsert restores them), then walk the history. Until the fix is deployed the cron keeps deleting about ten rows a day, all of them recoverable the same way.

The second walk (2026-09-18, after the reconcile fix shipped) cleared the pre-2010 decades and 2010 to 2012, then stopped in 2013: a photo on one observation carries `original_dimensions` with a null height and width, and the parse required numbers. The columns have been nullable since the initial schema and the composite cast stores the pair as `(,)`; only the parse and its payload type disagreed. Both now accept null.

Both halts are the same mechanism working as designed. The parse is deliberately strict because a silently dropped record becomes a reconcile delete-candidate ([008](008-source-schemas-are-upstream-mirrors.md)), so an unmodelled shape fails the whole window rather than losing a row — and twenty years of history exercises shapes that twenty months never did. Expect the walk to stop again on another such shape; that is the guard earning its keep, not a regression.

## Maplify too

Maplify's mirror begins on 2022-01-01 because the manual runs of 2026-07-06 began there; nothing recorded why. Its API returns sightings from 2014 (probed 2026-09-11 with whole-year windows: 461 in 2014, about 600 a year by 2018, about 1,400 a year in 2020 and 2021, nothing earlier; a single-year request may be capped, so these are lower bounds). The same driver walks it with `--source maplify` in monthly windows (`salish-9y6`). Two things differ from iNaturalist: Maplify publishes no rate limit, so one request a second is a courtesy rather than a rule; and its reconcile compares the same UTC `created_at` its API filters on, so the straddle above never applied to it. [036](036-ingest-scope-killer-whales-range-wide.md)'s scope rule applies at ingest, so historical rows land already filtered.

## What the walks landed

Both ran on 2026-09-18, after the reconcile fix and the null-dimensions fix deployed.

**iNaturalist** (`salish-5e0`, runs 42746 to 42835, about 425 requests): the decade/year/quarter/month plan above, 1900 to 2024-12-31, meeting the existing mirror at 2025-01-01. About 57,300 rows upserted and **no window deleted anything**. `inaturalist.observations` began at 2025-01-01 and now reaches 1976 — an elephant seal at Año Nuevo, entered by an observer in 2024 and dated by hand. The measured volumes tracked the preflight closely: 11,849 results across 2018 to 2020 against a predicted 11,845.

One row sat earlier, and it was not a 1969 observation. Observation 386594579 carries `observed_on_string` of `Wed Dec 31 1969 16:00:00 GMT -0800 (PST)`, which is `new Date(0)` printed in Pacific time: the observer uploaded an elephant seal at Pescadero in July 2026 and the date arrived as epoch zero. iNaturalist stores it as observed, we mirrored what iNaturalist stores ([008](008-source-schemas-are-upstream-mirrors.md)), so the mirror's minimum `observed_at` was exactly epoch 0 and meant nothing. [043](043-undated-observations-are-out-of-scope.md) settled it (`salish-4bi`): an epoch-zero date is an undated observation, it is dropped at ingest by the rule that already dropped null-dated ones, and that row was purged — so the 1976 above is the mirror's floor, not the artifact's. The DwC-A never saw it; [005](005-export-exclusion-src-01.md) keeps iNaturalist out of the export.

**Maplify** (`salish-9y6`, runs 42836 to 42935, about 192 requests): 2014-01-01 to 2021-12-31 monthly, meeting the 2022-01-01 floor, 1,280 rows upserted and again no deletions. One window (2018-01) returned HTTP 520 and succeeded on retry; the driver stops at the first failure, so a transient upstream error costs a restart at that window and nothing else.

Maplify's backfill is small next to iNaturalist's, and the reason is [036](036-ingest-scope-killer-whales-range-wide.md)'s scope rule applied at ingest — but the share it keeps climbs steeply with time: 13 rows kept of about 461 the API reports for 2014, 285 of about 1,360 for 2020, 734 of about 1,383 for 2021. So the early Maplify record is overwhelmingly out of scope, and the depth this adds to the aggregator's history is thinner than the row counts alone suggest. Why the kept share moves that much is not established here.

## Consequences

- The fetch box is still the Acartia extent, California to northern BC ([036](036-ingest-scope-killer-whales-range-wide.md)), so the backfill triples the Californian rows along with the Salish Sea ones: about 42,000 of the 62,000 lie outside the Salish Sea box. `salish-a4y.4` is the open decision on whether iNaturalist follows Maplify's scope rule; if it lands as a purge, the purge is one statement and this record does not change.
- The haul-out pages do not exist yet — decision 040 is still on the unmerged `haulout-pages` branch, which is why the link to it above is dead — so there is no `MIRROR_SINCE_YEAR` to re-pin. When they are built, the presence grid should derive its span from the data rather than assume 2025. Noted on `salish-4pr`.
- A window's `ingest.runs` row carries `trigger = 'manual'`, so the heartbeat and the deploy gate are unaffected, and the backfill is auditable run by run.
