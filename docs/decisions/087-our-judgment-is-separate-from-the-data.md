# 087 — Our judgment is kept apart from the claims it judges, and each use of it says which judgment it relies on

**Status:** proposed · **Raised:** 2026-10-22, by Peter, while building [080](080-a-sighting-is-unconfirmed-until-someone-else-agrees.md) (`salish-bwma`) · **Relates:** [054](054-certainty-is-the-asserters-status-is-ours.md) (certainty is the asserter's, status is ours), [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) (an observation is evidence and identifications), [080](080-a-sighting-is-unconfirmed-until-someone-else-agrees.md) (confirmed, unconfirmed, disputed), [086](086-what-we-know-now-is-a-file-to-poll.md) (the file of what we know now, which carries 080's verdict), [003](003-dwc-export-pipeline.md) (the Darwin Core archive)

This records an analysis Peter asked to keep. Nothing in it is decided yet. Peter is still working through it, and it bears on Orcasound's design as much as ours.

## Context

While 080 was being built, an iNaturalist observation that three people identified as a humpback and a fourth as the oceanic dolphins and porpoises came out "disputed", and so unconfirmed. Peter's view: it is certainly a humpback. The disagreement is real and worth keeping, but our judgment should be that it is a humpback, in exports as well as on the map. 080 was amended so that an outvoted disagreement no longer stops a confirmation.

The underlying failure is broader, and Peter named it: all of us — Peter, Scott Veirs, the Orcasound team, and the agents working on this code — have been failing to model the system's judgment separately from the data. A sighting's document now carries `confirmation`, a verdict, beside the claims it was drawn from, with nothing to say which rule produced it. And that judgment will get more sophisticated, and harder to explain, over time. Peter's cheeky name for it: "Salish Sea AI".

## The analysis

There are three layers, and today they are squashed together.

1. **Claims.** What a person or a source asserted: an observer's identification, another person's identification of the same observation, an Orcasound moderator's tag on a bout, Maplify's `trusted` flag, an OrcaHello detection. Each has an author and, where the source records one, a certainty (054). Claims are data. We mirror them and never rewrite them.
2. **Assessments.** A named rule applied to claims, giving a verdict: "080's rule, as of 2026-10-22, over these identifications, says humpback, confirmed, one person disagreeing." This is what "the system" is: not an entity with opinions, but a published rule that anyone can re-run over the same claims and get the same answer. "SalishSea.io thinks…" is fair shorthand only when the rule behind it can be named. The more sophisticated the rule becomes, the more this matters: a verdict nobody can explain can still be traced to its rule and its inputs.
3. **Uses.** A verdict acted on for a purpose, each with its own cost of being wrong.
   - The map asks how sure we are of what was seen.
   - The Darwin Core archive asks whether a record is fit for science. It already applies a stricter rule than the map: it takes only Maplify reports marked trusted.
   - A warning to ships asks whether there is plausibly an animal here now. A miss can kill a whale. But a false alarm is costly too: it spends credibility with the shipping industry, of which we don't have much to spend. So a vessel alert can't simply use a lower bar than the map. It needs a verdict calibrated for that use, and an explanation a ship's officer or a port can check.

So our uses already make different judgments. We just don't name them.

## What this would mean, if adopted

- A sighting's record carries the claims in summary (how many people agree and disagree, whether the source vouched for it, how old it is, how precise its position is) beside the verdicts. 080's `disagreements` count is already such a summary.
- Each verdict names the rule that gave it, and the rule's version, so a verdict that changes can be explained by a change of rule or of claims.
- Each use (the map, the archive, 086's file, a future vessel alert) says which verdict it relies on.
- Orcasound's moderators' tags and OrcaHello's detections are claims in the first layer, with their certainty, and a bout's verdict about what was heard is ours.

## Not decided

- Whether to adopt this at all, and what to call the assessor in what we publish ("SalishSea.io", a rule's name, or something else).
- The shape of a verdict in the day files and in 086's file. Until this is settled, 080's `confirmation` should not be promised to outside consumers as a stable field. It is recomputed on every build and stored nowhere, so renaming it later costs one build.
- How a vessel alert's verdict is calibrated, and who decides its threshold, given that both a miss and a false alarm are expensive.
