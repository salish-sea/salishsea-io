# 116 — A sighting's text gives its behaviour in the reporters' own words, and which part of a spread group its position is

**Status:** accepted · **Decided:** 2026-11-12, by Peter · **Work:** bd `salish-2ua9` · **Evidence:** [research note](../research/behaviour-in-sighting-text.md), measured with [`scripts/gold/behaviour.ts`](../../scripts/gold/behaviour.ts) · **Builds on:** [105](105-the-build-and-the-browser-read-sighting-text-with-one-reader.md) (one reader), [102](102-reading-sighting-text-is-measured-against-a-gold-set.md) (the gold set), [103](103-what-a-port-needs-is-where-whales-may-be-next.md) (what a port needs), [097](097-a-travel-segment-is-one-card-in-the-days-list.md) (the segment card)

## Context

Reports say how the animals are behaving, and some of it changes where they are likely to be next: a group that is milling or foraging stays put, one that has *flipped* has reversed its heading, one that is *spread N to S* covers miles of water. Decision 103 wants that in the half-hour ring; decision 097 left a place for it on a segment's card. Until now the build read none of it, and the reader answered *milling* only as the absence of a direction.

The measurement, over the 5,739 published reports with text from 2025-11-10 to 2026-11-09: a quarter of them (1,371) carry a phrase that bears on movement, 41% of Southern Resident reports and 21% of Bigg's. The phrases are formulaic, mostly Orca Network's house style, so a list of phrases reads them well: on the gold set it agrees with the hand-read behaviour of 198 of 202 reports.

The same reports showed a second thing. A spread group is reported from whichever part of it each spotter can see, and about fifty reports say which: *J and K pod leaders here, trailers passing Possession Beach*. On 2026-11-09, J and K pods' track swings 3 to 6 km east and west within half an hour and steps 3.5 km forward, 1.5 km back and 5 km forward again within another, because successive points are different parts of the group, not the group moving. Measured from leaders to leaders, the same stretch is a steady 6 km/h.

## Decision

**The reader, [`src/sighting-text.ts`](../../src/sighting-text.ts), reads a report's behaviour as tags, from a checked-in list of phrases, and the build writes them into each report in the day file.** The build and the browser read them alike, as they read codes and directions (105). A change to the list is reviewed by pull request and measured against the gold set, whose `behaviour` labels already record the phrases each report uses.

**A tag is the reporters' own word, normalised only for form.** *Milled* and *milling* are one tag; *feeding*, *foraging* and *hunting* are three, because they are the words different communities of observers use (Bigg's are reported *hunting*, gray whales *feeding*). Abstracting over them, to one tag for staying in an area to eat, can come later if a use needs it. The list records which kinds of animal each tag is used for, from the counts.

**Resting and hauled out are tags of their own,** not forms of milling, until the reports show they mean the same.

**There is no travelling tag.** A report with a heading, and no tag that says the animals are staying in one area (milling, resting, hauled out, or one of the words for eating), counts as travelling wherever a judgement needs it, such as the ring. The heading on the card already says it.

**A behaviour the text puts in the past or denies is not read.** *Southbound after feeding* says the animals have stopped feeding and are travelling; *no surface activity* says there was none. A phrase that follows *after*, *finished*, *no*, *not* or *without* in the same clause is skipped.

**When the text says which part of a spread group the reported position is, the reader answers it, and the build writes it into the report: the leaders, the trailers, or not said.** It is a property of the position, not a behaviour. It counts only when the text puts that part *here*: *leaders here*, *trailing group here*, *trailing male milling/foraging here*. The card says it with the position. A forecast grows from the latest leaders' report rather than the latest report of any kind, and a speed or heading is measured between reports of the same part.

## Not decided

- **Whether *K pod leaders northbound*, without *here*, means the position is the leaders'.** It may be Orca Network's shorthand for it; only their staff can say. Until then it reads as not said, because a wrong *leaders* would mislead a forecast, while *not said* only loses information.
- **The other end's position, when the text gives it in words** (*trailers passing Possession Beach*, *trailers 1/2 mile S*). That would give a group's extent, and needs place names matched to positions ([100](100-a-sightings-landmark-is-a-name-reporters-use.md)). Not now.
- **How a tag looks on a card, and how a segment's card pools them.** To be designed by mockup from real days.

## Rejected

- **One tag set abstracted across kinds** (one *foraging*, worded *hunting* for Bigg's). It loses the observers' own words before any use needs the abstraction.
- **A travelling tag from a list of phrases.** *Travelling* nearly always comes with a heading (*traveling SB*) and sometimes means company (*traveling with T124A2*); the heading says it better.
- **Leaders and trailers as a tag on the card.** A person reading the card would see it, and nothing that measures the track could use it.
- **A model as the reader** (bd `salish-26fp`). Decision 102 stands: a model's reading is an optional cached input beside the deterministic one, not what the build depends on.

## Consequences

- The day file gains two keys on each report, the tags and the part of the group, named when built. The Darwin Core archive is unchanged until a decision says what it carries.
- The half-hour ring (bd `salish-2adm`) and per-kind speeds (bd `salish-xz0i`) can use both.
- A humpback's nickname can look like a phrase (*Zig Zag*, BCX1193), so a new phrase is checked against the catalogue's nicknames.
