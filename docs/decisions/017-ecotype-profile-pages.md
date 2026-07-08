# 017 — Ecotype profile pages

**Status:** accepted (2026-07-07)
**Context:** bd `salishsea-io-zw6`; builds on matriline pages (decision 016).
The ecotype is the root of the social-group hierarchy — one `social_groups`
row (`kind='ecotype'`, `designation='Biggs'`, no anchor, no parent), parent of
all 65 top-level → 132 total matrilines, and every cataloged Bigg's
individual descends from it.

## Decision

Give the ecotype a page at **`/ecotypes/Biggs`**, mirroring decision 016's
shell/edge/read-view pattern (third entry in the edge `PROFILE_ROUTES` table
and the Vite rewrite list). The page is the root of the hierarchy: no anchor
matriarch, no lineage chain above it.

### Content: a directory and a pooled sighting record

The page's core is a **flat A–Z directory** of all descendant matrilines, each
linking to its matriline page. Below it, a sightings section with the same
presence grid + static map as the other profile pages.

### Read path: `ecotype_occurrences`, a deliberate fan-out

An ecotype's sightings are the **union of every descendant's reports** — member
individuals (resolved through their current maternal matriline up the tree) and
descendant matrilines named directly. This **deliberately fans out**, which is
the opposite of the matriline page's rule (decision 016):

- A **matriline** page shows reports naming the group *as a unit* ("T65As") —
  no fan-out, because a text mention of the matriline is a distinct claim from a
  mention of one member.
- An **ecotype**'s membership is instead *structural and complete*: every T-whale
  is a Bigg's whether or not the word "Bigg's" appears in the report. So pooling
  all members' reports isn't double-counting — it is the honest, fullest
  presence record the catalog can produce. (Locally, 17 distinct occurrences
  resolve to Bigg's, a real subset of the 56 raw orca occurrences.)

The `public.ecotype_occurrences` view computes this with a recursive CTE that
walks `social_groups.parent_group_id` to each subject's `kind='ecotype'` root.
It is **tree-scoped, not "all individuals"**, so when SRKW lands as a second
ecotype each subject partitions cleanly by `ecotype_id`. Branch A maps
group-named reports (via `group_to_ecotype`); branch B maps individual-named
reports (via `individual_to_ecotype`, an individual's maternal matriline — a
birthright, so `is_current` is deliberately not required). One PostgREST filter
(`ecotype_id`) powers the page.

**Read path — candidates only (perf, migration `20260708040216`).** The first
cut (`20260708031133`) reached the data through `group_occurrences` /
`individual_occurrences`, both of which join the `public.occurrences` view (a
4-way UNION with no usable index on its computed id) in their stored-claims
branch. Filtered by one subject that branch's outer is empty and never built;
but an ecotype-wide aggregate is *unfiltered*, so the planner materialized the
whole occurrences union — ~62s on prod, past PostgREST's statement timeout, a
production 500. The fix reads **only** the cached
`occurrence_identifier_candidates` matview (which already carries
`observed_at`/`location`) plus the small group tables, never touching
`occurrences`: ~25ms. Consequences: (1) stored curator claims are not reflected
in the ecotype aggregate yet — a no-op while curation volume is zero; the
durable fix is a cheap indexed occurrence-timestamp source for the stored branch
(bd `salishsea-io-8uz`, a prerequisite for the curation UI `salishsea-io-ek3`),
which the per-subject views will also need before curation makes *their* stored
branch non-empty. **Resolved** (migration `20260708052333`): the
`occurrence_index` matview (id, observed_at, location; unique-indexed on id;
refreshed on the same cron tick as the candidates cache) is that source. The
per-subject views' stored branches join it instead of `occurrences`, and
`ecotype_occurrences` regained stored-claims branches through it — curator
verdicts (validated/rejected/absence) now reach the ecotype aggregate, shadowing
the cached candidate for the same (occurrence, subject).
(2) `UNION` (not `UNION ALL`) collapses to one row per
(ecotype, occurrence) at the database, so the unpaginated fetch stays under
PostgREST's `max_rows`; the deduped count (869 on prod) is approaching that cap,
tracked for pagination (bd `salishsea-io-236`).

### Invariants carried over

- **D-21:** the "Bigg's (transient) killer whales" descriptor is set in code,
  not rendered from `social_groups.notes` (notes/story prose are never shown).
- **Honesty invariant (015):** the sightings copy states the grid pools all
  members' reports, mostly unverified mentions.
- Not in `sitemap.xml`. Inbound links: the ecotype labels in the individual and
  matriline lineage chains, plus ecotype names written out in sighting prose
  ("Biggs", "Bigg's", "transients") — `injectIndividualLinks` links these
  fixed terms in code (there is no catalog designation for a prose word),
  alongside the codes it already links.

## Consequences / follow-ups

- Pod, clan, and named-group pages remain follow-ups: one `PROFILE_ROUTES`
  entry + one shell each, as before.
- `ecotype_occurrences` is the first read view that fans out through the group
  tree; a future pod page (an intermediate node) would reuse the same recursive
  descendants shape scoped to the pod rather than the ecotype root.
- Individuals mentioned in sightings but lacking any maternal `group_memberships`
  row are invisible to the ecotype aggregate (23 occurrences on prod at launch).
  This is a catalog data gap, not a query bug — tracked separately.
