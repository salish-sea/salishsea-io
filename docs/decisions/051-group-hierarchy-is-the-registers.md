# 051 — Whatever the register holds, we read from it; the group hierarchy is the first to follow 050

**Status:** accepted · **Decided:** 2026-09-22 · **Extends:** [050](050-matriline-membership-is-the-registers.md) · **Answers:** the scope question left open in `salish-ox2.5`

## Decision

**Whatever the register can supply, we read from it, and our own copy goes.** This is Peter's rule for the rest of the catalogue migration, and it follows [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md): this repository becomes a materialization of the register rather than a second opinion. We keep a field only where the register has no answer. A field we keep because the register lacks it moves over when the register gains it.

**The group hierarchy moves now.** Which group sits inside which (T065As inside T065s inside Bigg's) is read from the register's closure (`register.ancestor`) through the view `public.group_parents`. `social_groups.parent_group_id` is dropped, and the ecotype views use the closure directly.

**Sex, birth years and life status moved on 2026-09-24** (`salish-ox2.8`). The register loader copies them onto `public.individuals` in the same transaction as every load, through `public.refresh_individual_vitals()`, and nothing of ours writes them any more. The reconciliation first found no birth-year disagreements and one sex disagreement: T109A3A, whose sheet entry `F?` we read as female and the register reads as not known. It also found 56 animals the register records no status for, all of which we had as alive. The Bigg's sheet leaves their status blank, and "until we learn otherwise, blank could mean anything" (Peter), so they are now unknown. *This paragraph first said these would move after reconciliation.*

**These stay ours, because the register does not hold them:**

- **The matriarch a matriline is named for** (`social_groups.anchor_individual_id`). The register never names her. She could only be derived from the group's label (`T065As` → `T065A`), and [ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md) forbids keying on a label.
- **Parentage** (`mother_id`, `father_id`). The register records it for one animal.
- **Superseded and alternate designations** that the register does not publish, such as `T046A` and the `CA`/`AO` codes. These are what old links redirect from ([034](034-profile-urls-key-on-the-register-identifier.md)).
- **What a nickname means to us:** its status, who gave it and when, and its story.

## Why

A copy of something the register owns can only drift from it, and it has to be reconciled by hand every time the register changes. The hierarchy shows why this matters: a hierarchical UI for tagging Orcasound bouts needs the register's whole tree, including groups we have no row for, such as the Southern Resident pods and clans. Bout tags carry register identifiers ([028](028-salishsea-io-speaks-to-orcasound.md), [035](035-catalogue-migrates-before-tagging.md)).

Checked against production before the change: every one of our 132 parent links matches what the register gives, and the ecotype has none, so dropping ours loses nothing.

*This record first said the hierarchy moved because of the tagging UI, and that sex, birth years and life status stayed ours. Peter's rule replaced both on the same day, once it was clear the register holds all four.*

## Consequences

- A group's parent in `public.group_parents` is its nearest ancestor that we also catalogue. If the register someday puts a group we don't catalogue between a matriline and its ecotype, our pages skip over it, while a tagging UI reading `register.*` shows it.
- The seed no longer writes parents. A catalogue seeded from scratch gets its hierarchy once the register is loaded.
