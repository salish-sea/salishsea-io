# Reference data

Mostly external reference sources we **mirror** here so that changes are diffable and
seeding is reproducible. Two kinds of file are ours instead, and are the source of what
they hold: `maplify-unnamed.tsv`, and the reference tables under `reference/`. Under
[decision 064](../docs/decisions/064-what-users-do-not-write-leaves-postgres-first.md)
more of what we curate moves here as it leaves Postgres; until then the catalogue's
source is still Postgres.

## `reference/` — providers, organizations, collections, Maplify's collection rules, enum orders

Ours, and the source the read-path build reads ([decision 064](../docs/decisions/064-what-users-do-not-write-leaves-postgres-first.md), `salish-9uu.2.1`): who a sighting is attributed to ([decision 006](../docs/decisions/006-provenance-graph.md)), the rules that file a Maplify sighting under a collection by the bracketed source in its comment, and the declared order of the enums the derivation compares by. [`reference.ts`](../scripts/read-path/reference.ts) loads them into the build under their Postgres names; the format is described there. Whitespace is kept exactly, so a quoted value with a leading space means it.

Migrations wrote these tables, and the signed-in site still reads Postgres's copies until the store replaces it, so **a change here needs a migration making the same change** until then. [`reference.test.ts`](../scripts/read-path/reference.test.ts) fails in CI when a fresh migration replay and the files disagree.

## `maplify-unnamed.tsv` — Maplify names a curator has accepted as un-named

Unlike the rest of this directory, ours: a decision record in table form. A Maplify sighting carries a common name and a scientific name, and the map shows it under the register entity those resolve to ([decision 049](../docs/decisions/049-maplify-keyed-on-the-register.md)). A register edition that stops naming a pair would silently drop every sighting carrying it, so two checks refuse such an edition — `register-refresh.yml` before it loads one, and the read-path build's gate before it derives — unless the pair is listed here ([decision 061](../docs/decisions/061-ingest-and-derivation-move-into-the-build.md), `salish-xv35.9.2`). A row says: these sightings are *meant* to show under no animal from now on, and why. An empty `name` means the sighting carries none. Add a row in the same pull request as the register release that needs it, and leave it: the pair may come back.

## `biggs-ids.tsv` — Bigg's killer whale designations & nicknames

- **Source:** [Bigg's Orca/Killer Whale Nick Names](https://docs.google.com/spreadsheets/d/1fj3sA2R8LGw68-Rxb0dL6jwTKkc4AkhGKuk-jt9zmis/edit?gid=0) (Google Sheet, `gid=0`)
- **Maintained by:** `vitalocean@gmail.com` — the curator behind the community
  "Transient/Bigg's Orca Nick Naming Page" that recurs in the *Who Nicknamed* column.
- **Retrieved:** 2026-07-07. Sheet last modified 2025-07-01 (slowly curated, not a live feed).
- **Columns:** deceased flag (`D`/`PD`) · Local ID (BC/WA) · Additional Designations
  (Alaska/California) · Gender · Birth Year · Nicknames · Story Behind the Nickname ·
  Who Nicknamed · Notes.

### Why it's committed

We have no visibility into the sheet's edit history. Committing a byte-for-byte
mirror establishes a **baseline**: re-export and diff to detect upstream changes,
then decide per-change whether to re-seed. Refresh is periodic, not automated.

### Rights

The **factual** content is not subject to copyright and is what we use:
designations, genealogy, birth years, gender, deceased status, which authority
named an animal, and the *etymological facts* in the story column (e.g. "named for
Pedder Bay, where the T2s were held captive in 1970"). A minority of story cells
contain genuinely creative prose; where we surface those, we state the fact rather
than reproduce the passage verbatim. The compilation's selection/arrangement
belongs to its maintainer and is credited, not claimed. Policy of record:
[../docs/rights-policy.md](../docs/rights-policy.md) §7.1 (decision D-21).

### Refreshing

```bash
# Re-export the sheet as CSV and diff against this baseline (columns only, delimiter-agnostic).
# Auth via the Drive integration or a shared export link; compare cell-by-cell keyed on Local ID.
```

## `individual-entities.tsv` — catalogue individuals to register entities

- **Source:** generated from [`docs/reference/register-reconciliation.md`](../docs/reference/register-reconciliation.md)'s
  per-row TSV — the measured, one-to-one mapping of every catalogue individual to its
  [salish-sea/animals](https://github.com/salish-sea/animals) register entity
  (edition 2026.08.1, all 510 `verdict=one`).
- **Read by:** the migration that writes `individuals.entity_id`, and
  [`scripts/seed/seed-biggs.ts`](../scripts/seed/seed-biggs.ts), which applies the same
  pairs so a locally seeded database matches production.
- **Regenerate** by re-running `scripts/register/reconcile.ts` against the loaded edition
  and re-extracting the `individuals` rows; identifiers are permanent (animals ADR-0010),
  so existing pairs never change — a regeneration can only add rows.

## `matriline-entities.tsv` — catalogue matrilines to register entities

- **Source:** the same reconciliation, its `social_groups` rows: every one of our 132
  matriline groups matched to exactly one register group of rank `matriline` (edition
  2026.09.1, the first to hold the Bigg's sub-lineages such as `T073As`).
- **Read by:** the migration that writes `social_groups.entity_id` for matrilines, and
  [`scripts/seed/seed-biggs.ts`](../scripts/seed/seed-biggs.ts).
- **Regenerate** as above, re-extracting the `social_groups` rows. If the register ever
  retires a sub-lineage (animals Q22 is still open), the pair stays valid — identifiers
  are never reused — and folding the group is a migration of its own, not an edit here.
