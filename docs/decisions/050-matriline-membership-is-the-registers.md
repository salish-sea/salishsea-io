# 050 — Matriline membership is the register's

**Status:** accepted · **Decided:** 2026-09-22 · **Amends:** [016](016-matriline-profile-pages.md) · **Answers:** part of `salish-ox2.5` (the membership half)

## Decision

**Which animals belong to a matriline is read from the register, and the register's answer is a matriarch and all her descendants.** A matriarch belongs to her own matriline and to every matriline above it: T065A is in T065As and in T065s. Our own `public.group_memberships` rows are no longer read.

- **Where:** the view `public.matriline_members` ([migration 20260923010000](../../supabase/migrations/20260923010000_matriline_membership_from_register.sql)), a projection of the register's derived closure `register.ancestor` onto our `individuals` and `social_groups`. It asserts nothing of its own.
- **A group mention reaches every living member.** When a report says "the T65s", every living descendant of T065 is inferred present, the matriarch and grandchildren included, and each link stays marked as reached through the group. Life status is still ours, because the register records no end to any membership.
- **A matriline page lists everyone, grouped by sub-lineage.** The page lists the matriarch and any descendants with no narrower matriline, then each sub-lineage under its own name. An animal's own page shows her innermost matriline. For a matriarch that is her own matriline, not her mother's.

## Why

Both sides always agreed about the animals and differed only in encoding. Our catalogue recorded a matriarch as her group's anchor and gave her a single membership row, pointing at her mother's group. That encoding had two visible effects. A report of "the T65As" never reached T065A herself. A report of "the T65s" never reached T065's grandchildren. Peter settled the underlying question on 2026-09-20: a matriarch is a member of her own matriline. The register's definition follows from that. [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md) says this repository stops holding a second opinion about identity, so we adopt that definition instead of patching ours to match it.

**The closure, not the membership edges.** `register.membership` keeps a redundant edge from every sub-lineage member to the top-level lineage (T065A2 → T065s directly as well as through T065As), so counting its rows counts nothing. `register.ancestor` has one row per animal–group pair and is the register's own derivation.

## What it changes (production, edition 2026.09.6)

| | before | after |
|---|---|---|
| living animal–matriline pairs | 329 | 636 |
| inferred sighting links on individual pages | 31,542 | 57,318 |
| animals that reach the ecotype page | 375 | 510 |

The ecotype row counts the 65 matriarchs and the 70 animals in no matriline. Before, an animal needed a membership row to reach the ecotype. Now the register places all 510 under Bigg's.

## Alternatives considered

- **Keep our rows and add the matriarch.** This would fix T065A's absence from her own group, but T065s would still stop at T065's children. It also keeps a second answer that has to be reconciled by hand every time the register changes.
- **Innermost group only.** Each animal would count only for her narrowest matriline. "The T65s" would then stop reaching T065A, because she has her own group, which contradicts the settled answer.

## Consequences

- `group_memberships` is now unread, and `salish-ox2.5` retires it. `social_groups.anchor_individual_id` (the matriarch named in a page's masthead) and `parent_group_id` (the group chain) are still ours and still read; they are the next things the register can answer.
- The inferred links are candidates, as before. A report of a whole matriline says nothing about which members were actually present. Each link records the group it came through (`via_group`), so it is never presented as an identification of the animal.
