# 013 — Orcasound acoustic occurrences come from curated biophony bouts, identified by upstream tags

**Status:** accepted (our side) · **pending upstream adoption** · **Decided:** 2026-07-06 ·
**Amended:** 2026-08-14 (see [Amendment](#amendment-2026-08-14) — identifications arrive
typed, and the upstream ask is a schema change) · 2026-09-20 (see
[Amendment](#amendment-2026-09-20) — orcasite is read directly, with no mirror schema; an
occurrence gains an end time; bouts stay out of the DarwinCore export for now)

## Context

[CONTEXT.md](../../CONTEXT.md) has long reserved **acoustic detection** — an occurrence
derived from sensor data rather than a human report — as a planned Orcasound integration.
Issue [#178](https://github.com/salish-sea/salishsea-io/issues/178) opened the question with a
single unanswered comment: "What is it we want? Detections? Bouts?"

Orcasound (the [orcasound/orcasite](https://github.com/orcasound/orcasite) project, an Elixir/
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

An Orcasound **acoustic detection** occurrence is **one `biophony` bout** — located at the
bout's `feed` coordinates, spanning the bout's `start_time`/`end_time`. `anthrophony` and
`geophony` bouts are excluded (not organisms), as are raw detections and candidates.

A bout's **species / ecotype / pod / matriline** is read from **structured upstream tags**, not
parsed from the free-text `name`.

> ~~We asked Orcasound (orcasound/orcasite#1001) to apply a controlled tag vocabulary to bouts
> (`ecotype:srkw`, `pod:j`, `matriline:t090`, `species:humpback`, `unconfirmed`/`false-positive`,
> …). Bouts already expose a `tags` relationship on the JSON:API (`Bout` `includes [:feed,
> :tags]`), so consuming it needs no upstream schema change — only slug conventions and
> moderator habit.~~
>
> *Retracted 2026-08-14. The vocabulary was not ours to invent and the cost was understated;
> both halves are corrected in the [Amendment](#amendment-2026-08-14) below, and the retraction
> is public in orcasound/orcasite#1001.*
>
> ~~Ingest follows the established pattern: mirror bouts + their tags **verbatim** into an
> `orcasound` upstream-mirror schema, then **translate** at the boundary (decision
> [008](008-source-schemas-are-upstream-mirrors.md)).~~
>
> *Superseded 2026-09-20: there is no mirror schema and no translation step — see the
> [Amendment](#amendment-2026-09-20).*

Ingest runs within the imperative-shell architecture (decision
[011](011-ingest-imperative-shell.md)). Orcasound is already modeled as a **Collection** with
`collection_kind = acoustic_feed`.

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

- **Blocked on upstream, but no longer on one answer.** The integration depends on Orcasound
  adopting the changes that let a tag carry identity, certainty and machine classification —
  now six issues that can each be accepted separately, listed under
  [Upstream status](#upstream-status) in the Amendment. orcasound/orcasite#1001 is retained as
  the narrative that links them, not as the ask itself. #178 stays parked at `needs-info`. This
  ADR records *our* side; the upstream contract is not ratified, and Orcasound may adopt some,
  all, or none of it.

  > ~~The integration's value depends on Orcasound adopting the tag vocabulary
  > (orcasound/orcasite#1001). #178 is parked at `needs-info` pending that response, which may
  > not come.~~ *Superseded 2026-08-14: the vocabulary already exists and was never the ask —
  > see the Amendment. Kept because "waiting for one response" is what this record wrongly told
  > a reader to do for five weeks.*
- Acoustic occurrences carry a **time range, not an instant** — new for our model, which is
  otherwise point-in-time. Segment/travel-chain heuristics and any DwC mapping must account for
  a bout's duration.
- Identity arrives as **candidate identifiers** (pod/ecotype/matriline), never validated
  `organismID` — consistent with the unvalidated-identifier rule (decision
  [004](004-rights-and-licensing.md), [docs/rights-policy.md](../rights-policy.md)).
- Volume is thin and currently declining; even a clean integration adds only a few occurrences
  per month until Orcasound's curation cadence recovers.

## Amendment (2026-08-14)

Three things this record got wrong, and one that changed underneath it. The core decision —
an acoustic occurrence is one curated biophony bout, identified by structured upstream tags
rather than by parsing `name` — is unchanged and now better supported.

### 1. The vocabulary already exists, and it isn't ours

The original proposed slugs (`ecotype:srkw`, `pod:j`, `matriline:t090`) for Orcasound to
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
moderator's uncertainty needs a column. The evidence is in Orcasound's own data: eleven bouts
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

> ~~Decision [008](008-source-schemas-are-upstream-mirrors.md) is unaffected — we still mirror
> verbatim, and the mirror is still the place upstream shape is allowed to leak. What shrinks is
> the amount of *interpretation* in the translation step, which is exactly the fragile part.~~
>
> *Superseded 2026-09-20: 008 does not govern orcasite at all.*
>
> ~~Where an `iri` is absent — free text remains legal upstream, deliberately, so vocabulary gaps
> stay visible — we fall back to matching the tag name against the register. **That match uses
> the register's published fold**
> ([ADR-0019](https://github.com/salish-sea/animals/blob/main/decisions/0019-names-are-compared-by-folding.md)):
> lowercase, delete apostrophes and hyphens, collapse whitespace, replace each run of digits with
> its decimal value, and never fold a trailing `s`. Under it, every animal-kind tag in the live
> corpus resolves except `fish` (outside the register's taxonomic bound) and `calf` (a life
> stage). Bare `T37` correctly yields **two** candidates — the matriline `T037s` and the
> individual `T037` — which is ambiguity the vocabulary genuinely has, to be surfaced rather than
> adjudicated by string manipulation.~~
>
> *Superseded 2026-09-20: a tag with no `iri` yields no identification. The gap is closed in
> orcasite, not matched around here — see the [Amendment](#amendment-2026-09-20).*

Consequence for our code: `normalize_designation()` and the fold disagree — ours pads where the
fold strips, and our trailing-`s` stripping is the matriline/matriarch merge the fold refuses
across 126 pairs. Reconciling them is `salish-8vr.18`. This supersedes finding F9 in
[occurrence-identification-findings.md](../design-notes/occurrence-identification-findings.md),
which proposed `searchable_name.tsv` as a lookup *table*; the register publishes a *rule*
instead, with executable cases in `dist/fold_test.tsv`.

*Resolved 2026-09-23 by [052](052-designations-compared-by-the-registers-fold.md): we now compare by the fold. The trailing-`s` concern above turned out not to apply: our matching used the `s` to choose between groups and animals, and never merged the two.*

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

## Amendment (2026-09-20)

The core decision is again unchanged: an acoustic occurrence is one curated biophony bout,
identified by structured upstream tags. What changes is how the bout gets here, and two things
about what it looks like when it arrives.

### 1. orcasite is read directly. Decision 008 does not govern it

This record planned an `orcasound` mirror schema and a translation step because it treated
orcasite the way [008](008-source-schemas-are-upstream-mirrors.md) treats Maplify and
iNaturalist: a foreign system whose shape we do not control and must not let leak. That premise
is wrong for orcasite. It is our project — we are among its maintainers, and when its shape is
wrong for a consumer the remedy is a pull request, not a layer. ([028](028-salishsea-io-speaks-to-orcasound.md)
and [035](035-catalogue-migrates-before-tagging.md) call Orcasound "genuinely external". That is
about who decides what Orcasound's moderators record, which is still not us alone; it is not a
reason to treat its code as foreign.) The first one is
[orcasite#1042](https://github.com/orcasound/orcasite/pull/1042), which gives each tag a `kind`
and an `iri` ([#1013](https://github.com/orcasound/orcasite/issues/1013)).

So, as [033](033-register-names-the-animals.md) already decided for the register: **no mirror
schema, no translation layer.** The ingest reads `/api/json/bouts` and writes a table in
`public` that is shaped as ours — the bout's id, its feed's location, its start and end, and the
register identifiers its tags cite. 008 stands unchanged for the sources it was written about.

An anti-corruption layer earns its keep by absorbing a shape we cannot change. Here it would
have absorbed a shape we can, and in doing so hidden the defect from the only people able to
fix it.

**The fold-matching fallback goes with it.** The 2026-08-14 amendment said a tag without an
`iri` would be matched against the register by name. It will not be: a tag with no `iri`
contributes no identification, and the fix is to classify the tag in orcasite
([#1016](https://github.com/orcasound/orcasite/issues/1016)), where every consumer benefits.
The cost of this is small and known. Measured against the live API on 2026-09-20 — 221 bouts,
155 of them biophony, 94 distinct tags — 15 tags name exactly one register entity (`KW`, `SRKW`,
`J`, `K`, `L`, `Bigg's`, `humpback`, `CA sea lion`, `T090s`, …, 220 applications between them),
one (`T37`) names two and needs a person to choose between the matriline and the whale, and
the other 78 name no animal at all: call types, vessels, recording-quality notes. 92 of the
155 biophony bouts carry at least one animal tag. Sixteen rows of classification upstream
replace a matching rule here.

This narrows `salish-8vr.18`: reconciling `normalize_designation()` with the register's fold
still matters for Maplify comments, and no longer for Orcasound.

### 2. An occurrence gains an end time

Every occurrence has been an instant, `observed_at`. A bout is not: the median runs 14 minutes
and the longest 2.9 hours, and collapsing that to its start misstates what was heard.
`public.occurrences` gains an end-time column, null for every existing source.

It is a property of occurrences, not an acoustic special case. HappyWhale's source rows already
carry a start and an end that the view discards, and the sighting report form may come to offer
one. The original Consequences section flagged the time range as something "segment/travel-chain
heuristics … must account for"; that still holds, and is now a concrete column to account for.

### 3. Bouts are withheld from the DarwinCore export, for now

[005](005-export-exclusion-src-01.md) decides what the archive contains. Bouts are closer to
first-party data than iNaturalist or HappyWhale records are, and may well belong in it. They
stay out until this integration has run end to end and we like what it produces — an archive is
the one place a half-right record is hard to take back. This is a deferral to revisit, not an
exclusion.

### What this amendment does not decide

Still `salish-8vr.4`, and still ours: whether a biophony bout with no animal tag — 63 of 155
today — lands as an occurrence with zero identifications, and how a moderator's `certainty`
([#1014](https://github.com/orcasound/orcasite/issues/1014)) relates to our
`identifications.status`.

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
Open on our side: `salish-8vr.4` (the confidence/verification split). `salish-8vr.18`
(reconciling `normalize_designation()` with the fold) was open here too, and closed on
2026-09-23 by [052](052-designations-compared-by-the-registers-fold.md).
