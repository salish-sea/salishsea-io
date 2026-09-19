# 045 — The source tables' foreign-key columns stay unindexed

**Status:** accepted · **Decided:** 2026-09-18 · **Answers:** `salish-b0v`

## Decision

**We do not index `taxon_id`, `contributor_id`, `species_id`, `individual_id` or `user_id` on the four source tables.** They are unindexed on purpose, and an "unindexed foreign key" advisory about them is a false positive here. Add one only when a measurement shows a plan that would use it.

## Why the usual argument does not apply

An unindexed foreign key is normally a real defect for one specific reason: deleting a row from the *referenced* table forces a full scan of the *referencing* table to prove nothing points at it. That cost is real when the referenced table is churned and the referencing table is large.

Neither holds. Measured on production, 2026-09-18:

| referenced table | live rows | deletes, ever |
|---|---:|---:|
| `inaturalist.taxa` | 513 | **0** |
| `public.contributors` | 17,037 | **0** |
| `happywhale.individuals` | 693 | **0** |
| `happywhale.users` | 515 | **0** |
| `happywhale.species` | 127 | **0** |

Nothing is ever deleted from any of them, so the check never runs. `public.contributors` has taken 3.4 million updates, but an update only triggers a foreign-key check when the *referenced key* changes, and `contributors.id` does not.

## Why the joins do not want one either

`salish-b0v` asked for "index usage rather than seq scans on these joins". Both plans were read on production before deciding, and neither is what that describes.

**The live map query** — one PST8PDT day out of `public.occurrences` — enters each source table through its existing date index and then joins *to* the taxonomy:

```
Index Scan using sightings_observed_at_gmt on sightings s   (rows=29)
  -> Index Scan using taxa_pkey on taxa t_recorded          (rows=1, loops=3)
     Index Cond: (id = s.taxon_id)
```

The join is keyed on `taxa.id` — the **referenced** side, already the primary key. `sightings.taxon_id` is the probe value, not a searched column, so an index on it cannot participate. The same shape repeats for every branch, memoized. Total: 38 rows in 14.6 ms.

**The nightly export** needs every row, so it hashes the 513-row taxonomy once and scans:

```
Hash Join (rows=20310)
  -> Seq Scan on sightings s (rows=20942)
```

That is the correct plan for "read the whole table", and an index can only make it worse if the planner is ever tempted into one. The one seq scan that looks slow (1.18 s) is a cold first read of a 10 MB heap, not bloat — `maplify.sightings` had 21 dead tuples and was vacuumed the same day.

## What it would cost

`maplify.sightings` has taken **866,755 updates** and `inaturalist.observations` 62,531 inserts against 30,149 live rows. Those are the ingest's hot paths, five minutes apart, and every added index is write amplification on them for a read benefit that does not exist.

## The one selective filter, and why it is also not this

`fetchLastOwnOccurrence` ([src/occurrence.ts](../../src/occurrence.ts)) filters `public.occurrences` on `contributor_id`, which *is* one of the named columns. Postgres prunes the three branches that hardcode `NULL::integer` to `Result (rows=0)` — `NULL = 1` is provably never true — and runs only the native branch, over 364 rows. Its 132 ms is the view's own join cost, which an index on a 364-row table does not touch. If that query ever needs help, the answer is the view, not the column.

## Consequences

- The advisory will be raised again, by a linter or by a reader who knows the general rule. This record is the answer: the general rule is right and its premise is absent here.
- **Revisit when a premise changes**, not on principle. Any of these would do it: a delete path opens on a referenced table (contributor account deletion is the plausible one); HappyWhale ingest is turned on, giving `encounters` a write and growth profile it does not have today; or a feature queries a source table *by* one of these columns rather than joining through it.
- Nothing about `public.identifications`, `individual_occurrences` or the other derived tables is decided here. They have different access patterns and were not measured.

## Reference

Measurements: `pg_stat_user_tables` and `EXPLAIN (ANALYZE, BUFFERS)` against production, 2026-09-18. The view whose cost dominates both plans: [supabase/migrations/20260829020000_resolve_retired_taxa_on_read.sql](../../supabase/migrations/20260829020000_resolve_retired_taxa_on_read.sql). Related and still open: `salish-4h3` (precompute occurrences) and `salish-xfo` (the map query timing out), both of which are about the view, which is where the time actually goes.
