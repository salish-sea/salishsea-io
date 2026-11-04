# 108 — The read-path build moves to DuckDB 2.0

**Status:** accepted · **Decided:** 2026-11-04, by Peter ("I'm comfortable moving this project to duckdb 2") · **Work:** bd `salish-vyq7`, measured under `salish-mvzg`

## Context

The read-path build runs every DuckDB step in Node through `@duckdb/node-api`, and Stelis digests the build's relations with the DuckDB command-line program; both were on 1.5 (the library 1.5.4-r.1, the program 1.5.5). DuckDB 2.0.0 and `@duckdb/node-api` 2.0.0-r.1 came out on 2026-10-21. Which release line Peter's projects share is undecided across them (workbench `workbench-gp3`); this record is SalishSea.io's choice alone.

The machine has 2 GB and no swap, shared by the services, the ingest build and a derive build ([091](091-a-save-never-waits-for-an-ingest.md)), so the build's peak memory is what matters most. On 2026-11-04 production's own log put the peak at `derive-occurrences`, 719 MB under 1.5.

## Decision

The library and the command-line program move to 2.0 together, in one change: `@duckdb/node-api` 2.0.0-r.1 in `package.json`, and the 2.0.0 program in [`fly/downloads.tsv`](../../fly/downloads.tsv), which 2.0 ships as a `.tar.gz` rather than a `.zip`, so the [Dockerfile](../../fly/Dockerfile) unpacks it with `tar`. Nothing else changes: every step keeps its `memory_limit`, its one thread and its spill directory ([`duckdb-budget.ts`](../../scripts/read-path/duckdb-budget.ts)).

## Measured

On Hostess (Linux), from a copy of production's inputs taken 2026-11-04, three full builds per version (`salish-mvzg` has every task's figures):

- **Memory.** The build's peak fell by about a quarter, from 836 MB to 620 MB. The steps that do most in DuckDB fell most: `derive-occurrences` by a third (836 to 558 MB), `derive-profile-links` by a quarter. Steps that do little in DuckDB rose 20 to 30 MB each, which looks like a larger library at start. `individual-pages` becomes the largest step, at 620 MB.
- **Time.** The same, about 40 s for a full build.
- **What it publishes.** The same. Of 9,279 files, the ones that differ are the GeoParquet file (same rows and `geo` metadata, a different writer named inside it), its checksum, the manifest's snapshot time, and one entry in the search index, J62's latest sighting, where two sightings share a moment and nothing breaks the tie (`salish-5t0v`).
- **The switch in place.** Over a volume a 1.5 build had written, 2.0 opened the snapshot and the register, reran every task once, and then settled to the three tasks that run every build. A 1.5 build over what 2.0 had written also succeeded, so rolling back is redeploying the earlier image, with nothing to delete.

## What 2.0 changed that this repo meets

- **Its new parser reads two JSON arrows followed by an operator differently:** `doc->'taxon'->>'scientific_name' IN (…)` binds as `doc -> (('taxon' ->> 'scientific_name') IN (…))` and fails. The one such line is parenthesised (#837, `salish-gcww`), which means the same under 1.5. The twin-fixture test in `derive-occurrences.test.ts` fails without it.
- **The regex operators `~` and `!~` now match part of a string, as Postgres's do, not all of it** ([duckdb#23432](https://github.com/duckdb/duckdb/pull/23432)). This repo uses neither; a query that does would change its results without an error, so write `regexp_full_match` or `regexp_matches` instead.
- **The command-line program has an "agent mode"**, on when `AI_AGENT` or `CLAUDECODE` is set and its output isn't a terminal, which changes its default output format and how it prints errors. Stelis asks for `-noheader -list` explicitly, which agent mode leaves alone; a build run with both variables set behaved exactly as one without. A script that parses the program's default output would not.

## Consequences

The command-line program here is now on 2.0 while Stelis's own CI and BeeAtlas pin 1.5.5, which departs from the workbench practice that they share a release (`practices/duckdb.md`). Stelis's use of the program is one read-only query shape, and the measured builds ran it under 2.0 throughout.

## Rejected

- **Staying on 1.5 until every project moves.** The memory is the reason to move, and this machine is the one where it is tightest. Nothing else depends on this repo's version.
- **Moving the library alone.** The program and the library move together: a newer program can write a file the library can't read (workbench `practices/duckdb.md`, from Beeline).
