# 056 — What a logged-out visitor reads is built as static files, from an hourly snapshot of the database

**Status:** accepted; first slice built, and the map reads it under `VITE_READ_SOURCE=static` · **Decided:** 2026-09-27 · **Answers:** the direction and format questions in `salish-t3g`, and the sequencing half of `salish-9uu` · **Amends:** [002](002-static-spa-edge-architecture.md) (for logged-out reads, PostgREST stops being the backend)

## Context

On 2026-08-28 the database stopped accepting connections and salishsea.io served nothing to anyone. The map, the calendar and every profile page query PostgREST on every load, so a database that can't answer is a site that can't render. On 2026-08-31 and 09-01 two visitors got "Couldn't load sightings" because a routine five-minute refresh was holding the database when they arrived (`salish-xfo`). [055](055-occurrences-are-stored-not-assembled.md) removed that refresh, but not the dependence: a logged-out visitor still needs Postgres to be up and idle at the moment they load the page.

Everything such a visitor sees changes at most a few times an hour, and it is the same for everyone. `salish-t3g` argued that it should be computed once and served as files, and that this should come *before* leaving Supabase rather than after. Row-level security, `auth.uid()` and PostgREST together are this site's backend, which is what makes leaving Supabase hard (`salish-9uu`). Taking the reads off PostgREST leaves only a small write API to move.

The build is done by [Stelis](https://github.com/rainhead/stelis), the build engine that already builds [BeeAtlas](https://github.com/rainhead/beeatlas) this way. Both projects have the same owner. salishsea is Stelis's second project, which is why part of this record's evidence lives in that repository.

## Decision

**The files are built from a snapshot, never from the live database.** A build starts by copying what the pages read out of Postgres into a local DuckDB file, and everything after that reads the copy. So a build's inputs hold still while it runs, and the same snapshot always builds the same files. Stelis content-addresses the snapshot. When nothing in Postgres changed, the copy digests the same and nothing downstream is rebuilt, so a quiet hour costs one read and no writes. This is the waste [055](055-occurrences-are-stored-not-assembled.md) found in the five-minute refresh, which recomputed everything when about one tick in five had changed anything.

**Postgres serializes the rows.** Each row is copied as `to_jsonb(row)`, the serializer PostgREST itself uses. The files therefore carry exactly the shape the frontend already parses, composite columns (`location`, `taxon`, `photos`) and timestamp format included. Reading column by column would have meant DuckDB's Postgres reader mapping our composite types, and the frontend's types would then have to match a second serialization.

**The snapshot reads production hourly, through a role that can read only what is published.** Once an hour, not every five minutes, while this is a prototype. Proving the build and measuring its cost don't need production freshness, and hourly reads of a few relations are served mostly from cache. The read-only role is granted only the relations being published, so contributors' email addresses and feedback reports never reach the build machine. The role is `read_path` (migration `20260928130000_read_path_role.sql`). Its password is set out of band, like the ingest role's, and [`supabase/read-path-grants.test.ts`](../../supabase/read-path-grants.test.ts) pins everything it can reach. That turned out to include pg_net's request queue, which Supabase grants to every role and we can't revoke (`salish-p3m2`).

**The map reads one file per Pacific day.** Each file holds every occurrence that day, newest first, and is what `fetchOccurrences` returns for that day with no region selected. The browser applies the region, so the seven regions don't multiply the files. A day is Pacific midnight to midnight in `PST8PDT`, the frontend's own definition in `dateFromObservedAt`. A test in [`scripts/read-path/occurrence-days.test.ts`](../../scripts/read-path/occurrence-days.test.ts) places occurrences on both sides of midnight on both daylight-saving change days and checks that the build and the frontend agree about which file each belongs in. A day with no occurrences has no file.

The other logged-out reads follow the same pattern and are not built yet:

- the calendar reads counts per day per region
- sighting cards read the catalogue as whole-table files
- profile pages read one occurrence list per individual, group, ecotype and haul-out

**Four steps, each shippable on its own:**

1. Build the read path from a snapshot of Supabase. The first slice, the day files, is built.
2. Serve the files from a Fly app named `salishsea-io`. The frontend reads them behind a build-time switch, `VITE_READ_SOURCE=supabase|static`, merged to `main` with production still set to `supabase`. The realtime broadcast becomes the browser checking an uncached manifest for a new hash of today's file.
3. Move ingest into the build. The ingest's pure transforms ([011](011-ingest-imperative-shell.md)) write snapshots instead of Postgres, and the five views behind `derived.occurrences` are ported to DuckDB and checked row for row against the stored table until they agree.
4. Move writes and sign-in. This is the only step that waits on the identity conversation with Orcasound.

**The Fly app is named for what it becomes.** It is called `salishsea-io`, not after static files. It ends up running the file server, the build, the write API and sign-in on one machine, the shape BeeAtlas chose in its [ADR 0042](https://github.com/rainhead/beeatlas/blob/6c37583f4495bd98d4046d73e588fb3ad0fac0ca/docs/adr/0042-beeatlas-moves-to-fly-as-one-stateful-machine.md). Until DNS points at it, it is the prototype; at the step-2 cutover the same app becomes production.

**Share links keep the Supabase lookup for now.** A `?o=<id>` link still asks PostgREST which day the occurrence is on. What replaces that lookup is open, with one constraint: the URL in the address bar must remain the link people share, so no "copy link" button that people have to find. One candidate keeps `?d=` next to `?o=` as a hint, with a lookup as fallback. That would amend [002](002-static-spa-edge-architecture.md)'s rule that links encode only the occurrence id.

## Measured

On production data mirrored locally on 2026-09-27: 63,494 occurrences became 4,395 day files (70 MB).

- A full build took 6.7 s. A build where the database hadn't changed took 4.3 s, most of it the snapshot rereading Postgres, and skipped the day files.
- Two builds from one snapshot produced byte-identical files.
- The day files matched PostgREST's answer exactly, rows and order, on:
  - the three busiest days (114, 110 and 110 occurrences)
  - all four daylight-saving change days of 2024–25
  - a day with a single occurrence

## Rejected alternatives

- **One SQLite or Parquet file the browser queries.** `salish-t3g` weighed this: one artefact serves every view with no per-view design. It is rejected for the map because every hourly change would replace the whole file for every visitor, while a day file changes only on the days that moved. It is also rejected because of what querying in the browser costs. BeeAtlas measured it: [its ADR 0003](https://github.com/rainhead/beeatlas/blob/6c37583f4495bd98d4046d73e588fb3ad0fac0ca/docs/adr/0003-client-query-engine-wa-sqlite.md) rejected DuckDB-WASM on page weight. These reads are plain JSON and need no query engine at all.
- **Build from the nightly backup instead of the live database.** It puts no load on production and gives a fixed snapshot to test against. It is rejected for three reasons:
  - A backup is plain SQL, so restoring it takes a full Postgres with PostGIS, pg_cron, pg_net and Vault on the build machine.
  - `data.sql.gz` carries feedback reports and contributors' email addresses, which the narrow role keeps off that machine.
  - A daily source is a dead end, since step 2 needs today's sightings.

  Its fixed-snapshot property comes from the DuckDB copy instead.
- **Every five minutes from the start.** That matches ingest, but it is a promise made before the cost is measured. The first slice measures it.
- **A branch that swaps the reads, deployed separately.** The files it touches are among the most edited in the repo, so the branch would be resolving conflicts within a week. A switch on `main` gets every change tested and deployed normally, and makes cutover and rollback a one-line config change.

## Consequences

- The scripts live in [`scripts/read-path/`](../../scripts/read-path/). Which step reads what is declared in Stelis, in [`src/salishsea.rkt`](https://github.com/rainhead/stelis/blob/eefcfcab250ab4d409be0e74205b014b7f8387b7/src/salishsea.rkt). Running the build needs a Stelis checkout; salishsea's own CI does not run it.
- The snapshot is a DuckDB file at `data/read-path.duckdb`, already covered by the `*.duckdb` ignore. It stays around 100–200 MB across rebuilds, because DuckDB reuses the space a replaced table frees. Stelis's build state goes in `.stelis/`, which is now ignored.
- While step 2 is unbuilt, nothing a visitor sees changes. The files exist only where a build has been run.
- The map reads a day through [`src/read-path.ts`](../../src/read-path.ts) when built with `VITE_READ_SOURCE=static`, and applies the region there. In development, `READ_PATH_DIR` points Vite at a build's export directory, served at `/read-path/` on the page's own origin, so the CSP needs no new source. Until a manifest says which days a build covered, a missing day file reads as a day with no sightings (`salish-t3g.1`).
- Mirroring production locally for this measurement found `scripts/pull-prod-db.sh` broken against the current production schema (`salish-iel`).
