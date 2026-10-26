# 090 — The read-path build is two Stelis projects, built one after the other under the lock

**Status:** accepted · **Decided:** 2026-10-26 · **Work:** bd `salish-mee7` (Stelis `st-mxr.1.2`) · **Follows:** [Stelis ADR 0019](https://github.com/rainhead/stelis/blob/298648294ccf84a246da01ff15dbe16e296b9f9b/docs/adr/0019-one-state-dir-per-concurrent-build.md) · **Amends:** [061](061-ingest-and-derivation-move-into-the-build.md), [065](065-the-store-and-write-api.md), [066](066-a-deploy-takes-the-build-lock-and-the-machine-stops-its-writers.md)

## Context

A sighting saved while the five-minute scheduled build is running waits for the build lock. Since 065's amendment of 2026-10-25 the save's build asks the scheduled build to yield at its next task boundary, but the scheduled build's longest tasks are the four source ingests, which fetch over the network and must not be stopped part way. On 2026-10-26 a save landing during an ingest waited 22 s for it. The way past that is for the ingests not to hold the lock a save needs.

Stelis's unit of one writer is the state dir: two builds that may overlap need a state dir each, which means two projects. So Stelis split salishsea's graph ([ADR 0019](https://github.com/rainhead/stelis/blob/298648294ccf84a246da01ff15dbe16e296b9f9b/docs/adr/0019-one-state-dir-per-concurrent-build.md)) into `salishsea-ingest`, the four ingests (Maplify, Orcasound, iNaturalist and the register), and `salishsea`, everything from the snapshot on, which reads the mirrors and the register as data someone else wrote. From Stelis 2986482 on, a build of `salishsea` runs no ingest at all, so the pin cannot move to it until our schedule builds both projects. The pin moving also brings Stelis's guard against history records it could not read back (`st-abp`) and a cheaper decision for the directories a build has just written (`st-mxr.2`).

## Decision

1. **The scheduled build runs `salishsea-ingest`, then `salishsea`, both under `/data/build.lock`.** [`fly/build.sh`](../../fly/build.sh) holds the lock across both, so nothing overlaps yet and the machine's memory budget is unchanged. Each project has its own state dir: `salishsea` keeps `/data/stelis` and its history, since its name is unchanged, and `salishsea-ingest` gets `/data/stelis-ingest`. Stelis refuses a state dir that holds another project's builds.
2. **A save's build runs `salishsea` only**, as it already ran only the snapshot and what derives from it. It puts the yield request in both state dirs, because either project may be running when it arrives.
3. **An ingest that fails doesn't stop the derive build.** The derive build reads each mirror as the last good fetch left it, as a save's build always has. In one graph, a failed ingest kept everything downstream of its mirror from running, the manifest included. The Sentry check-in keeps that meaning: it reports `error` when an ingest failed as well as when the manifest wasn't rewritten.
4. **Not yet: the ingests outside the lock.** Two things have to be true first. The register must leave the snapshot DuckDB file, which `ingest-register` writes and `ingest-inaturalist` reads, and which DuckDB lets only one process open while a writer holds it (`salish-vedj`). *(Done 2026-10-26: the register is a file of its own, [064](064-what-users-do-not-write-leaves-postgres-first.md) as amended, and the ingests run outside the lock on a 2 GB machine, [091](091-a-save-never-waits-for-an-ingest.md).)* And two overlapping builds must be measured against the machine's 1 GB. That step is `salish-uh0y`.

## Rejected alternatives

- **Keep the pin at 144c99f until the ingests can run outside the lock.** Every Stelis change from then on would wait for the register move and a memory measurement, and the split is needed for both anyway.
- **Run the derive build only when every ingest succeeded.** One flaky source would then hold up the other sources and every save. A save's build has always derived from the mirrors as they were.

## Consequences

- Latency is unchanged until `salish-uh0y`: the ingests still hold the lock while they run.
- Operator commands about an ingest name its project and its state dir: `STELIS_STATE_DIR=/data/stelis-ingest racket src/main.rkt --project /app/stelis/salishsea-ingest.rkt --explain --last` ([runbook](../runbook/read-path-build.md#looking-at-the-machine-take-a-lock-first)).
- In `salishsea`, `--why` stops at a mirror ("maplify_mirror.sightings changed"); the ingest project's history says why the mirror changed. Following a why across the cut is Stelis `st-mxr.1.3`.
- The first scheduled build after the deploy starts `salishsea-ingest` with an empty history. The ingests fetch on every run anyway, so it costs nothing.
