# 118 — The rule that joins reports into segments is measured against hand-labelled days

**Status:** accepted; the labels are a draft awaiting Peter's review · **Decided:** 2026-11-10, by Peter · **Work:** bd `salish-2rki.1` (epic `salish-2rki`, a report is a region in space and time) · **Builds on:** [063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md) (the rule), [111](111-the-build-decides-a-days-travel-segments-and-the-day-file-carries-them.md) (the build runs it) · **Follows the pattern of:** [102](102-reading-sighting-text-is-measured-against-a-gold-set.md)

## Context

The rule that joins a day's reports into travel segments has been changed by looking at days where it went wrong: the five days that decided [063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md), the track across Saltspring Island that led to measuring by sea. Each change was checked on the days that prompted it, with assertions about single reports ("the 14:56 sighting starts a track"). Nothing said how a change did on a whole day, or on a day nobody had looked at.

On 2026-11-10 J and K pods, widely spread and going north through Admiralty Inlet, were drawn as two interleaved segments. Reports of the leaders and of the trailers were 6 to 8 km and a few minutes apart, and a hydrophone bout was placed at its hydrophone, 11 km from the report before it. The fixes discussed (each report's own uncertainty in place of one 3 km allowance, a bout's whole time span, deciding a day at once with min-cost flow) are large enough to make other days worse without anyone seeing it.

## Decision

**A change to the join rule is scored against days whose reports a person has labelled.** Each report of a species that gets segments carries the travelling party it is about. The fixture is [`scripts/read-path/fixtures/tracks/`](../../scripts/read-path/fixtures/tracks/README.md), one file a day; its README says how the days were chosen and how each label was decided.

**The labels are the truth, and the test records the rule's faults.** [`src/track-labels.test.ts`](../../src/track-labels.test.ts) runs the rule on each day, by sea, as the build does, and lists per day the parties it splits across segments and the segments on which it mixes parties. A change to the rule changes that list in the pull request, where it is reviewed. A label changes only when someone rereads the day.

**A label names a party, and optionally a part of it.** Reports with one label belong on one segment; reports of different parties must not share one. Where a party was in parts for a while, or may have been (J pod in Possession Sound while the rest were off Edmonds), the label names the part after a slash, and reports of different parts are not scored against each other: whether the map should draw one line or two there is not something this set decides. A report nobody could assign is left unlabelled and unscored, but stays in the file, since the rule has to cope with it.

**Seven of the eleven days were chosen because the rule failed on them; four were drawn at random.** The first seven say how a rule does on known hard cases. Only the random days estimate how often it is wrong, and they are few; more are drawn and labelled as the work goes on.

**The first labels were drafted by Claude and are not yet reviewed.** They were read from each report's text, position and time on 2026-11-12. The set is the measure once Peter has reviewed it.

## Rejected

- **Extending the single-report assertions in `src/segments.test.ts`.** They say what one report should follow and stay as they are. They can't count how many of a day's reports a rule gets right, and they assert the present rule's answer more often than the truth.
- **Scoring by pairs of reports** (of every two reports that belong together, how many the rule joins). A party with forty reports is 780 pairs and one with three is three, so the score is mostly about the biggest pod of the day. Listing split and mixed parties by name is cruder but can be read.
- **A label for every report.** Of the 243 Maplify reports in the set, 38 have no text at all, and many more name no animal. Guessing their party to fill the column would put the labeller's own join rule into the truth.

## Consequences

- `salish-2rki.2` (each report's region and time span, then min-cost flow) is measured here before it ships.
- The set says nothing yet about a party that splits or merges during the day beyond not scoring across its parts. If the rule comes to draw those, the labels need a way to say when the parts met.
- The fixture holds 334 public reports, reporter names included, as the twin and gold fixtures do.
