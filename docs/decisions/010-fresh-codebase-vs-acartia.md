# 010 — SalishSea.io is a fresh codebase, not an extension of acartia.io

**Status:** accepted · **Decided:** 2026-06 (recorded 2026-07-03)

## Context

SalishSea.io and **acartia.io** do substantially the same thing: receive Salish
Sea sighting data and put it on a map. Both live under the **Acartia Data
Cooperative** (a Beam Reach initiative). acartia.io is ~6 years old but anemic —
it has never had sustained technical leadership and has largely served as a
learning ground for design interns.

The concrete trigger was a request to **fold iNaturalist observations into
Acartia**. Fulfilling that literally would have meant extending the existing
acartia.io codebase.

## Decision

Build a **new codebase** (SalishSea.io) rather than adding the requested feature
to acartia.io. SalishSea.io re-founds the acartia.io function under new technical
leadership, **still within the Cooperative** and funded by Beam Reach — it is a
re-founding, not a fork away from the org.

## Alternatives considered

- **Extend acartia.io in place.** The literal ask. Rejected: inheriting six years
  of intern-era code with no sustained maintainer would spend most of the effort
  on excavation, and would anchor the work to a stack and data model chosen for a
  different era. The marginal iNaturalist feature was not worth adopting that
  liability.
- **Greenfield outside the Cooperative.** Rejected: the Cooperative's data
  relationships (Orca Network → Acartia → WRAS → Conserve.io) and CC-BY
  contributor agreements are the whole point; leaving would forfeit them.

## Consequences

- **Two projects nominally do the same thing inside one cooperative.** This reads
  as duplication to an outsider; this record exists so it doesn't. SalishSea.io is
  the actively-led continuation; acartia.io is the prior reference project.
- The relationship is **social, not just technical.** External liaison for the
  Cooperative has historically run through Scott Veirs (Beam Reach); SalishSea.io's
  standing to build its own partner relationships (Orca Network, Wild Me/Flukebook,
  the bracketed-tag Facebook communities) is a live, non-code question — tracked in
  [docs/strategy/community-uptake.md](../strategy/community-uptake.md), not here.
- A future consolidation (retiring acartia.io, or merging identities) is possible
  but out of scope for this record.

## Reference

Domain vocabulary: [CONTEXT.md](../../CONTEXT.md) (Acartia Data Cooperative,
acartia.io, Beam Reach). Community strategy:
[007](007-community-uptake-strategy.md),
[docs/strategy/community-uptake.md](../strategy/community-uptake.md).
