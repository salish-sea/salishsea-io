# 035 — The catalogue migrates before the first bout is tagged

**Status:** accepted · **Decided:** 2026-08-30

## Decision

Animals [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md) asks, and leaves open: "does the catalogue migrate before or after the first OrcaSound bout is tagged? Tagging against identifiers that later change would defeat the purpose."

**Before.** The first production bout tag carrying an `SSA:` identifier lands after the catalogue migration (`salish-ox2.5`) is complete — after `public.*` has stopped asserting identity and this site is itself keyed on the register it is recommending.

This orders the two epics: `salish-ox2` (catalogue adoption) finishes before `salish-8vr` (OrcaSound integration) goes live with tag *writing*. Almost nothing else about `salish-8vr` waits — see below.

## Why, when parallel looked safe

`salish-ox2.4` observed an asymmetry that seemed to dissolve the question: tagging against the register is safe *whenever* it happens, because [ADR-0002](https://github.com/salish-sea/animals/blob/main/decisions/0002-opaque-permanent-identifiers.md) makes `SSA:` identifiers opaque and permanent and [ADR-0010](https://github.com/salish-sea/animals/blob/main/decisions/0010-identifiers-are-never-reused.md) forbids reuse. Under that reading the epics could proceed in parallel.

**The asymmetry holds for individuals and fails for groups — and a bout tag is usually a group.** An acoustic bout is a group calling; [016](016-matriline-profile-pages.md) records the same fact for sightings ("most Bigg's sighting reports name the matriline — the richest identification signal we have"). And the group tier is precisely where the register is weakest, by its own account: [Q22](https://github.com/salish-sea/animals/issues/13) calls the derived matrilines "the least confident thing in the register" and says "getting it wrong is 132 wrong groups." Our [reconciliation](../reference/register-reconciliation.md) put numbers on it — 73 of our 132 matriline groups have no register entity at all, because both sides read the same sheet and kept different levels.

So "identifiers that later change" is not the real hazard — the identifiers won't change. The hazard is *tagging at a level that turns out not to exist*. A moderator who hears the T073As today has only `SSA:0002039` (`T073s`, the whole lineage) to reach for. If Q22 answers that sub-lineages are real, every such tag is permanently coarser than what the moderator knew; if it answers the other way, tags are fine but our catalogue rewrites 213 membership rows. Either way, the group vocabulary a moderator picks from should be settled before tags accumulate against it.

**And there is a credibility ordering.** [028](028-salishsea-io-speaks-to-orcasound.md) makes this site the single voice recommending an identification schema to OrcaSound — a genuinely external project, as ADR-0012 is careful to say. The naming half already set the precedent: names shipped on ourselves first (`salish-ayb`, [033](033-register-names-the-animals.md)), and *then* the recommendation went upstream, proven. Asking OrcaSound's moderators to commit permanent tags to a register tier we have measured, found divergent, and not yet adopted ourselves inverts that. "Migrate before" keeps the rule simple: we never recommend a commitment we have not already made.

## What this does not block

The gate is on *writing tags in production*, not on building. All of `salish-8vr`'s schema and vocabulary work is register-shaped without writing any `SSA:` row against a bout:

- [orcasite#1013](https://github.com/orcasound/orcasite/issues/1013) (`kind` + `iri` on tags) — shape only; safe and wanted early.
- [orcasite#1015](https://github.com/orcasound/orcasite/issues/1015) (register-aware tag picker) — can be built and reviewed; it goes live after the migration.
- Classifying the existing 94-tag vocabulary, machine-class mapping, curator verification (`salish-8vr.15`, `.10`, `.3`) — none writes identifiers to bouts.

Recorded in the graph as `salish-8vr.9` blocked-by `salish-ox2.5`, so both epics see the ordering where they plan.

## Consequences

- **The first tagged bout now transitively waits on Q22.** `ox2.5` is blocked by `ox2.6` (the sub-matriline question, which *is* Q22) and `ox2.3` (the six collision rows). This decision accepts that: the wait is the point, because Q22 is exactly the uncertainty a moderator's tag would be written against.
- **The urgency flows to Q22, deliberately.** The path to OrcaSound tagging runs through an upstream curator question, which is pressure in the right place — the people who know the animals settle the group vocabulary once, instead of two consumer databases each guessing.
- **If Q22 stalls, the fallback is scoped tagging, not reversal.** Individuals resolve 510/510 and ecotypes 1/1; a picker restricted to those tiers would honour this decision's logic while groups wait. That is a deliberate future amendment if needed, not the plan.
- **The recommendation to OrcaSound gets communicated, not just recorded** (028: our call to make *and communicate*). The natural moment is on [orcasite#1015](https://github.com/orcasound/orcasite/issues/1015) when the picker approaches merge: build now, flip on after our migration.

## Alternatives considered

- **Parallel, on the asymmetry argument** — `SSA:` identifiers are permanent, so tags are safe whenever written. Rejected above: true tier by tier, and false for the tier bouts actually get tagged with while Q22 is open.
- **Tag first, migrate second.** Nothing recommends it; it maximises the time OrcaSound spends committed to a register its recommender has not adopted, and was only ever on the table because ADR-0012 phrased the question symmetrically.
- **Per-tier gating now** (individuals tag immediately, groups wait). The honest reading of the asymmetry, and rejected only on simplicity: it complicates the picker and the recommendation for little gain, since the picker (`salish-8vr.9`) is not built yet and the migration may well land before it ships. Kept as the named fallback above rather than the rule.

## Reference

Epic ordering: `salish-ox2` before `salish-8vr` tag-writing; issue `salish-ox2.4`. The question: animals [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md) (open questions). Voice: [028](028-salishsea-io-speaks-to-orcasound.md). Precedent: [033](033-register-names-the-animals.md). Group divergence: [`docs/reference/register-reconciliation.md`](../reference/register-reconciliation.md), [Q22](https://github.com/salish-sea/animals/issues/13).
