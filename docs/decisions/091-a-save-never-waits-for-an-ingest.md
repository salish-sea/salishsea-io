# 091 — A save never waits for an ingest: the ingests run outside the build lock, on a 2 GB machine

**Status:** accepted · **Decided:** 2026-10-26 · **Work:** bd `salish-uh0y` (Stelis `st-mxr.1`) · **Follows:** [090](090-the-read-path-build-is-two-stelis-projects.md) · **Amends:** [066](066-a-deploy-takes-the-build-lock-and-the-machine-stops-its-writers.md)

## Context

A sighting saved while the scheduled build is fetching the sources waited for the fetch. On 2026-10-26 a save waited 22 s behind one; the iNaturalist fetch alone takes about 11 s. Since [090](090-the-read-path-build-is-two-stelis-projects.md) the fetches are a Stelis project of their own, `salishsea-ingest`, and since 064's amendment of the same day the register is a file of its own, so no fetch opens the snapshot DuckDB file. What still kept the fetches under the build lock was that nobody had shown a build could read what they write while they write it, or that the machine had the memory for both at once.

Measured on the machine during one scheduled build, 2026-10-26, which still ran the two halves one after the other: with the API, Caddy, Litestream and the redirect server idle, about 615 MB of the 1 GB was available. The fetch half took up to about 165 MB more (its engine about 100 MB, `ingest-register` or `ingest-inaturalist` about 150 MB). The derive half took up to about 505 MB (`derive-occurrences` at about 420 MB, its engine about 130 MB). A save's build that runs beside the fetches doesn't re-derive only the native sightings: a fetch that has just committed new Maplify or iNaturalist rows makes it re-derive those too, so the full 505 MB beside the fetches' 165 MB is the case to plan for, and it doesn't fit in 615.

## Decision

1. **The fetches run under a lock of their own, `/data/ingest.lock`, not the build lock** ([`fly/build.sh`](../../fly/build.sh)). A scheduled build takes it first and holds it to the end, so one never starts while the last is running, then takes the build lock for `salishsea`, waiting up to two minutes, since a save's build is short. A save's build takes only the build lock, so it never waits for a fetch; it still asks a running `salishsea` build to yield at its next task.
2. **The mirrors a fetch updates in place are SQLite in write-ahead-log mode** (Maplify and iNaturalist). Tested on 2026-10-26: under the default rollback journal, DuckDB's SQLite reader waits out a writer's commit; in write-ahead-log mode it reads the last commit at once. Orcasound's mirror and the register's file are written beside and renamed over, so a reader keeps the file it opened.
3. **No fetch is handed the snapshot file**, which a Stelis test holds: `ingest-register` loses `--retire-from`, now that the register has moved on the machine.
4. **A deploy takes both locks**, the fetch lock and then the build lock, the order a scheduled build takes them in, so it waits out a running fetch as 066 waits out a running build ([`fly/deploy.sh`](../../fly/deploy.sh)).
5. **The machine has 2 GB** (`fly.toml`), Peter's call, so the overlap has about a gigabyte of headroom and the derive build alone no longer runs with 110 MB left. The DuckDB caps per script stay as they are: they bound each task, which matters more when two builds share the machine.

## Rejected alternatives

- **Swap on the 1 GB machine.** No added cost, but the worst moment would page instead of failing, and a machine already down to 110 MB in a lone derive build stays that tight.
- **Ship everything but the overlap.** A save would go on waiting for a running fetch, which is the whole of what this decision was for.
- **Let a save's build skip the mirrors the fetches are writing.** The derive graph reads each mirror as an input; holding a save's build to the mirrors the last scheduled derive build saw would need the engine to pin inputs to an earlier build, for a gain the extra memory buys more simply.

## Consequences

- A save waits at most for the task the scheduled `salishsea` build is on: under two seconds for most, about nine for the Darwin Core archive.
- Operator commands take the lock of what they touch: `/data/ingest.lock` for an ingest or a mirror (a backfill), `/data/build.lock` for `salishsea` or the snapshot, both for a measurement that needs the machine to itself ([runbook](../runbook/read-path-build.md#looking-at-the-machine-take-a-lock-first)).
- A derive build may record a mirror's digest from just before a fetch commits and derive from just after, and two of its tasks may read a mirror at different moments. The next build sees the digest move and re-derives, so the cost is files a build apart for one build and one extra run, never a file left stale.
