# 082 — HappyWhale leaves the build until a live feed is worth building

**Status:** accepted · **Decided:** 2026-10-21, by Peter · **Relates:** [064](064-what-users-do-not-write-leaves-postgres-first.md) (its tables became a frozen file on the volume), [061](061-ingest-and-derivation-move-into-the-build.md) (the build owns ingest), `salish-v5s` (a live HappyWhale feed, if HappyWhale grants API access)

## Context

HappyWhale's humpback encounters, 2012 to April 2025, reached the site through an in-database loader that stopped being called before the read-path build took over ingest (decision 061). Since decision 064 they have been five tables in one DuckDB file on the Fly volume, `/data/mirrors/happywhale.duckdb`, exported once from Postgres, read every build and written by nothing. The build derived an occurrence from each encounter and the map showed them.

That file was the one input the build could not get again. The mirrors are rebuilt by a backfill, the store is replicated by Litestream, the reference tables and the catalogue are checked in, and the register is fetched from its releases. HappyWhale's file had only the volume's five days of snapshots and Postgres's final dump behind it, and no source to ask: the loader is gone and the live feed waits on API access that has not been granted (`salish-v5s`). Carrying it meant carrying a dead arm of the occurrences derivation, five fixture tables in the twin test, three reference rows and a line on the about page, all for data that stopped in April 2025 and would have to be ingested afresh when a feed exists.

## Decision

HappyWhale comes out of the build whole: the Stelis task and artifact (`rainhead/stelis` 340fca4b), the loader and its one-time exporter, the `happywhale` arm of `derive/occurrences.sql` and the time-zone macro only it used, its five tables in the twin fixture, its provider, collection and `accuracy` enum rows in `data/reference/`, and its credit on the about page. The file on the volume is copied to `s3://salishsea-io-backups/` before it is deleted, beside Postgres's final dump (`final/postgres-2026-10-09/`), which holds the same tables.

The Darwin Core archive is unchanged: it never carried HappyWhale records (SRC-01, [data-provenance](../data-provenance.md)), and the rule stands for when a feed brings them back. The archive's text still names HappyWhale among the excluded platforms, which is true.

## Consequences

- The map loses the 2012–April 2025 humpback encounters. Nothing else on the site read them.
- A `?o=happywhale:<id>` link no longer resolves: the id index is built from the occurrences, and those ids are not among them. No such link is known to be published anywhere but the site's own share cards, which expire with their pages.
- The volume holds nothing the build cannot get again except the store and the name guard's baseline (`salish-5jxb` moves the baseline into git).
- Bringing HappyWhale back is `salish-v5s`'s work, an ingest like the other three: a mirror the build fetches itself, a boundary task, and an arm of the derivation written against what the API gives, not against the frozen tables' columns.
