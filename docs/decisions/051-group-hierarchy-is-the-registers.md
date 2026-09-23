# 051 — The group hierarchy is the register's; the matriarch and an animal's vital facts stay ours

**Status:** accepted · **Decided:** 2026-09-22 · **Extends:** [050](050-matriline-membership-is-the-registers.md) · **Answers:** the scope question left open in `salish-ox2.5`

## Decision

**Which group a group sits inside comes from the register.** For example, T065As sits inside T065s, which sits inside Bigg's. `social_groups.parent_group_id` is dropped. A group's parent is read from the register's closure (`register.ancestor`), through the view `public.group_parents`, and the ecotype views use that closure directly.

**These stay ours:**

- **The matriarch a matriline is named for** (`social_groups.anchor_individual_id`). The register never names her. It could only be derived from the group's label (`T065As` → `T065A`), and [ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md) forbids keying on a label.
- **An animal's sex, birth years and life status** (`public.individuals`). The register publishes its own for 459 animals, but the two have not been reconciled. Peter decided these stay here.
- **Parentage** (`mother_id`, `father_id`). The register records it for one animal.

## Why

Peter expects the hierarchy to back a hierarchical UI for tagging Orcasound bouts, with pods, clans, communities, matrilines and sub-lineages as one tree. That tree has to be the register's. Bout tags carry register identifiers ([028](028-salishsea-io-speaks-to-orcasound.md), [035](035-catalogue-migrates-before-tagging.md)). The register also holds groups we have no row for, such as the Southern Resident pods and clans. A second copy of the tree here could only drift from it. Checked against production before the change: every one of our 132 parent links matches what the register gives, and the ecotype has none, so dropping ours loses nothing.

## Consequences

- A group's parent in `public.group_parents` is its nearest ancestor that we also catalogue. If the register someday puts a group we don't catalogue between a matriline and its ecotype, our pages skip over it, and a tagging UI reading `register.*` shows it.
- The seed no longer writes parents. A catalogue seeded from scratch gets its hierarchy the moment the register is loaded, and not before.
