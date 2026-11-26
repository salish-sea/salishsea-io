# 123 — The Bigg's catalogue rows are generated from the register too: a matriline needs two members, and alternate designations stay ours

**Status:** accepted; not yet built (bd `salish-1deu`) · **Decided:** 2026-11-25 · **Completes:** [070](070-southern-residents-are-generated-from-the-register.md) (the Bigg's rows follow the Southern Residents') · **Applies:** [051](051-group-hierarchy-is-the-registers.md) · **Depends on:** [animals ADR-0028](https://github.com/salish-sea/animals/blob/main/decisions/0028-biggs-mothers-are-read-off-designations.md) (proposed 2026-11-25)

## Context

Decision 070 generated the Southern Residents' catalogue rows from the register edition the build holds, and said the Bigg's rows would follow once nothing in them was ours alone. On 2026-11-25 three of the four facts that were ours had a place to go:

- **The matriarch of each matriline** is read from the register since `salish-o3gx` (PR #918). All 132 of ours agreed with it.
- **The mothers** were never in the Bigg's sheet. Our seed script read them off the designations (T065A is T065A5's mother), which the register had declined to do. Peter's call (2026-11-25): that is a fine start, so the register now records the same 375 mothers by the same rule, saying so on each row (animals ADR-0028), until a source that states mothers can replace them. Finwave may be one (bd `salish-otnp`).
- **What a nickname means to us**, its status and who gave it, was always to stay ours, keyed by register identifier (070).

Two questions were left, and Peter answered both.

## Decision

**The build generates the Bigg's individuals, their primary designations, their mothers and their matrilines from the register, as it does the Southern Residents'. Their checked-in rows go.**

**A matriline gets a row when the register gives it two or more members.** The register has 205 Bigg's matrilines, because its import gives every T-number a line. Ours has 132. Of the 73 extra, 68 hold one whale: 38 lone males and 30 females with no recorded calf. Nobody reports "the T190s" when T190 alone is meant, and a page for a line of one would only repeat the whale's own page, so they get no row and no page. The whale still belongs to the Bigg's, and its own page is unchanged. The other five have several members but no founder in the sheet, and they do get rows. One of them is `T049s`: until now the T049A family's map label could roll up only to the `T049As`. The rule applies to every generated population, and the Southern Residents lose nothing by it, because each of their lines is derived from a mother with at least one calf. *Rejected:* every register matriline (68 pages of one whale each, and 68 more small maps on the population page), and only lines with a matriarch (drops `T049s` and keeps the label problem).

**Designations other than the primary stay ours, in a checked-in file keyed by register identifier.** There are 65: 64 Alaska and California codes (`AM3`, `CA020`) and `T046A`, which was T122's designation until she was renamed. Old links redirect from them (decision [034](034-profile-urls-key-on-the-register-identifier.md)). The register holds 62 of them, but only as hidden search names, and its [Q23](https://github.com/salish-sea/animals/issues/14) asks what those catalogues are and how to cite them. Telling a designation from a search name by its note or its shape is the kind of guess the register asks consumers not to make. When Q23 is answered, the codes move upstream and this file goes. *Rejected:* reading them from the register's hidden names.

**A nickname's status and who gave it stay ours, keyed by register identifier**, as 070 said. The names themselves are all in the register already.

## Consequences

- **The catalogue's internal ids for the Bigg's change** to ids derived from the register identifier, as the Southern Residents' are (T065A's 195 becomes 10010193). Nothing published carries them: pages and links key on the register identifier (034). The write API's `identifications` table does store them, so it must be empty, or rewritten, when this ships.
- **T419, T420 and T421**, the Alaskan Bigg's whales Bay Cetology designated in March 2026, get pages, because the register holds them and our sheet never did.
- **The build waits for an animals release with ADR-0028's mothers.** Without one, the Bigg's pages would lose every mother.
- **Whales missing from the register stay missing**, T46B8 and T49A7 among them. The fix is upstream, from a source with 2026's calves.
