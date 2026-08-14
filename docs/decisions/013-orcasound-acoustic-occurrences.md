# 013 — OrcaSound acoustic occurrences come from curated biophony bouts, identified by upstream tags

**Status:** accepted (our side) · **pending upstream adoption** · **Decided:** 2026-07-06 ·
**Amended:** 2026-08-14 (see [Amendment](#amendment-2026-08-14) — identifications arrive
typed, and the upstream ask is a schema change)

## Context

[CONTEXT.md](../../CONTEXT.md) has long reserved **acoustic detection** — an occurrence
derived from sensor data rather than a human report — as a planned OrcaSound integration.
Issue [#178](https://github.com/salish-sea/salishsea-io/issues/178) opened the question with a
single unanswered comment: "What is it we want? Detections? Bouts?"

OrcaSound (the [orcasound/orcasite](https://github.com/orcasound/orcasite) project, an Elixir/
Ash app, a sister project in the Acartia cooperative) exposes acoustic activity at three grains:

- **Detection** — one button-press. `source: :human` (an anonymous listener clicked) or
  `source: :machine` (OrcaHello ML). Instant timestamp, `category` whale/vessel/other. Very
  noisy: any listener can fire one on any sound.
- **Candidate** — auto-clustered detections at one feed in a time window. Machine-grouped, no
  human vetting. GraphQL-only (no JSON:API route).
- **Bout** — a *moderator-curated* activity period: `start_time`/`end_time`, an audio
  `category` (`biophony` / `anthrophony` / `geophony`), one `feed` (hydrophone). Exposed on
  JSON:API `/api/json/bouts`.

Empirical review of the live API (2026-07-06): ~196 bouts exist, of which 134 are `biophony`.
Reading their `name` text, ~70% are killer whales (often to ecotype and pod — "SRKW J pod",
"Bigg's T090s"), ~9 humpback, and a tail of sea lion, fish, birds, OrcaHello false-positives,
and non-animal sounds mistagged as biophony. Curation peaked Nov 2025 (53/mo) and has fallen
to ~3–6/mo; the moderator (largely Scott Veirs) is on sabbatical.

## Decision

An OrcaSound **acoustic detection** occurrence is **one `biophony` bout** — located at the
bout's `feed` coordinates, spanning the bout's `start_time`/`end_time`. `anthrophony` and
`geophony` bouts are excluded (not organisms), as are raw detections and candidates.

A bout's **species / ecotype / pod / matriline** is read from **structured upstream tags**, not
parsed from the free-text `name`.

> ~~We asked OrcaSound (orcasound/orcasite#1001) to apply a controlled tag vocabulary to bouts
> (`ecotype:srkw`, `pod:j`, `matriline:t090`, `species:humpback`, `unconfirmed`/`false-positive`,
> …). Bouts already expose a `tags` relationship on the JSON:API (`Bout` `includes [:feed,
> :tags]`), so consuming it needs no upstream schema change — only slug conventions and
> moderator habit.~~
>
> *Retracted 2026-08-14. The vocabulary was not ours to invent and the cost was understated;
> both halves are corrected in the [Amendment](#amendment-2026-08-14) below, and the retraction
> is public in orcasound/orcasite#1001.*

Ingest follows the established pattern: mirror bouts + their tags **verbatim** into an
`orcasound` upstream-mirror schema, then **translate** at the boundary (decision
[008](008-source-schemas-are-upstream-mirrors.md)), within the imperative-shell ingest
architecture (decision [011](011-ingest-imperative-shell.md)). OrcaSound is already modeled as
a **Collection** with `collection_kind = acoustic_feed`. What "translate" means changed once
the tags carried identifiers — see the [Amendment](#amendment-2026-08-14).

## Rejected alternatives

- **Ingest raw detections.** The finest grain and the only one with an instant timestamp, but
  unvetted: any anonymous button-press, plus vessel/other categories that aren't organisms.
  Putting those on a public map asserts animal presence we can't stand behind. Curated-but-
  coarse (bouts) beats precise-but-noisy.
- **Ingest candidates.** The auto-clustered middle tier — still unvetted, and GraphQL-only,
  which would pull us off the documented JSON:API for a lower-quality signal.
- **Parse the bout `name` downstream.** Feasible (the killer-whale names are informative and
  our `public.extract_identifiers` already does this for Maplify comments) but fragile and
  lossy — it discards the moderator's knowledge and silently misclassifies the mystery /
  false-positive / mistagged tail. Fixing identity at the source is strictly better when the
  source is a sister project we can change.
- **Add first-class `species`/`ecotype`/`pod` attributes to the Bout resource upstream.** More
  rigid and more upstream work (migrations, GraphQL/JSON:API types, moderator forms) than tags,
  for a signal that is inherently multi-valued and open-ended — tags model it better.

## Consequences

- **Blocked on upstream.** The integration's value depends on OrcaSound adopting the tag
  vocabulary (orcasound/orcasite#1001). #178 is parked at `needs-info` pending that response,
  which may not come. This ADR records *our* side of the decision; the upstream contract is not
  yet ratified. *(Still true 2026-08-14, but no longer one all-or-nothing answer — the ask is
  now six issues that can be accepted separately. See the Amendment.)*
- Acoustic occurrences carry a **time range, not an instant** — new for our model, which is
  otherwise point-in-time. Segment/travel-chain heuristics and any DwC mapping must account for
  a bout's duration.
- Identity arrives as **candidate identifiers** (pod/ecotype/matriline), never validated
  `organismID` — consistent with the unvalidated-identifier rule (decision
  [004](004-rights-and-licensing.md), [docs/rights-policy.md](../rights-policy.md)).
- Volume is thin and currently declining; even a clean integration adds only a few occurrences
  per month until OrcaSound's curation cadence recovers.

## Amendment (2026-08-14)

Three things this record got wrong, and one that changed underneath it. The core decision —
an acoustic occurrence is one curated biophony bout, identified by structured upstream tags
rather than by parsing `name` — is unchanged and now better supported.

### 1. The vocabulary already exists, and it isn't ours

The original proposed slugs (`ecotype:srkw`, `pod:j`, `matriline:t090`) for OrcaSound to
adopt. By the time anyone acted on it, moderators had built their own: **94 distinct tags,
573 applications across 157 of 206 bouts** (live API, 2026-08-13), largely by Scott Veirs.
It is a better vocabulary than the one we sketched, because it came from the work.

So the ask was never "adopt tags". It is that the existing tags carry no *identity* and no
*structure* — `J` is a pod, `S01` is a call type, `MMSI-367479990` is a vessel, and nothing on
the record distinguishes them. A consumer is back to pattern-matching strings, which is the
fragility this record objected to, moved one field over.

**A tag's kind cannot be inferred from its shape.** `T090s` is an animal and `WCT07` is a
*sound* — a Bigg's call type, counterpart to the SRKW `S` numbers. We got that wrong ourselves
while drafting the upstream issues, from the strings alone, and published it before catching
it. The register [says so plainly](https://github.com/salish-sea/animals/blob/main/docs/scope.md).
That is the argument for an explicit `kind` column, not against it.

### 2. It is a schema change, and the requirement is ours

"No upstream schema change — only slug conventions and moderator habit" was wrong. Preserving a
moderator's uncertainty needs a column. The evidence is in OrcaSound's own data: eleven bouts
carry a `?` in the name, and in every one the hedge survives in prose and dies in the tags —
`SRKW signals at PT (J+K +L? pods)` is tagged `J`, `K`, `SRKW`, and **not** `L`. Both available
moves are wrong: applying `L` overstates what was heard, omitting it discards an observation.

That requirement is **this repository's**, as the owner of annotation semantics (decision
[028](028-salishsea-io-speaks-to-orcasound.md)). The register makes no such demand —
[ADR-0018](https://github.com/salish-sea/animals/blob/main/decisions/0018-annotation-semantics-belong-to-consumers.md)
grants it exactly two claims on an annotation, and ADR-0009's five-column table is explicitly
illustrative. Attributing the column to the register would re-create the confusion ADR-0018
exists to end.

### 3. `unconfirmed` / `false-positive` are withdrawn

Reading the live bouts, that request was three problems wearing one hat, and the register
[declined it](https://github.com/salish-sea/animals/blob/main/docs/open-questions.md) (Q21)
for the right reason:

- a **detector false positive** names no animal, so it is a flag on the detection or the bout,
  never a tag (note `detections.visible` already exists upstream and may cover it);
- **boat noise filed as `biophony`** is a wrong value in `bout.category`, not a vocabulary gap;
- a **mystery signal** should be tagged at the level the moderator is sure of, which is now
  possible because the register mints `kind = taxon` entities (`SSA:0000900` *Orcinus orca*,
  `SSA:0000901` humpback, the pinnipeds).

So `unconfirmed` was never a missing modality — it was a missing *entity*.

### 4. Identifications arrive typed, so the anti-corruption layer thins

This is the substantive architectural change. The original plan was to mirror tags verbatim and
**translate slugs** into our taxon + candidate identifiers at the boundary. If orcasite carries
`tags.kind` and `tags.iri` as asked, there are no slugs to translate: a tag arrives already
typed and already citing `SSA:0000020`, and the boundary's job shrinks from *parsing a
convention* to *resolving a stable identifier*.

Decision [008](008-source-schemas-are-upstream-mirrors.md) is unaffected — we still mirror
verbatim, and the mirror is still the place upstream shape is allowed to leak. What shrinks is
the amount of *interpretation* in the translation step, which is exactly the fragile part.

Where an `iri` is absent — free text remains legal upstream, deliberately, so vocabulary gaps
stay visible — we fall back to matching the tag name against the register. **That match uses
the register's published fold**
([ADR-0019](https://github.com/salish-sea/animals/blob/main/decisions/0019-names-are-compared-by-folding.md)):
lowercase, delete apostrophes and hyphens, collapse whitespace, replace each run of digits with
its decimal value, and never fold a trailing `s`. Under it, every animal-kind tag in the live
corpus resolves except `fish` (outside the register's taxonomic bound) and `calf` (a life
stage). Bare `T37` correctly yields **two** candidates — the matriline `T037s` and the
individual `T037` — which is ambiguity the vocabulary genuinely has, to be surfaced rather than
adjudicated by string manipulation.

Consequence for our code: `normalize_designation()` and the fold disagree — ours pads where the
fold strips, and our trailing-`s` stripping is the matriline/matriarch merge the fold refuses
across 126 pairs. Reconciling them is `salish-8vr.18`. This supersedes finding F9 in
[occurrence-identification-findings.md](../design-notes/occurrence-identification-findings.md),
which proposed `searchable_name.tsv` as a lookup *table*; the register publishes a *rule*
instead, with executable cases in `dist/fold_test.tsv`.

### What this amendment does not decide

`certainty` arriving from upstream is the **asserter's confidence**, and is not the same axis as
our `identifications.status` (`candidate` / `validated` / `rejected`), which is the dataset's
verification state. Keeping those apart is the whole of Q18's substance, along with allowing a
bout with no animal tags to land as an occurrence with **zero identifications**. That is a
separate decision, tracked as `salish-8vr.4`, and deliberately not settled here.

[028](028-salishsea-io-speaks-to-orcasound.md) makes that a gate — the recommendation "cannot
be posted before the shape is settled here". It was read as satisfied: what #1014 asks orcasite
for is a three-value hedge on the application, which is settled, and nothing published upstream
commits our own `identifications` schema beyond what this record already said. The genuinely
open question — whether our `confidence` stays a `REAL`, becomes a coarse enum, or both — never
surfaces in the upstream ask, because a *source* system records what its moderator said and
takes no position on how we verify it later.

### Upstream status

The single ask became six issues that can be accepted independently:
orcasound/orcasite[#1013](https://github.com/orcasound/orcasite/issues/1013) (`kind` + `iri`),
[#1014](https://github.com/orcasound/orcasite/issues/1014) (`certainty`),
[#1015](https://github.com/orcasound/orcasite/issues/1015) (register-aware picker),
[#1016](https://github.com/orcasound/orcasite/issues/1016) (classify the existing 94 tags),
[#1017](https://github.com/orcasound/orcasite/issues/1017) (machine class on detections), and
orcasound/orcahello[#597](https://github.com/orcasound/orcahello/issues/597) (send the class
label). #1001 is retained as the narrative that links them.

## Reference

Tracking issue: [#178](https://github.com/salish-sea/salishsea-io/issues/178). Upstream
proposal: [orcasound/orcasite#1001](https://github.com/orcasound/orcasite/issues/1001) —
this repository, not the animal register, is the voice that carries it
([028](028-salishsea-io-speaks-to-orcasound.md)).
Provenance model: [006](006-provenance-graph.md). Anti-corruption layer:
[008](008-source-schemas-are-upstream-mirrors.md). Ingest architecture:
[011](011-ingest-imperative-shell.md).

Register-side contracts this record now depends on:
[ADR-0019](https://github.com/salish-sea/animals/blob/main/decisions/0019-names-are-compared-by-folding.md)
(the fold, with cases in `dist/fold_test.tsv`),
[ADR-0018](https://github.com/salish-sea/animals/blob/main/decisions/0018-annotation-semantics-belong-to-consumers.md)
(annotation belongs to consumers),
[ADR-0010](https://github.com/salish-sea/animals/blob/main/decisions/0010-identifiers-are-never-reused.md)
(identifiers never change meaning, which is what makes storing one safe).
Open on our side: `salish-8vr.4` (the confidence/verification split) and `salish-8vr.18`
(reconciling `normalize_designation()` with the fold).
