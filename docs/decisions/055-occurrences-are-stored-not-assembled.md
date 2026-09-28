# 055 — Occurrences are stored, not assembled: each writer keeps them current in its own transaction, and reference data triggers a rebuild

**Status:** accepted · **Decided:** 2026-09-28 · **Answers:** `salish-4h3` · **Supersedes:** the two five-minute matview refreshes (migrations `20260708052333`, `20260708000104`, `20260909120000`)

## Context

On 2026-09-27 Supabase warned that the project was running out of disk IO. The Free plan's instance has a small IO baseline and a daily burst allowance, and one job was spending it. Every five minutes, pg_cron ran `REFRESH MATERIALIZED VIEW CONCURRENTLY` on `occurrence_index` and on `occurrence_identifier_candidates`. Each refresh recomputed all of `public.occurrences`, a five-way `UNION ALL` view that joins about fifteen tables and runs text extraction over every comment. It wrote the result to a temporary table and diffed that against the old contents. With 2 MB of `work_mem`, the diff spilled to disk.

Between 2026-08-28 and 2026-09-28, the `occurrence_index` refresh alone wrote 170 GB of temp files and 48 GB of temporary tables, against a 252 MB database. A seven-minute sample on 2026-09-28 found the two refreshes behind about 90% of all bytes written. The refreshes never skipped a tick, yet only about one ingest tick in five changed anything. When the iNaturalist history backfill (decision [041](041-inaturalist-history-backfilled.md)) grew the corpus on 2026-09-18, to the 63.5k occurrences it holds now, each refresh went from ~7 s to ~13 s within the hour. From then on, 26 s of every five minutes went to recomputing what was already known.

This had been foreseen in `salish-4h3`, and the same load is what made visitors' 50 ms map queries miss the 3 s anonymous-read budget (`salish-xfo`).

## Decision

**The rows are stored, and the derivation stays SQL.** `derived.occurrences` is a table holding every column `public.occurrences` has served, plus `source` and `source_key`. Its rows are, by construction, exactly what five views compute: `derived.maplify_occurrences`, `derived.inaturalist_occurrences`, `derived.happywhale_occurrences`, `derived.native_occurrences` and `derived.orcasound_occurrences`. Each is one branch of the old `UNION ALL`, unchanged, plus the key of its source row in its native type (so a filter on it reaches the source table's primary key index). Changing how an occurrence is derived still means editing a view, as it always did.

**Each writer keeps the store current in its own transaction.** Statement-level triggers on every source table collect the keys a statement touched, from its transition tables, and call `derived.refresh_occurrences(source, keys)`. That function recomputes those keys through the source's view, upserts only the rows that differ, and deletes the ones the view no longer yields. It then does the same for `derived.occurrence_identifier_candidates`. So a sighting saved through the app is on the map the moment the save commits, not on the next tick, and an ingest tick that changed nothing writes nothing. Measured on production, 300 changed keys cost about 180 ms to recompute, and a typical tick changes a handful.

The source tables are `maplify.sightings`, `inaturalist.observations`, `inaturalist.observation_photos`, `public.observations`, `public.observation_photos`, `public.acoustic_bouts` and `public.acoustic_bout_entities`. `public.contributors` joins them for updates only: a renamed contributor refreshes that contributor's own sightings. A new contributor can't change an existing occurrence.

**Reference data marks the store stale, and a rebuild follows within five minutes.** Some tables change what many occurrences say at once, but rarely:

- the register, detected through `register.edition`, which every load writes
- `inaturalist.taxa`
- providers, collections and organizations
- social groups and designations
- the HappyWhale tables

A statement that changed rows in any of these appends a row to `derived.stale_marks`; an upsert that changed nothing appends nothing. The marks are append-only so that a reference writer holds no lock anyone else needs. A five-minute cron job, offset to :02 from the ingest ticks at :00, calls `derived.rebuild_occurrences(only_if_stale => true)`, which is a no-op when there are no marks. When it does rebuild, it deletes only the marks it saw at the start, in a transaction of its own, so a change that commits mid-rebuild is still marked afterwards. The rebuild runs the same refresh function with no keys, one source per transaction. It is a diff, not a replacement: unchanged rows are filtered out before the upsert, because `ON CONFLICT` locks, and so dirties, every row it conflicts with even when its `WHERE` declines the update. So a register reload that changed nothing costs some seconds of computation and writes next to nothing. The register reloads about three times a day, on every deploy and on the daily refresh.

**A change to a derivation ships with its own rebuild.** A migration that edits one of the five views, or a function they call (`extract_identifiers`, the register's fold), ends by calling the refresh for the sources it affects. There is no background drift detector. The rebuild is explicit and rare, as `salish-4h3` asked.

**Refreshes of one source take turns.** Each refresh computes from its own snapshot, so two refreshes of the same occurrence could race and leave the older answer stored. That happens with two photos of one observation written by two sessions, a contributor renamed while saving a sighting, or a rebuild alongside a tick. So every refresh takes an exclusive per-source advisory lock, held to commit, and computes only after it's granted, which means it sees every refresh committed before it. No transaction refreshes two sources, and the candidates lock is only taken after a source lock or on its own, so no cycle is possible. A writer waits at most for another writer of the same source, which takes milliseconds, or for that source's rebuild: about 5 s for iNaturalist, and a third of a second for sightings reported here, well inside the signed-in user's 8 s budget. A `TRUNCATE` of a source table refreshes the whole source.

## The four questions `salish-4h3` left open

- **Per source row or per occurrence?** Per occurrence. The derived text lives on the stored occurrence row, not as extra columns on five source tables. The source tables stay mirrors of their upstreams, and the occurrence shape lives in one table.
- **How is a resolver change backfilled?** By an explicit rebuild, as above: in the migration that changes it, or by a stale mark when reference data moves. A whole-source refresh brings that source's identifier candidates along with it, so a migration that calls one leaves nothing stale.
- **Does the archive read the new table?** It doesn't need to. The `dwc.*` views read their source tables directly and never read `public.occurrences`. They are unchanged.
- **What do PostgREST clients see during the cutover?** Nothing different. `public.occurrences` remains a view with the same name, columns and types, now a projection of `derived.occurrences`. The frontend, the profile pages, `haulout_occurrences` and the generated types all read it as before. `occurrence_index` is gone: the table has the same index on `observed_at`. `occurrence_days` stops splitting at 48 hours, since that split only existed because the matview lagged. The five views that read the candidates are re-created against the new tables, as every earlier change to the candidates matview had to do.

## Rejected alternatives

- **Refresh the matviews only when something changed.** This is the cheapest interim fix. It cuts the refreshes to the one tick in five that changes anything, but each one still recomputes all 63.5k occurrences to reflect a handful, and still spills. It does nothing for a sighting saved through the app, which would still wait for a tick.
- **The ingest maintains the table itself.** It misses every other writer: the app's own saves, a curator's edit, the register resolver's re-keying of Maplify rows, a hand-run fix. Triggers see every writer.
- **Row-level triggers.** These fire once per row, so a batch upsert of a window becomes hundreds of single-key recomputes. Statement triggers with transition tables give one set-based recompute per statement.
- **Recompute synchronously when reference data changes.** A new taxon would arrive inside an iNaturalist ingest tick and make that tick pay a 10 s rebuild. The stale mark moves the cost to a job that has nothing else to do.
- **An incremental-view-maintenance extension (pg_ivm and similar).** It would be one more thing production and the local stack must agree on, and the view is a `UNION ALL` of branches with correlated subqueries and aggregates, which such extensions don't maintain.

## Consequences

- **Rehearsed on production's data.** A data-only dump of production, restored locally onto the schema as of `main`, took the migration in 6 s on a laptop (allow several times that on the Nano instance). The store came out at 63,491 rows, the count the old view returned, and the candidates at 16,226, the count of production's matview. The store equalled its derivation exactly. A rebuild that changed nothing then took about 1.7 s and wrote no rows, with WAL indistinguishable from idle background. At the chosen 32 MB of `work_mem` it spills about 20 MB, a few times a day; the refreshes it replaces spilled about that every five minutes. A write that changed 20 sightings took 22 ms including their refresh.
- **Reviewed adversarially before merging.** A second model tried to break the design. It demonstrated a deadlock between the rebuild and a tick carrying a new taxon, through the counter row the first draft used, and a lost update between two writers of one source under a shared lock. Both are fixed as described above, and the second has a regression test. It also found that production's 120 s `statement_timeout` applies to the migration, which now lifts it and fills the store one statement per source.
- **Orcasound occurrence ids can lag `public.acoustic_identifications` by up to five minutes after a register reload.** That view derives the id live through `register.taxon_entity_for`, while the store moves it at the next rebuild. Until then, the joins in the profile views miss those bouts' claims. This is accepted; the comment in migration `20260926120100` that says "a register reload moves both together" is no longer true.
- One migration adds the `derived` schema, the five views, the two tables, the functions and triggers, and the cron job. It drops both matviews and their jobs, re-creates the five dependent views and their grants, rewrites `occurrence_days`, and populates the store.
- `derived` is not exposed to PostgREST, and neither `anon`, `authenticated` nor `ingest` has any privilege in it. The triggers call definer functions, so the ingest role needs no new grant.
- `public.occurrences` and `occurrence_unresolved_codes` are now single-table views, which Postgres treats as updatable, and the generated types grow `Insert`/`Update` shapes for them. That is inert only because no client role holds a write privilege on either. `supabase/public-grants.test.ts` already pins the only client-writable relations (`observations` and `observation_photos`), so a grant that would open the store to writes fails CI.
- `inaturalist.mint_contributor` stops rewriting the contributor row on every call. It had done so once per fetched observation per tick: 4M updates in thirty days on a table of 17k rows. With the new contributor trigger, that would also have been 4M pointless refresh checks.
- A test pins the invariant: after writes to every source, the store equals what the five views compute. `supabase/refresh-schedules.test.ts` loses its subject and goes. The rule it guarded, that no two whole-view scans share a tick, no longer has two scans to keep apart.
- This is the database-side step that `salish-t3g` (the logged-out read path as static artefacts) builds on: an artefact is easier to cut from a table that is already right.

Related: `salish-xfo` (the read timeouts this load caused), `salish-9uu` (the Supabase exit plan, which this makes smaller rather than more urgent), decision [002](002-static-spa-edge-architecture.md) (why PostgREST reads the database directly).
