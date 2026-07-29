---
title: Findings for occurrence and identification design, from the register side
date: 2026-07-29
context: accumulating handoff from salish-sea/animals; discharges ADR-0018's open question
---

# Findings for occurrence and identification design

**This is a findings file, not a specification.** It accumulates things learned while
designing the animal register ([salish-sea/animals](https://github.com/salish-sea/animals))
that whoever designs occurrences and identifications here needs to know. Decisions get made
in `docs/decisions/`, not here — most plausibly as an amendment to
[013](../decisions/013-orcasound-acoustic-occurrences.md) or a successor.

The conceptual model these findings sit in is
[evidence-and-claims-model.md](evidence-and-claims-model.md). Read that first if the
findings below seem to presume a shape. Two of them are re-framed by it: F4/F5 (absence, and
the no-animal case) become instances of *typed independent determinations*, and F7
(confidence) becomes one axis among five.

Why it exists: the register repeatedly disclaimed owning annotation semantics while
remaining the only place they were written down, which
[animals ADR-0018](https://github.com/salish-sea/animals/blob/main/decisions/0018-annotation-semantics-belong-to-consumers.md)
finally fixed by naming this repository the owner. Its closing open question is that the
substance would be relocated in prose and then dropped. This file is where it lands
instead. **Append as things surface; don't wait for a decision to be ready.**

---

## The register's two hard requirements

Everything else about an identification is this repository's to decide. The register asks
for exactly two things, and asks for them as requirements rather than as columns:

1. **Cite an identifier, never a name.** A label is the register's claim about what a thing
   is *called* and is expected to change
   ([ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md)).
   Note this repository's public routes currently key on `primary_designation`, which is a
   live violation and part of the migration bill in
   [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md).
2. **Record which edition the identifier was read at.** See below — this is the one with
   real schema consequences.

## F1 — Record the edition on the ingest run, not on the identification

*Revised 2026-07-29. The first version of this finding claimed an `SSA:` reference is only
interpretable together with the edition it was read at, and offered three homes for it
"in increasing fidelity", implying per-identification was best. That was wrong, and the
register's own rules are what make it wrong.*

**Under [ADR-0010](https://github.com/salish-sea/animals/blob/main/decisions/0010-identifiers-are-never-reused.md)
an identifier is never reused and its meaning never changes**, which is why the register can
say a breaking change essentially cannot occur. A stored identifier is therefore
self-sufficient, and the three cases that look like they need an edition do not:

- **Resolving a label.** Use the current one. Identifiers are permanent precisely so labels
  can change ([ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md));
  rendering a 2026 identification under J pod's present name is correct, not a distortion.
- **Deriving ancestors.** Follow F3, store the pick, derive against the current closure —
  you want to display what we now believe. The historical closure is archival, not
  operational.
- **Handling a deprecation.** `deprecations.tsv` is keyed on the identifier, so it tells you
  SSA:0000022 split regardless of which edition the moderator was reading. See F2.

### What actually needs an edition

**One value per ingest run or materialization, so derivations are reproducible.** If you
build denormalized ancestors, a search index, or a DwC export, the edition that produced
them is what lets you audit or rebuild. "Why does this occurrence say Southern Resident when
J pod now sits under Resident?" is a question about the materialization, not about the
moderator's claim. That is one column on a run record — cheap, and it is the whole of the
requirement.

Two weaker cases, recorded so they are not rediscovered as if new:

- **What the moderator *couldn't* say.** The edition describes the set on offer. Someone who
  tagged "J pod" before the J17s matriline existed could not have been more specific;
  someone tagging today chose not to be. Without the edition those are indistinguishable —
  the same shape as F6, one level down. Even this is an attribute of the *tagging session*
  rather than of each row, and it is speculative until someone actually wants to ask it.
- **Insurance against the register breaking its own rule.** If Q22's re-cut of 132 Bigg's
  matrilines is done by editing membership in place instead of deprecating and reminting,
  an identifier's meaning will have silently changed and the edition becomes the only
  forensic record. An argument from distrust rather than from design — but the re-cut is
  real and pending, so it is not zero.

### Consequence for the register's stated requirement

[animals ADR-0018](https://github.com/salish-sea/animals/blob/main/decisions/0018-annotation-semantics-belong-to-consumers.md)
lists "record the edition you read it at" as one of only two requirements it places on an
annotation, justified as keeping the claim interpretable. That justification is
double-counting ADR-0010. Raised on the register side; the honest version is narrower —
record the edition you *derived from*, so derivations are reproducible.

## F2 — Deprecation reaches into identifications, and it is not always mechanical

The register never deletes or reuses an identifier
([ADR-0010](https://github.com/salish-sea/animals/blob/main/decisions/0010-identifiers-are-never-reused.md)),
but entities do get deprecated, and `data/deprecations.tsv` distinguishes two cases:

- **`replaced_by` populated** (a rename or merge) — migration is mechanical, rewrite the
  reference.
- **`replaced_by` empty, `consider` populated** (a split) — there is no single successor.
  The register's own walkthrough is explicit that a consumer must **not** silently rewrite;
  it should surface the record for a human to re-decide, and until then the old reference
  stands and still resolves.

That "surface for re-decision" state has no home in `identification_status`
(`candidate` / `validated` / `rejected`). A `validated` identification whose entity later
splits is not thereby `rejected` — the moderator was right at the time. This wants either a
fourth state, a separate flag, or a queue that lives outside the enum. **Flagging it as an
enum-shape question because the enum values are marked LOCKED in the migration.**

Concrete near-term instance: Q1 in the register is likely to reparent the Southern
Residents, and Q22 may re-cut 132 Bigg's matrilines. Both are live.

## F3 — Store what was picked, not what was derived (register handed this over explicitly)

The register declined this question as the consumer's
([Q5](https://github.com/salish-sea/animals/blob/main/docs/open-questions.md)) but recorded
the reasoning, which is the useful part and is *not* the obvious one:

> The two options were framed as a size trade-off, and that is the least interesting
> difference between them. They promise different things over time. Storing what the
> moderator picked is a faithful record of an act of identification and stays true as one.
> Deriving instead tracks the register, so the ecotype shown against a 2026 bout will change
> when Q1 reparents the Southern Residents.

**Recommendation for this side: store the picked entity, derive ancestors for display.**
An identification is a record of a human act; it should not change meaning when the
taxonomy under it moves. Deriving is cheap because the register publishes the transitive
closure precomputed as `dist/ancestor.tsv`, so nothing is lost by not denormalising.

Note this *reduces* the need for F1: a stored pick stays true on its own, because the
identifier's meaning does not change. It is a derived ancestor that is edition-dependent,
which is why the edition belongs on the materialization rather than on the claim.

## F4 — `is_present` already answers a question the register left open

`identifications.is_present` (false = absence, "the T065As minus A5") answers ADR-0009's
deliberately-unanswered "how are negative and absence claims recorded?". **Keep it.** The
register-side sketch has no equivalent and defers to this one. Worth noting explicitly in
whatever decision supersedes 013, because it currently reads as an implementation detail
rather than as the answer to a known design question.

## F5 — "No animal named" is zero identifications, and the interface has to allow it

A moderator may know a call type and not its producer. In this schema that is an occurrence
with zero identifications rather than a nullable subject — structurally already available,
since `identification_subject_ck` requires exactly one subject *per row* and says nothing
about requiring rows.

**The risk is in the interface, not the schema.** A form that demands a tag produces exactly
the same bad data as a schema that does: the moderator picks the nearest available entity,
and a hedged humpback becomes a confident Bigg's. This is the same failure the register
names about certainty — *a certainty column is worth exactly as much as the affordance that
fills it.*

## F6 — Reviewed-and-empty must be distinguishable from unreviewed

The register's one standing warning to consumers: **a biophony bout may be about no animal
at all, so the absence of identifications is not the absence of animals.** An unreviewed
occurrence and a reviewed-one-with-nothing-in-it are indistinguishable otherwise, which
breaks any ecological reading of the data.

Given F5 makes zero-identifications a legitimate state, this stops being a caveat and
becomes a **schema ask on the occurrence**: some curation marker (`reviewed_at`, or a
curation state) that separates "nobody looked" from "someone looked and there was nothing".
Cheap now, expensive to backfill.

## F7 — `confidence` numeric vs. a coarse enum: probably not a conflict

`identifications.confidence` is a `REAL`. The register's sketch argued for a three-value
enum (`certain` / `probable` / `possible`) on the grounds that **a numeric probability
implies a precision a listening moderator does not have.**

The argument is worth keeping but the conflict may be illusory: a CV match genuinely has a
real-valued score, and a person hedging genuinely does not. If both stay, the thing to avoid
is a UI that manufactures a number from a human hedge (`possible` → `0.5`), which is the
failure the register's argument is actually about. Two fields, or a nullable numeric read
only when `method = 'cv'`, both avoid it.

## F8 — Two ways to say "an orca was here", after the migration

`public.occurrences` carries a `taxon` (an `inaturalist.taxa` reference) *and* an
`identifiers` list, which is a clean split today: species from iNat, individuals and groups
from the catalogue.

The register has since minted `kind = taxon` entities — *Orcinus orca*, humpback, Steller
sea lion, California sea lion, harbour seal — in the **same identifier space** as
individuals and groups
([ADR-0003](https://github.com/salish-sea/animals/blob/main/decisions/0003-one-identifier-space.md),
[ADR-0008](https://github.com/salish-sea/animals/blob/main/decisions/0008-species-identity-is-delegated.md)),
precisely so a moderator can tag at the level they are sure of when an orca is heard too
faintly to place in an ecotype. Roughly 30% of the biophony corpus previously had nothing
taggable.

So after the ADR-0012 migration there will be two representations of a species claim. Not a
bug, but a reconciliation to make deliberately. Note the register's taxon entities are
*delegating* — `mappings.tsv` records where NCBI/WoRMS place a thing rather than asserting a
belief — so they are a crosswalk target, not a competing taxonomy. The likely resolution is
that `occurrences.taxon` stays iNat-backed and register taxon entities resolve into it via
`mappings.tsv`, but the XOR check on `identifications` will need revisiting either way.

## F9 — Designation normalization has one implementation and should keep having one

`normalize_designation()` here handles zero-padding (`T65A5` → `T065A5`), casing and the
trailing matriline `s`. The register has the same problem
([Q17](https://github.com/salish-sea/animals/blob/main/docs/open-questions.md), open) and
currently assumes exact string match against hand-enumerated names.

Two implementations that disagree is the exact failure the register exists to prevent. The
register publishes `dist/searchable_name.tsv` — preferred plus every alternate and hidden
name merged — which is the natural lookup table for text extraction, and would let this
side match against published data instead of a locally-maintained rule. Worth raising on
the register side as the resolution to Q17 rather than solving twice.

## F10 — `occurrences.count` and the register's refusal are different things, and must stay so

The register publishes no counts of animals, deliberately and as a decision
([ADR-0017](https://github.com/salish-sea/animals/blob/main/decisions/0017-no-counts.md)):
the roster is knowingly incomplete, and a count derived from it would be a count of
*descent* rather than of a travelling group.

`occurrences.count` is a different claim entirely — how many animals a reporter said they
saw — and is perfectly legitimate. The trap is any UI that puts them near each other, or any
aggregate that fills a missing `count` from matriline membership. **A consumer may compute a
count and own the claim; it may not present a derived one as the register's.**

---

## Still to capture

- Whether an identification's subject should become a single nullable `entity_id` after the
  migration, collapsing the individual/group/taxon distinction into the register's one
  identifier space (F8).
- What a moderator's `possible` becomes when a curator later validates it — the
  confidence/verification split is the *reason* this file exists, and the shipped enum
  already models it, but the transition rules are unwritten.
- Time-range occurrences (bouts) vs. point occurrences, already noted in decision 013's
  consequences; interacts with nothing here yet but will when segments are built.
