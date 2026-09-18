# 043 — An undated observation is out of scope, however the absence is spelled

**Status:** accepted · **Decided:** 2026-09-18 · **Applies:** [008](008-source-schemas-are-upstream-mirrors.md), [036](036-ingest-scope-killer-whales-range-wide.md) · **Context:** found by the [041](041-inaturalist-history-backfilled.md) backfill

## Decision

**An iNaturalist observation whose date is the Unix epoch to the second is treated as undated, and is not ingested.** The rule is enforced in the functional core, in `parseInatResponse` ([scripts/ingest/inaturalist.ts](../../scripts/ingest/inaturalist.ts)), beside the rule that already skips `time_observed_at === null`; the one record already held was deleted in one pass ([migration 20260918200000](../../supabase/migrations/20260918200000_purge_epoch_zero_inat_observation.sql)).

This is not a new rule. The ingest has always declined undated observations. This is the same absence arriving with a value in front of it.

## The record

iNaturalist observation [386594579](https://www.inaturalist.org/observations/386594579) is an elephant seal photographed at Pescadero, California, and uploaded on 2026-07-30. What the observer's client sent as the date was:

```
observed_on_string : "Wed Dec 31 1969 16:00:00 GMT -0800 (PST)"
observed_on        : "1969-12-31"
time_observed_at   : "1969-12-31T16:00:00-08:00"
```

That string is `new Date(0).toString()` in Pacific time — a JavaScript date object that was never given a date, stringified and submitted. iNaturalist parsed it, believed it, and serves the observation research-grade and unflagged to this day. [008](008-source-schemas-are-upstream-mirrors.md) makes our source schemas mirrors of what the API returns, so `inaturalist.observations` held exactly one row at `1970-01-01T00:00:00Z` and `min(observed_at)` over the whole mirror was that row.

The genuine earliest record is six years and a month later: observation 203014813, an elephant seal at Año Nuevo on 1976-02-01, entered by an observer in 2024 and dated by hand. *(That row is itself gone now. Año Nuevo is in California, and [044](044-inat-ingest-scope.md) purged it hours later along with everything else out of scope — an elephant seal 700 miles south is not a Salish Sea record however carefully it was dated. The mirror's floor is 1978-09-15, at Race Rocks. It does not change the argument here: an epoch-zero date is not a date whatever the second-oldest row happens to be.)*

## What it cost, and what it did not

The damage is that the depth of the record could not be stated. After [041](041-inaturalist-history-backfilled.md) the honest sentence was "our iNaturalist mirror reaches 1976"; the artifact made it "1970" — six years too deep, and those six years are a client bug rather than anything anyone saw. Six years is not a large error in itself; what makes it worth fixing is that it is indistinguishable from a fact, so the number would have been quoted.

Two things the artifact did **not** reach, both checked rather than assumed:

- **The DarwinCore Archive.** Its `eventDate` range is 2014-04-20 to today, because the export has only the `native` and `maplify` branches — [005](005-export-exclusion-src-01.md) excludes iNaturalist. The EML's temporal coverage was never affected.
- **The map and the calendar.** Every date control is floored at `EARLIEST_OBSERVATION_DATE` (2000-01-01) in [src/constants.ts](../../src/constants.ts), a hardcoded bound, not a derived one, so the row was unreachable through the UI.

So the fix is for the statistic and for everything that will one day derive from it — a presence grid, an "earliest sighting", a coverage statement — not for a visible defect today.

**The other three sources are clean**, measured against production on 2026-09-18: `maplify.sightings` begins 2014-04-20, `happywhale.encounters` 2012-07-11, `public.observations` 2025-06-16, and none holds a row at the epoch. The rule is added to the iNaturalist ingest only, where the artifact is.

## Why at ingest, and why this does not breach 008

[036](036-ingest-scope-killer-whales-range-wide.md) already settled the general question and settled it this way: 008's claim is that mirror *columns* carry upstream semantics and must not leak downstream, not that the mirror must hold every row upstream returned. `isIngestable` drops out-of-scope Maplify sightings; `parseInatResponse` has dropped `time_observed_at === null` records since the edge-function cutover. The mirror was always a filtered subset, and a pure predicate over a normalized record is where this repo puts a filter.

Filtering here rather than on read also fixes the thing that was actually wrong. The complaint is about `min(observed_at)` over `inaturalist.observations`; a `WHERE` clause in `public.occurrences` would hide the row from the map and leave that number at 1970. And `public.occurrences` is three views deep already, with consumers of the mirror that do not go through it.

## Why equality with the epoch, and not a plausibility floor

A floor — "nothing before 1970", "nothing before 1950" — has to guess where real history stops, and the guess is wrong in the expensive direction. The 1960s are exactly when the photographs someone might one day scan and upload were taken: Moby Doll in 1964, Namu in 1965. A floor would swallow such a record silently, and silently is the whole problem with the artifact it is meant to catch.

Equality can only ever drop a record dated to the one second that is indistinguishable from the artifact. It is tested against the **instant**, not the rendered local date, so it catches every time zone's spelling of the same zero: west of Greenwich the observation reads 1969-12-31, east of it 1970-01-01, and both parse to 0.

If upstream ever produces a *different* serialization artifact — a zero rounded to local midnight, say — it will arrive as an obviously-wrong date rather than as a silent one, and it can be named then. Guessing at the shape of the next one now buys nothing.

## Consequences

- The mirror's earliest observation becomes a fact about the record rather than about a client bug. It was 1976-02-01 when this was decided and is 1978-09-15 now, [044](044-inat-ingest-scope.md) having purged the Californian row above it; what this record fixes is that the number means something, not what the number is.
- A re-run of the [041](041-inaturalist-history-backfilled.md) history walk no longer re-admits the row: the 1960s window now fetches it and drops it at parse, so the window is empty and reconciles to nothing. This closes the loop on the halt that walk hit — the record that stopped the first run on 2026-09-11 is the record this removes.
- The skipped record still counts toward `recordCount` and still advances the keyset cursor, exactly as the null-date skip does. Completeness ([011](011-ingest-imperative-shell.md), [018](018-inat-id-keyset-pagination.md)) is untouched: `total_results` counts the record upstream, so the page arithmetic must too.
- Nothing is lost that upstream does not still serve. The observation remains at its iNaturalist URL, and if the observer ever corrects the date it will be ingested on the next walk of whatever window it lands in.
- **This record is not the scope question.** The Pescadero seal is also outside `salishSeaExtent` and is not a killer whale, so [036](036-ingest-scope-killer-whales-range-wide.md)'s rule would delete it too if that rule were applied to iNaturalist — which is open, argued both ways, and carried by `salish-a4y.4`. Two independent defects happen to meet in one row; this decision fixes the date one, for every record, and takes no position on the other.

## Rejected

- **Leave it.** One row, no visible symptom today, and the number is only six years out. But it is the one number a reader would quote — how deep the record goes — and it looks authoritative while being an artifact of somebody's browser.
- **Filter on read, in `public.occurrences`.** Hides the row from the map and leaves `min(observed_at)` over the mirror at 1970, which is the complaint. Adds a fourth level to a view that is already three deep, and misses every consumer of the mirror that is not that view. This is the alternative [036](036-ingest-scope-killer-whales-range-wide.md) rejected, for the same reasons.
- **Flag it rather than drop it** — a nullable `date_quality` column, or a boolean on the mirror. It puts a judgment of ours into a table whose contract is that it holds upstream's, which is the leak 008 forbids in the other direction; and every reader would then have to remember to honour the flag, which is how the artifact would go on being read.
- **A plausibility floor.** See above.
- **Correct the date.** We do not know what it should be. The upload date is 2026-07-30 and the photograph is of a July 2026 seal, but inferring an observation date from an upload date invents a fact; [032](032-retired-taxa-resolved-on-read.md) is the standing position that we do not silently rewrite what a person claimed.
- **Flag it upstream on iNaturalist.** Worth doing on its own account, and it does not help: the record would stay in the API until a curator acted, and our ingest still has to decide what to do with a date that is not one.

## Reference

Mirror contract: [008](008-source-schemas-are-upstream-mirrors.md). Ingest-time filtering precedent and the 008 reading it rests on: [036](036-ingest-scope-killer-whales-range-wide.md). Where the row came from: [041](041-inaturalist-history-backfilled.md). Predicate and its tests: [scripts/ingest/inaturalist.ts](../../scripts/ingest/inaturalist.ts), [scripts/ingest/inaturalist.test.ts](../../scripts/ingest/inaturalist.test.ts).
