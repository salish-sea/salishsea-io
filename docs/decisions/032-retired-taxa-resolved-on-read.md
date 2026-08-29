# 032 — A retired taxon is resolved on read, not rewritten on write

**Status:** accepted · **Decided:** 2026-08-29

## Decision

A stored taxon id records **what was claimed** — by upstream on a mirror row, by a contributor on a native one — and is never rewritten when iNaturalist retires that taxon. Resolution happens where the taxon is **read**: `public.occurrences` and `dwc.taxa_classification` hop through `inaturalist.taxa.current_taxon_id`, so a record keeps naming the taxon it was filed under while displaying and exporting the taxon that taxon has become.

Nothing repoints `inaturalist.observations.taxon_id`, `maplify.sightings.taxon_id`, `public.observations.taxon_id`, or `public.individuals.taxon_id` on account of a retirement.

## Why

iNaturalist retires a taxon by marking it inactive and naming a replacement — nine times over this mirror's lifetime, one of them (`Sagmatias obliquidens` → `Aethalodelphis obliquidens`) carrying 38 of our records. Until now the only response was `scripts/backfill/inat-taxa-status.ts`, which UPDATEs the id out of every column referencing it. Two objections, pointing in opposite directions:

- **A mirror column is upstream's.** [008](008-source-schemas-are-upstream-mirrors.md) makes the source schemas verbatim mirrors, and the writer can undo the repair anyway: the iNaturalist observation upsert rewrites `taxon_id` whenever `updated_at` advances, and Maplify's `taxon_id` is re-derived from the sighting's name on every re-fetch. A repair the next ingest reverts is not a repair.
- **A native column is a person's.** `public.observations.taxon_id` is a contributor's determination — someone said what they saw. Rewriting it is a silent edit of their claim, which is worse than leaving it, not better.

Both are records of a claim. Reconciling a claim with a later taxonomy is a *reading* concern, and 008 already names read-time translation as the pattern (`maplify.sightings.comments` is parsed at view-read time, never updated). The view was half-doing this already: since [029](029-map-symbology.md)'s register work, the register lookup joined through `COALESCE(t.current_taxon_id, t.id)` while every other column read off the retired row.

Resolving on read also reaches the one link a repointing script cannot. `inaturalist.taxa.parent_id` is deliberately left alone by the backfill — repointing a parent rewrites the taxonomy tree — so a retired *ancestor* can only be resolved at read time. The mirror holds four taxa under a retired genus today.

## Consequences

- `public.occurrences` joins the mirror twice per branch: `t_recorded` is the taxon as the record names it, `t` is the taxon it currently is. `scientific_name`, `species_id`, and the vernacular fallback read off `t`. This matters beyond names: `species_id` chains sightings of one species into a track, so an unresolved retirement splits one animal into two tracks and two colours on the map ([029](029-map-symbology.md)).
- `dwc.taxa_classification` stays keyed by the id as recorded — `tc.taxon_id = s.taxon_id` still joins — but reports the live taxon's rank, name, and ancestry, hopping at the leaf and at every ancestor step.
- **One hop, not a walk.** iNaturalist's `current_synonymous_taxon_ids` names the *current* taxon rather than an intermediate, so a chain in the mirror is a stale row for the taxa refresh to fix, not a depth for a view to recurse through.
- **A retirement with no replacement stays itself.** Seven of the nine name none — either iNaturalist gave none, or it split the taxon and picking one would guess which animal was seen ([005](005-export-exclusion-src-01.md)'s caution about inventing determinations). Those records display the retired name, which is the honest answer.
- `scripts/backfill/inat-taxa-status.ts` loses its repointing half and becomes a pure mirror refresh, which is what makes it safe to run unattended (salish-4hq).
- The retirement is still *visible*: `is_active` and `current_taxon_id` remain on the mirror, and nothing hides a record filed under a retired taxon.

## Rejected alternatives

- **Have the ingest follow `current_taxon_id` when it writes.** Feasible since the closure started asking by the `/taxa/{ids}` path form (salish-5ds), and it would keep a dead id out of the mirror entirely. Rejected because the mirror would then no longer say what upstream said, which is the whole of 008 — and it would still not touch a contributor's determination or a retired ancestor.
- **Keep the batch repair.** Rejected: upstream can undo it on mirror columns, it edits contributors' claims on ours, and it cannot fix ancestry at all.
- **Resolve recursively.** Rejected as answering a question the data does not ask; see "one hop" above. The chain rule stays in the refresh's runbook, in one place.

## Reference

Mirror discipline: [008](008-source-schemas-are-upstream-mirrors.md). The columns: migration `20260828000000_taxa_deactivation.sql`. The read path: migration `20260829020000_resolve_retired_taxa_on_read.sql`. Why the ingest can see a retirement at all: `supabase/functions/ingest/fetch-inaturalist.ts` (salish-5ds).
