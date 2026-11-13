# Hand-labelled days for the join rule

Each file here is one Pacific day's whale reports, each labelled with the travelling party it is about (bd `salish-2rki.1`). It is the measure for any change to the rule that joins a day's reports into travel segments (`joinScore` in [`src/segments.ts`](../../../../src/segments.ts), decision [063](../../../../docs/decisions/063-segments-join-by-space-and-time-and-never-across-ecotypes.md)), as the [gold set](../gold/README.md) is for reading sighting text. [`src/track-labels.test.ts`](../../../../src/track-labels.test.ts) runs the rule over every day, measuring by sea as the build does, and records what it gets wrong today.

The labels are the truth here, not the rule's output. A label changes only when someone rereads the day and disagrees. The list in the test changes whenever the rule does, as a reviewed edit.

**The labels are a draft.** Claude read the 334 reports on 2026-11-12 and wrote every label and note. Peter has not yet reviewed them. Until he has, a disagreement between the rule and a label is a question about both.

## An example

On 2026-11-10 J and K pods went north through Admiralty Inlet, widely spread. Three reports, nine and seven minutes apart:

| Pacific time | where | the report says | label |
|---|---|---|---|
| 13:30 | Bush Point | J and K pod trailers passing Bush Point NB | `JK` |
| 13:39 | 8 km north | J and K pods NB, widely spread, leaders here | `JK` |
| 13:46 | 2 km north of Bush Point | J and K pods NB just E of mid, trailers including adult male here | `JK` |

All three are one party, so all three carry one label. The rule puts the leaders' report on a different segment from the two trailers' reports, because no animal swims 8 km in nine minutes. The test records that as `JK` split across three segments that day.

## How the days were chosen

Eleven days, 334 reports of the species that get segments (killer, humpback, gray and minke whales; `travelSpeedKmH` in `src/constants.ts`), read from the production day files on 2026-11-12.

| days | chosen because |
|---|---|
| 2023-09-11, 2026-01-23, 2026-03-29, 2026-09-03, 2026-09-19 | the days that decided decision 063, from [GitHub #445](https://github.com/salish-sea/salishsea-io/issues/445) |
| 2025-07-14 | the track drawn across Saltspring Island that began the distance-by-sea work (bd `salish-20u7`) |
| 2026-11-10 | J and K pods drawn as two interleaved tracks in Admiralty Inlet (bd `salish-2rki`) |
| 2025-12-11, 2026-01-02, 2026-07-01, 2026-07-05 | drawn at random: the days from 2025-11-10 to 2026-11-09 that have a day file, shuffled with seed 20261112, taking the first five with 12 to 45 such reports. The fifth was 2026-03-29, already here |

The first seven days were chosen because the rule went wrong on them, so they say how a rule does on known hard cases, not how often it is wrong. Only the four random days estimate that, and four days is a small sample.

## The columns

Each row is one report, with the fields of the day file that the rule or a reader uses: `id`, `observed_at`, `observed_until`, `location`, `accuracy`, `taxon`, `count`, `direction`, `identifiers`, `pods`, `absent`, `vitality`, `provider_slug`, `place` and `body`. Every `body` is public, as the site shows it, reporter names included.

- `track`: the label. Reports with the same label are about the same animals travelling as one party that day, and belong on one segment. The name is only a name: `J`, `T18s`, `humpback-east-passage`.
- A label with a slash, `JK/possession-sound`, names a part of a party at a time when the party was in parts, or may have been. Reports of the same part belong together. Reports of different parts of one party, or of a part and the whole, are not scored against each other, because whether a rule should draw one line or two there is a judgement this set doesn't make.
- `track` is null where the reader could not say which party a report is about: most often a report with no text and no named animal that is not right beside a labelled one. A null row is in the file so the rule sees the whole day, and is not scored. Its `note` says why.
- `note`: why a label is what it is, where the text alone doesn't say.

## How the labels were decided

From what each report says first: a pod, a matriline or an animal it names, and what the reporter says the animals were doing. Then from position and time, but only where they leave no real doubt: a report with no text is given a party's label when it lies within a few kilometres and a few minutes of that party's reports, and the note says so. A report that could belong to either of two nearby parties is left null.

Where reports name different animals, they are different parties, even when the rule could join them: the gray whales CRC53 and CRC531 feeding 5 km apart on 2026-01-02 are two labels. Where the same named animals are reported again hours later and far away, they are one party, even where the rule's limits forbid the join: the T69s on 2025-07-14.

A label says who the animals were, not where the reporter placed them. On 2026-11-10 one report was filed twice, a minute apart, at two places 13 km apart; both copies carry the label of the party the words describe, and the note names the misplaced one.

## How a grouping is scored

[`scripts/gold/tracks.ts`](../../../gold/tracks.ts) takes a day's rows and the segment a grouping gave each, and answers two lists. `split`: each label whose reports are on more than one segment, with how many. `mixed`: for each segment that holds reports of more than one party, those parties. A perfect grouping has both empty. Splitting is the milder fault, since a party seen in the morning and again at dusk may fairly be two lines on a map; mixing asserts that two parties are one.
