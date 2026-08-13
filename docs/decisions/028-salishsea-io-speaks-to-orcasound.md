# 028 — SalishSea.io is the single voice recommending an identification schema to OrcaSound

**Status:** accepted · **Decided:** 2026-08-13 · **Answers:** the closing open question of [animals ADR-0018](https://github.com/salish-sea/animals/blob/main/decisions/0018-annotation-semantics-belong-to-consumers.md)

## Context

Two repositories in the salish-sea org have a stake in how OrcaSound records what a
moderator heard:

- **[salish-sea/animals](https://github.com/salish-sea/animals)** — the register. It owns
  *identity*: which animals and social groups exist, what they are called, and how they
  nest. Its identifiers are what a tag would have to cite.
- **this repository** — the aggregator. It owns *annotation*: what an occurrence is and how
  a claim about which animals were present is recorded — evidence, method, confidence,
  verification state, presence/absence. `public.identifications` has shipped with data in
  it; decision [013](013-orcasound-acoustic-occurrences.md) defines an acoustic occurrence
  as one curated biophony bout identified by structured upstream tags.

OrcaSound ([orcasound/orcasite](https://github.com/orcasound/orcasite)) is external to
both. Neither repository decides its schema; the most either can do is publish a
recommendation — [orcasound/orcasite#1001](https://github.com/orcasound/orcasite/issues/1001).
ADR-0018 closed by naming the risk and leaving it open: *"Two projects independently telling
a third what its annotation schema should be is worse than one."*

## Decision

**SalishSea.io writes and posts the recommendation. The register does not address OrcaSound
directly on annotation.**

Because SalishSea.io is the **consumer of the occurrence records orcasite emits**. The
recommendation asks orcasite to change what it publishes; the party qualified to make that
ask is the one that reads the output and can say concretely what breaks without it —
which bouts become unusable, which identifications land as `candidate` instead of dropped,
what the free-text fallback costs. The register has no consumer and no annotation data, so
its version of the same ask would be a shape argued from first principles rather than a
requirement traced to a downstream failure.

This is the same split ADR-0018 already made, carried one step further: annotation
semantics live here, and so does the mouth that speaks them.

The register's identifiers still travel in the recommendation — that is most of its
substance — but they travel **cited by the consumer**, the way any other upstream
dependency does. Where the register wants something (an identifier rather than a name; a
derived fact recording its edition), it states it as a requirement in its own ADRs and this
repository carries it into #1001 in a form OrcaSound can implement. If the recommendation
and the register disagree, that is a bug to fix here before posting, not two positions for
OrcaSound to adjudicate.

## Rejected alternatives

- **The register speaks.** It is where the tag vocabulary's terms come from, and it is the
  more formally reviewed repository. But it would be recommending an annotation schema it
  has explicitly disclaimed owning four times over — reintroducing exactly the confusion
  ADR-0018 exists to end, and inviting a reader to implement from ADR-0009's illustrative
  five-column table.
- **Both, on their own topics** — the register on identifiers, SalishSea.io on annotation
  columns. Clean in theory, unworkable in practice: a tag slug *is* both at once, and
  splitting the ask across two issue threads in two voices leaves OrcaSound reconciling
  them. One recommendation with one author is the whole point.
- **A joint statement from the salish-sea org.** No worse in substance, but it invents a
  publishing venue with no status field, no supersession, and no owner — the objection
  ADR-0018 already sustained against moving contested design into discussions.
- **Say nothing and parse the bout `name` downstream.** Already rejected in 013 as fragile
  and lossy. Nothing here revisits it.

## Consequences

- **orcasound/orcasite#1001 is this repository's issue to carry**, including the corrected
  cost estimate — it currently understates the ask as "only slug conventions and a
  moderator habit", where the register's uncertainty requirement implies a schema change
  (a `certainty` column on `item_tags`). Reposting it is tracked as `salish-8vr.2`.
- **The recommendation cannot be posted before the shape is settled here.** Q18's
  substance — the confidence/verification split, and allowing a signal recorded with no
  animal named (an occurrence with zero identifications) — has to land as an amendment to
  013 or a successor first (`salish-8vr.4`). Speaking with one voice only helps if the
  voice has something coherent to say.
- **Register changes reach OrcaSound through here.** A new entity kind, a renamed label, or
  a deprecation does not become an upstream ask on its own; it lands in
  [docs/design-notes/occurrence-identification-findings.md](../design-notes/occurrence-identification-findings.md),
  gets decided in `docs/decisions/`, and is carried into #1001 if it changes what we ask of
  orcasite.
- **This adds a hop for the register.** Accepted: the alternative is two authors, and in
  practice both hats are worn by the same person, which is precisely why the boundary needs
  to be written down rather than remembered.
- OrcaSound remains free to ignore all of it. 013's "pending upstream adoption" status is
  unchanged by this record.

## Reference

Register-side context: [animals ADR-0018](https://github.com/salish-sea/animals/blob/main/decisions/0018-annotation-semantics-belong-to-consumers.md)
(annotation belongs to consumers), [ADR-0009](https://github.com/salish-sea/animals/blob/main/decisions/0009-uncertainty-on-the-annotation.md)
(no hedge terms in the vocabulary), [ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md)
(a label is a preferred name), [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md)
(register ↔ catalogue). Our side: [013](013-orcasound-acoustic-occurrences.md),
[docs/design-notes/occurrence-identification-findings.md](../design-notes/occurrence-identification-findings.md).
Upstream: [orcasound/orcasite#1001](https://github.com/orcasound/orcasite/issues/1001).
Epic: `salish-8vr`.
