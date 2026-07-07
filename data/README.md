# Reference data

External reference sources we **mirror** here so that changes are diffable and
seeding is reproducible. These files are inputs, not authoritative domain data —
our authoritative catalog lives in Postgres (see the individuals/subjects model).

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
