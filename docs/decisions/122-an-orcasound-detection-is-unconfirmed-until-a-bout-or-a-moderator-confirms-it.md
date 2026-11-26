# 122 — An Orcasound detection is unconfirmed until a bout, an OrcaHello moderator or a curator confirms it, and a rejected one is withheld

**Status:** accepted · **Decided:** 2026-11-25, by Peter · **Work:** bd `salish-fizm` · **Amends:** [013](013-orcasound-acoustic-occurrences.md) (Orcasound occurrences came from bouts alone) · **Builds on:** [080](080-a-sighting-is-unconfirmed-until-someone-else-agrees.md) (a sighting's `confirmation` is a verdict of ours), [054](054-certainty-is-the-asserters-status-is-ours.md) (claims and status), [120](120-curators-review-a-days-reports-from-every-source-and-facebook-points-wait-for-them.md) (curators review a day's reports from every source)

## Context

Decision 013 took Orcasound's bouts as occurrences: a span of time at a hydrophone that a moderator drew, with tags saying what was heard. Bouts are few (187 whale bouts since November 2025, when moderators began drawing them routinely) and they come late, after a moderator has listened. orcasite also publishes every detection, at `/api/json/detections` with no sign-in: the moment a listener pressed the button, or the moment OrcaHello's model heard a call. There are 21,139 so far in 2026, 17,463 of them OrcaHello's. OrcaHello's own API adds, for each of its detections, the model's confidence, a label for each 3-second window, and its moderators' verdict: yes, no or don't know.

A detection arrives in minutes, which is what a notice to ships needs (120). But most detections are wrong. Of OrcaHello's 13,110 that a moderator has answered yes or no, 22% were confirmed. Of the candidates since November 2025 that OrcaHello alone made (orcasite's groups of nearby detections at one hydrophone), 2 to 7% fall in a bout. A review of the data on 2026-11-24 and 25 is in bd `salish-fizm`.

## Decision

**A detection that a listener or OrcaHello marks as a whale becomes an occurrence of its own, beside the bouts.** Detections of a vessel or of something else don't.

**It arrives unconfirmed.** Its `confirmation` is `unconfirmed` (080) until one of three things confirms it, apart from the cases left open below:

- **It falls in a whale bout:** at the bout's hydrophone, within the bout's span, where the bout is itself a whale occurrence, a `biophony` bout whose tags reach a species (013, [053](053-a-bout-is-one-occurrence-per-species.md)). A bout of vessel noise confirms nothing. orcasite records no link between a detection and a bout, so the build infers one from the hydrophone and the time.
- **An OrcaHello moderator answered yes.** OrcaHello's moderators curate its detections as orcasite's moderators curate bouts. Only OrcaHello's own detections have such a verdict; a listener's have none.
- **A curator confirms it** in the review view of decision 120, once that is built.

**A detection that an OrcaHello moderator answered no, or that a curator rejects, is withheld**, unless the open case of a rejected detection inside a bout is settled otherwise. It is kept as data, since a verdict is a claim and claims are mirrored as stated (054), but it is not shown on the map or published. This departs from 080, under which an unconfirmed sighting is shown and never hidden. A rejection is not lack of agreement but someone saying the detection was wrong, and 78% of OrcaHello's verdicts are rejections: shown, they would flood the map. "Don't know" leaves a detection unconfirmed.

## Undecided

- **A detection in a bout whose species is only possible.** Such a bout is itself unconfirmed (080). Whether a detection inside it is confirmed by being there, or takes the bout's verdict, is open.
- **A detection that an OrcaHello moderator rejected but that falls in a bout.** Whether the bout outweighs the rejection is open.
- **How a detection is drawn beside its bout, and whether a low reliability score keeps one off the map** (bd `salish-fizm.4`, `salish-fizm.2`).
- **Whether detections go into the Darwin Core archive.** Bouts don't yet (013).

## Rejected

- **Take only bouts, as 013 did.** A bout comes after a moderator has listened, often hours later, and notices to ships can't wait for it.
- **Show a rejected detection, marked disputed.** `disputed` is for disagreement that hasn't been settled (080). A moderator's no settles it, and showing four rejected detections for every confirmed one would hide the real ones.
- **Treat an OrcaHello yes as one input among others, confirming only by bout or curator.** OrcaHello's moderators are the people best placed to judge its detections, and making their yes wait for a bout or a second review throws away a judgment that has already been made.

## Consequences

- The build needs OrcaHello's verdicts, not only orcasite's detections. orcasite keeps a machine detection's time and description, but not its confidence, its labels or the moderator's answer. OrcaHello's API must be read a month at a time (`Timeframe=range`), because `Timeframe=all` reads its whole database for every page (bd `salish-fizm.1`).
- Most detections on the map will be unconfirmed, since about half of OrcaHello's are never reviewed and a listener's are confirmed only by a bout or a curator. How they look matters (bd `salish-fizm.4`).
- The curator role of 014 and 120, not yet built, is one of the three routes to confirmation.
