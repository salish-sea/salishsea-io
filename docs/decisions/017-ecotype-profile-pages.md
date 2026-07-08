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

The new `public.ecotype_occurrences` view (migration `20260708031133`) computes
this with a recursive CTE that walks `social_groups.parent_group_id` to each
subject's `kind='ecotype'` root, unioning `group_occurrences` (branch A) and
`individual_occurrences` joined through maternal `group_memberships` (branch B).
It is **tree-scoped, not "all individuals"**, so when SRKW lands as a second
ecotype each subject partitions cleanly by `ecotype_id`. One PostgREST filter
(`ecotype_id`) powers the page; the client (`dedupeOccurrenceLinks`) collapses
the two branches to one row per occurrence. Individuals with no maternal
membership row are excluded from branch B (a no-op today — all cataloged
individuals have one — and they still surface via branch A if their matriline
is named).

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
