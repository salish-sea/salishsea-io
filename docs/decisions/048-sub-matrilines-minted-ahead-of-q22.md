# 048 — The sub-matrilines are minted now; Q22 confirms or retires them, and no longer gates anything

**Status:** accepted · **Decided:** 2026-09-20 · **Amends:** [035](035-catalogue-migrates-before-tagging.md) · **Answers:** `salish-ox2.6`

## Decision

**The register gains the 73 Bigg's sub-lineages now, without waiting for [Q22](https://github.com/salish-sea/animals/issues/13), and the catalogue migration (`salish-ox2.5`) proceeds against them.** Of the four options `salish-ox2.6` listed, this is the first: the register grows sub-matrilines as first-class entities. It is done in [animals#31](https://github.com/salish-sea/animals/pull/31).

[035](035-catalogue-migrates-before-tagging.md)'s ordering stands — the catalogue still migrates before the first OrcaSound bout is tagged. What changes is one of its consequences: *"The first tagged bout now transitively waits on Q22."* It no longer does. Q22 stays open and assigned to Scott Veirs; its answer now either confirms the 73 groups or retires them.

## The example

We hold the T073 lineage as three groups — T073, T073A (her calves T073A1–A3), T073C (T073C1–C2). The register held one, `T073s`. So T073A and T073C had no identifier to adopt, and across the catalogue that was 73 of 132 matriline groups and 213 of 375 membership rows with nothing upstream to materialize from. After animals#31 the register holds `T073As` and `T073Cs` nested inside `T073s`, and every one of our 132 groups has a counterpart.

## Why not wait

035 waited on Q22 because a moderator who hears the T073As would otherwise have only `T073s` to reach for, "permanently coarser than what the moderator knew". That argument is about *tagging against a vocabulary that lacks the finer level*. It is an argument for having the finer level, not for having Scott's answer first — and the two ways of being wrong about the finer level are not symmetric:

- **Minted, and Q22 says sub-lineages are not real groups.** Each is deprecated as merged into its enclosing lineage, with a successor a consumer may follow automatically (animals [ADR-0010](https://github.com/salish-sea/animals/blob/main/decisions/0010-identifiers-are-never-reused.md)). "The T073As" was always a true, finer statement about the T073s, so nothing recorded against it becomes false. Cost: 73 deprecation rows, and we fold 73 groups as we would have anyway.
- **Not minted, and Q22 says they are real.** Every record made against `T073s` in the meantime is coarse forever. Nothing can refine it.

And nobody downstream of this site stores group identifiers yet. The only `SSA:` numbers in the wild are the 510 individual profile URLs and Bigg's, all settled. So the first kind of wrong is cheap today and gets more expensive with every tag written; the time to take the risk is now.

The register owner and the owner of this site are the same person. That is why this could be decided in one conversation, and it is also why the match between the register's derived 73 and our 73 is a check on a script, not independent confirmation: both came from the same community sheet.

## What it unblocks

- `salish-ox2.6` closes when animals#31 merges: the modelling disagreement is resolved in the direction of two levels.
- `salish-ox2.5`'s group half can start once an edition containing animals#31 is released and loaded. Re-run `scripts/register/reconcile.ts` against that edition first; the expectation is 132 of 132 matriline groups matched by kind, and the 73 "resolves to an individual, not a group" mismatches gone.
- `/matrilines/` can move to register-identifier URLs ([034](034-profile-urls-key-on-the-register-identifier.md)) with the rest.
- `salish-8vr.24` (switching on production tag-writing in orcasite) still waits on `salish-ox2.5` and the picker, per 035, but no longer on a curator's answer.

## What it costs if Q22 goes the other way

A register edition with 73 deprecations. On this site: 73 `social_groups` rows fold into their parents, their 213 membership rows re-point, and 73 `/matrilines/` pages become redirects. 035's named fallback — a picker restricted to individuals and ecotypes — is no longer needed and is withdrawn.

## Alternatives considered

- **Keep waiting.** The status quo since 2026-08-30. Q22 went three weeks without an assignee or a comment, and every consequence of 035 queued behind it.
- **Derive sub-lineages from parentage** (`salish-ox2.6` option 2). Better founded in principle, but the register's `parentage.tsv` holds one row; it means importing Bigg's parentage first. Not excluded later — a parentage-derived grouping can confirm or correct these.
- **Keep the sub-lineages locally** (option 4), or **collapse them** (option 3). The first leaves this site asserting identity the register lacks, which is what the `salish-ox2` epic exists to end; the second deletes what a moderator most often hears.

## Reference

Issues `salish-ox2.6`, `salish-ox2.5`, `salish-8vr.24`. The import: [animals#31](https://github.com/salish-sea/animals/pull/31). The question: [Q22](https://github.com/salish-sea/animals/issues/13). The measurement: [`docs/reference/register-reconciliation.md`](../reference/register-reconciliation.md).
