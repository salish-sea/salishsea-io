# 059 — The end state: a build over upstream data, and a small store for what only our users write

**Status:** accepted · **Decided:** 2026-09-30 · **Answers:** the end-state question behind `salish-9uu` · **Extends:** [056](056-the-logged-out-read-path-is-built-as-static-files.md) · **Would amend:** [002](002-static-spa-edge-architecture.md) (no backend), when step 4 lands

## Context

Decision 056 set out four steps: build the logged-out read path, serve it, move ingest into the build, then move writes and sign-in. The first two are done: every page a signed-out visitor loads is now a file written by the read-path build. That build runs on [Stelis](https://github.com/rainhead/stelis/), a build system Peter maintains for data pipelines: it takes snapshots of upstream data, runs the steps that derive the site's files from them, and reruns only the steps whose inputs actually changed. Its files are served from the `salishsea-io` Fly app. What 056 left open is where the data lives once the last two steps are done. Does salishsea keep Postgres, or move to the architecture of [BeeAtlas](https://github.com/rainhead/beeatlas/), Peter's site for the Washington Bee Atlas? There, a Stelis build derives everything, and a small local store holds only what users write (their notes on species).

Two facts decide most of it.

**Almost none of the data is ours.** Of about 63,500 occurrences, 600 were entered on salishsea.io. The rest come in from Maplify, iNaturalist, Happywhale and Orcasound, and the catalogue comes from the animals register. The only tables a signed-in user can write are `observations` and `observation_photos` (143 photos), plus feedback. Everything else can be fetched again from where it came from.

**What Postgres does for us is mostly derivation.** The five per-source views behind `derived.occurrences` ([055](055-occurrences-are-stored-not-assembled.md)), the identifier candidates, the region and haul-out joins, and the ingest schedule (pg_cron calling an edge function) are all work done on upstream data. Step 3 of 056 moves that into the build, to be checked row for row against the stored table. After that, Postgres would hold a few hundred records and the sign-in.

`salish-9uu` put the reason for leaving Supabase as control, not cost. During the 2026-08-28 outage we couldn't list running queries, couldn't kill one, and Supabase reported the project healthy throughout.

## Decision

**The target is BeeAtlas's shape.** The Stelis build derives everything a visitor sees from upstream snapshots. What only our users write lives in a small store on the same machine, and the build reads that store as an input it can never regenerate. That's how it reads BeeAtlas's notes store: key by key, so one write rebuilds only what it touched and can be traced to the pages it changed ([`notes-digest.rkt`](https://github.com/rainhead/stelis/blob/e4780954e105f4925bf90a5813c0ac3f02259d13/src/notes-digest.rkt)). The store is SQLite, with a small write API beside it, as BeeAtlas's is ([BeeAtlas ADR 0042](https://github.com/rainhead/beeatlas/blob/57118da21dc31da08e05d82f3467cea5af7b8d84/docs/adr/0042-beeatlas-moves-to-fly-as-one-stateful-machine.md)).

Why this rather than keeping Postgres:

- **It fits the data's shape.** Hundreds of records, a handful of writers, and a large derivation from upstream. That's what a build over snapshots and a small store for user writes are for, and it's what BeeAtlas already runs.
- **It's the control `salish-9uu` asked for.** A SQLite file on our own volume can be opened, queried and copied at any moment by anyone holding the machine.
- **The build knows what changed without asking.** Against Postgres, the snapshot re-reads the database on every build just to learn whether anything moved. A local store can be read key by key, so an unchanged store costs almost nothing. That's what makes frequent builds affordable.
- **A contributor's sighting can be live when the save returns.** A write can run a targeted build before responding, as a BeeAtlas note does, instead of waiting for a broadcast and the next build.

**Step 3 comes next.** Moving ingest into the build is the prerequisite for this end state: it's what leaves the store holding only what our users write.

**The Orcasound conversation decides who issues sign-ins, not where the data lives.** salishsea keeps its own data whatever comes of it. `salish-9uu` names shared identity as its gate because its preferred option depended on our minting the tokens that row-level security reads. Here it decides only how the write API checks a sign-in: by verifying Google's tokens itself, or by accepting Orcasound's. It gates step 4's sign-in work, not this decision.

## What would reverse it

**Several independent writers.** Moderators editing concurrently, or outside systems writing directly, would outgrow a single SQLite writer, and a server database would earn its place back. Nothing today does, and the store's schema would be small enough to move.

## Rejected alternatives

- **Keep Supabase.** It's the status quo, and it's what failed opaquely in the outage that started this.
- **Managed Postgres with PostgREST and our own sign-in tokens** (`salish-9uu` option 2). This keeps decision 002's no-backend architecture and every row-level security policy. But it keeps a database server running to hold a few hundred rows once step 3 has moved the derivation out.
- **Adopting BeeAtlas's read side too: Parquet queried in the browser** by wa-sqlite and hyparquet ([BeeAtlas ADR 0003](https://github.com/rainhead/beeatlas/blob/57118da21dc31da08e05d82f3467cea5af7b8d84/docs/adr/0003-client-query-engine-wa-sqlite.md)). "BeeAtlas's architecture" here means its build and its store, not its client. 056 and [057](057-profile-pages-are-prerendered.md) already settled salishsea's read side as plain files and prerendered pages, which serve its fixed views without a query engine in the page.

## Consequences

- **There will be a backend.** Decision 002's "PostgREST is the backend" ends at step 4. The write API's surface is small: save and delete a sighting, upload photos, submit feedback, and sign in.
- **Durability becomes ours.** The store is the one dataset that can't be rebuilt from upstream, so it needs continuous replication off the machine (Litestream or similar) from its first day, not a nightly backup. BeeAtlas found its own hourly backup had never been installed.
- **The machine grows.** The Fly app ends up running the file server, the build, ingest, the write API and sign-in, on the 1 GB it has today. Every addition is measured against that first.
- **PostGIS goes with the derivation.** The spatial joins move into the build (DuckDB's spatial extension), and the store needs none.
- **Photos move with the store.** The 104 MB `media` bucket leaves Supabase Storage at the same time.
