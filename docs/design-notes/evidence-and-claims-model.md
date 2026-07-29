---
title: Evidence, subjects, claims and aggregates — the conceptual model
date: 2026-07-29
context: design conversation, 2026-07-29; conceptual only, no schema proposed
---

# Evidence, subjects, claims and aggregates

**Conceptual model, not a schema.** The payoff being aimed at is interaction design: if the
model is right, it should be obvious how an uploaded sighting, an iNaturalist observation
and an OrcaSound record are the same kind of thing. Nothing here proposes tables, and
several parts are deliberately unresolved.

This is the long-chewed-on part of the project, and the claim is that it is *uniquely*
interesting rather than merely fiddly. See "Why this is unusual" below.

Related: [occurrence-identification-findings.md](occurrence-identification-findings.md) is
the punch-list of concrete findings with owners; this note is the model those findings sit
in. [CONTEXT.md](../../CONTEXT.md) holds the vocabulary and has a pending correction noted
at the end.

---

## 1. What the biodiversity standards give us

Darwin Core's relevant classes, and the joints between them:

- **Occurrence** — an Organism at a place at a time. The publication atom.
- **Event** — an action at a place over a period; nests via `parentEventID`.
- **Organism** — a particular animal or taxonomically homogeneous group; `organismID` is
  where individual identity lives.
- **Identification** — a *taxonomic* determination: `identifiedBy`, `dateIdentified`,
  `identificationVerificationStatus`, `identificationQualifier`.
- **ResourceRelationship** — typed edges between records.
- **Audubon Core** for media; **MeasurementOrFact** / eMoF for arbitrary attached values.
- **Humboldt Extension** for inventory completeness — effort and reported absence, the
  nearest standard answer to "we listened and heard nothing".

Two gaps worth stating plainly rather than apologising for:

- `dwc:Identification` is about **taxon**, not individual. There is no ratified class for
  "a claim that this is T065A, with evidence and a confidence". `organismID` presumes the
  question already settled.
- There is no TDWG standard for a **register of individuals and their social groups**. That
  absence is why [salish-sea/animals](https://github.com/salish-sea/animals) exists.

**The assumption every one of these shares:** that the unit of observation, the unit of
communication and the unit of publication coincide. The DwC-A star schema leans on it.

## 2. Four granularities, of which the standards name one

| | Unit | Duration | Boundary set by |
|---|---|---|---|
| Observation | a photo, a call | seconds | the sensor or the shutter |
| Communication | a sighting, a bout | minutes | the need to tell other sighters *now* |
| Publication | an Occurrence | — | GBIF/OBIS, which dedup on coords+date anyway |
| Inference | a segment | hours | identity continuity across observations |

The Orca Network case shows the collapse in miniature. A sighter photographs a passing
group; each frame has its own timestamp and bearing; Facebook forces a selection into one
post; and what is destroyed — which individuals were leading and which trailing — is
recoverable only from the granularity that was thrown away. This matters most for killer
whales, where individuals are identifiable and their order in a group is meaningful.

Note what sets the *communication* boundary: not a sampling protocol but **timeliness**. A
sighting is bounded by how long a sighter can wait before telling others. No biodiversity
standard models that, because their sources are surveys and archives.

## 3. Why this is unusual

iNaturalist and Happywhale are **archival and curatorial**. They want data at this
granularity, and they specifically do *not* want to support moment-by-moment tracking by a
grassroots network of people and machines.

This project is **operational** — near-real-time coordination among sighters, hydrophones,
detectors and moderators — that also publishes archival data downstream. Darwin Core serves
the archival half well. Nothing standard serves the operational half, and the operational
half is what demands the granularity.

The eventual form of the problem was described in another conversation as *"open-universe
probabilistic multi-target tracking with heterogeneous evidence fusion and retroactive
(smoothing) identity resolution."* **That is explicitly not being built now or soon.** It is
recorded because it sets a constraint on what may be discarded today: preserve evidence at
high granularity and fidelity, and do not abstract over signals more than necessary.

## 4. The layers

Four kinds of thing. The first three are the model; the fourth is where the hard problem
lives.

### Evidence item

A photo, an audio detection, a text statement. Carries its own time, often its own place and
bearing. May be entirely uninterpreted. **Has exactly one provider** — a person or a
machine — and you would never re-file someone else's photo under your own report.

### Subject

The animal or group a claim is *about*. Often implicit: the single subject of one or several
images.

**Modelling the subject explicitly is required, not an elaboration.** An earlier version of
this model had determinations attaching directly to a sighting, with two subjects in one
photo handled as "just two determinations". That is wrong: an otter determination and a
determination about the otter's prey would then read as *conflicting* claims about one
thing. Without an explicit subject there is no way to distinguish disagreement from two
claims about two different animals — and disagreement is the thing the system exists to
represent.

This is functionally what an iNaturalist Observation *is*: a subject container that
identifications vote on. Note it is distinct from the subject-as-*answer* — a resolved
individual or group. The subject slot exists **before** it is identified, and competing
determinations contend over it.

That iNaturalist duplicates an observation to identify an otter's prey is a matter of
convenience and efficiency — it avoids storing the evidence twice and re-entering
coordinates. Here the equivalent pull is a UI one: show the evidence once, with several
subjects on it. That is a reason to model subjects properly rather than to copy the
duplication.

### Determination

A claim about a subject, citing zero or more evidence items. Zero matters: a bare "20 orcas
off Lime Kiln" is a legitimate determination with no evidence.

**Evidence is owned; determinations are open.** One provider per evidence item; anyone may
contribute a determination.

### Aggregate

A sighting, a bout, a segment. Each groups evidence and determinations under a stated
criterion. Section 6 is about why these cannot be mere views.

## 5. Determinations are typed and independent

At least five axes, separately asserted, separately confident, by different actors:

| Axis | Example | Vocabulary owner |
|---|---|---|
| Category | biophony / anthrophony / geophony | OrcaSound |
| Taxon | *Orcinus orca* | iNaturalist / NCBI, via crosswalk |
| Identity | T065A, J pod, the T023s | the animals register |
| Signal type | an S1 call | `orcasound/signals-srkw` |
| Count | "about twenty" | ours |

Two things fall out.

**A known special case dissolves.** "A signal must be recordable with no animal named" —
carried over from the register's Q7 — is simply *category and signal type determined,
identity not determined*. No nullable subject, no zero-rows trick. Likewise a photo can have
its taxon determined and its individual not.

**Count is a claim, not a property.** It is made by a sighter, so it belongs here rather
than as a field on an occurrence. An upload could carry a human's "ten porpoises" and a
detector's contradictory count, and both rows survive. The consequence is at export:
`dwc:individualCount` is a scalar, so publishing forces a judgement — take the range, or
apply one and record that it is *ours*.

## 6. The hard problem: judgements attach to accumulations

The sentence that makes this tractable:

> some judgments will be applied to accumulations of evidence, and not to every piece
> individually

Which yields the reason aggregates cannot be derived views: **you cannot attach a claim to a
query result.** If a judgement lands on an accumulation, the accumulation needs a stable
identity to receive it.

Three aggregates, and how each behaves:

- **Sighting** — a person's report, bounded by timeliness. Relatively stable.
- **Bout** — moderator-curated, and *a handle for navigation and communication*: it has a
  URL, people refer to it. Its extent in space and time may shift while identifications are
  in play.
- **Segment** — **a claim about travel**, not an arbitrary grouping. It asserts that the same
  individuals or group moved from one place to another, and it is not made unless identity
  continuity is established, by identifying individuals or by eliminating other
  explanations. It has a travel speed and a last-seen location. Heuristics *propose* a
  segment; the identity-continuity claim is what *makes* it one.

So a segment is itself a determination whose subject is a set of observations. And a bout
needs stable identity with unstable extent.

### The deprecation unification

The hypothesis — and it looks right — is that this is **an instance of a general problem
that also includes individual identifiers, and the same mechanisms of deprecation and
replacement apply.** A bout whose extent shifts materially is a new bout with the old one
deprecated, exactly as a re-cut matriline is. `replaced_by` for the clean case, `consider`
for a split.

The constraint is identical in both places: an identifier cannot be mutated in place because
claims cite it.

Two places it strains, both about scale rather than about the mechanism:

- **Cadence.** A matriline splits once a decade; a segment could be re-cut by every arriving
  sighting. The register's rule for a split — surface it for a human to re-decide — is
  affordable at register volume and not at sighting volume. Either that step is automated
  for aggregates, or the threshold for what earns an identifier moves. A candidate
  criterion: **an aggregate earns a durable identifier when someone communicates about it** —
  the same criterion that bounds a sighting.
- **Two changes that look alike.** A segment extending because the animals kept travelling
  is *valid-time growth*; a segment re-cut because an identification was wrong is
  *assertion-time correction*. The register separates those axes already
  ([animals ADR-0006](https://github.com/salish-sea/animals/blob/main/decisions/0006-valid-time-in-data-assertion-time-in-git.md));
  growth should probably not burn an identifier and correction should. This distinction is
  likely what keeps churn tolerable.

**OrcaSound dodges rather than solves this.** A bout is created manually, only once there is
sufficient evidence, and staffing limits mean few bouts exist. Sightings arrive at much
higher volume, so the dodge does not transfer.

## 7. The counterweight: don't over-build this

Held open deliberately, because it pulls against section 6.

Getting crisp about these relationships is a temptation toward too complicated a data model,
or too complicated a UI. And there is real evidence that the rigour may be unnecessary:
**nothing stops an iNaturalist observer from arbitrarily changing an observation after it has
reached Research Grade, and mostly this is not a problem.**

iNaturalist's answer is *mutate and re-publish*, not *deprecate and replace*, and it works.
Unresolved what to do with that.

One hypothesis, offered as such: iNaturalist gets away with it because its citing systems
re-harvest wholesale and nobody coordinates operationally off an individual observation's
identity. The cost of mutation rises exactly when an identifier enters circulation — when
someone is referring to a bout URL in real time. If so, the reconciliation is *mutate freely
at low stakes; deprecate only once an identifier has been communicated about* — which is the
same threshold section 6 arrived at from the other direction. Not established.

## 8. Method

The two sharpest open questions below are not expected to yield to further abstraction.
**The way to resolve them is to trace the actual work and the interactions between actors:
the design lives in context, given real, constructive constraints.** This mirrors what the
register found useful — tracing one real record end to end exposed more than reasoning about
the schema did.

## 9. Open questions

1. **Does a determination's subject range freely over aggregates?** "This bout is biophony"
   and "this segment is J pod at four knots" both attach to aggregates rather than to
   organisms. Uniformity is elegant; the polymorphic subject reference is awkward. Needs
   more thought.
2. **What is a sighting's identity while the encounter is still unfolding?** A shore regular
   posting three times in twenty minutes as a group passes: one sighting revised twice, or
   three sightings that a segment then binds? The timeliness criterion suggests three, but
   then "encounter" needs defining by something other than posting behaviour. Needs more
   thought.
3. **How is count aggregated at publication**, given several contradictory claims and a
   scalar target field?
4. **How much of section 6's rigour is actually needed**, given section 7?

## 10. Follow-ups outside this note

- **`CONTEXT.md`'s definition of Segment describes the implementation, not the concept.** It
  reads "chronologically related observations of the same species grouped into a travel
  chain; imputed client-side from time/distance heuristics and per-species travel speeds" —
  which would permit an arbitrary grouping to be called a segment. The identity-continuity
  claim is the defining part. Left unedited so the wording can be reviewed on its own.
- **Standards facts to verify before citing them anywhere load-bearing:** the Humboldt
  Extension's exact term names and ratification state, and where GBIF's unified/new data
  model has landed. The Darwin Core classes and terms in section 1 are solid; those two are
  from memory.
- **Wildbook/Flukebook vocabulary collision**, for the planned integration: Wildbook's
  *Encounter* is one animal at one time and place, and its *Occurrence* is a group of
  encounters — so Wildbook's "Occurrence" is closer to our *sighting* than to our
  **Occurrence**.
