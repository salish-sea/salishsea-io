# 013 — OrcaSound acoustic occurrences come from curated biophony bouts, identified by upstream tags

**Status:** accepted (our side) · **pending upstream adoption** · **Decided:** 2026-07-06

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
parsed from the free-text `name`. We asked OrcaSound (orcasound/orcasite#1001) to apply a
controlled tag vocabulary to bouts (`ecotype:srkw`, `pod:j`, `matriline:t090`,
`species:humpback`, `unconfirmed`/`false-positive`, …). Bouts already expose a `tags`
relationship on the JSON:API (`Bout` `includes [:feed, :tags]`), so consuming it needs no
upstream schema change — only slug conventions and moderator habit.

Ingest follows the established pattern: mirror bouts + their tags **verbatim** into an
`orcasound` upstream-mirror schema, then **translate** tag slugs into our taxon + candidate
identifiers at the boundary (decision [008](008-source-schemas-are-upstream-mirrors.md)),
within the imperative-shell ingest architecture (decision
[011](011-ingest-imperative-shell.md)). OrcaSound is already modeled as a **Collection** with
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

- **Blocked on upstream.** The integration's value depends on OrcaSound adopting the tag
  vocabulary (orcasound/orcasite#1001). #178 is parked at `needs-info` pending that response,
  which may not come. This ADR records *our* side of the decision; the upstream contract is not
  yet ratified.
- Acoustic occurrences carry a **time range, not an instant** — new for our model, which is
  otherwise point-in-time. Segment/travel-chain heuristics and any DwC mapping must account for
  a bout's duration.
- Identity arrives as **candidate identifiers** (pod/ecotype/matriline), never validated
  `organismID` — consistent with the unvalidated-identifier rule (decision
  [004](004-rights-and-licensing.md), [docs/rights-policy.md](../rights-policy.md)).
- Volume is thin and currently declining; even a clean integration adds only a few occurrences
  per month until OrcaSound's curation cadence recovers.

## Reference

Tracking issue: [#178](https://github.com/salish-sea/salishsea-io/issues/178). Upstream
proposal: [orcasound/orcasite#1001](https://github.com/orcasound/orcasite/issues/1001).
Provenance model: [006](006-provenance-graph.md). Anti-corruption layer:
[008](008-source-schemas-are-upstream-mirrors.md). Ingest architecture:
[011](011-ingest-imperative-shell.md).
