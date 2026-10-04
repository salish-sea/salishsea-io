# 063 — A sighting joins the segment nearest in space and time, and never one of another ecotype

**Status:** accepted · **Decided:** 2026-10-04 · **Amends:** how [`segments.ts`](../../src/segments.ts) builds segments · **Relates:** [062](062-segment-edits-are-claims-about-sightings.md), [029](029-map-symbology.md) · **Context:** GitHub [#445](https://github.com/salish-sea/salishsea-io/issues/445), bd `salish-lvzr` (build), `salish-71m7` (named animals)

## Context

The map's rule builds one segment at a time, oldest sighting first. Each segment takes every later sighting of the same species that is within reach of its latest point (12 hours, 20 km, three times the species' travel speed after a 3 km allowance) before the next segment is started. A sighting that one segment passed over can never join another.

On 3 September 2026, Scott Veirs's first T49As sighting west of San Juan Island was drawn alone. A segment of two morning reports had been waiting six hours, and his first point fell 20.4 km from it, against a 20 km limit. His second point, 19.8 km away, was taken, along with the rest of his encounter. Over every whale sighting since January 2022, the rule leaves 123 sightings alone right beside a segment (within 3 km and an hour), and draws 54 segments that mix Southern Resident and Bigg's reports.

The candidates were measured with [`scripts/segments/compare.ts`](../../scripts/segments/compare.ts) over 34,352 sightings on 1,710 days, and read sighting by sighting on six example cases over five days. Scott chose among them on #445 ([his reply](https://github.com/salish-sea/salishsea-io/issues/445#issuecomment-5983209356)), and [our answer](https://github.com/salish-sea/salishsea-io/issues/445#issuecomment-5983814283) gives the figures below.

## Decision

Every segment stays open at once. Each sighting, in time order, is offered to every segment that admits it under the existing test, and goes to the one with the lowest score:

- **Score:** the distance from the segment's latest point, plus the distance the species usually travels in the time since then (6.8 km per hour for orcas, [`constants.ts`](../../src/constants.ts)). A segment seen recently beats a slightly nearer one seen hours ago.
- **Ecotype:** a report that names an ecotype (by taxon, or by a J, K, L or T designation) may not join a segment that names a different one and none of its own. A report that names no ecotype may join any segment.

If no segment admits the sighting, it starts a new one.

| | Current | Nearest point | Space and time | **Space and time, ecotype** |
|---|---|---|---|---|
| Sightings drawn alone right beside a segment | 123 | 15 | 22 | **22** |
| Segments mixing Southern Resident and Bigg's reports | 54 | 43 | 41 | **2** |

The rule is `spaceTimeEcotype` in [`scripts/segments/rules.ts`](../../scripts/segments/rules.ts). It gets all six example cases right, where the current rule gets all six wrong. They are 3 Sep 2026 (two cases: Scott's sighting, and K pod beside the T123s/T100s/T46Bs in Admiralty Inlet), 19 Sep 2026 (T137A east of Whidbey and the T36s/T49A1/T65Bs west of it), 11 Sep 2023 (the T18s near Victoria while J pod passed), 29 Mar 2026 (the T99s) and 23 Jan 2026 (a Bigg's report a minute after J pod's). The 2 mixed segments that remain each contain a report recorded as Southern Resident that names Bigg's groups. That is an error in the report, which the rule takes at its word.

## Rejected

- **Nearest point**, the same rule scored by distance alone. With the ecotype ban both choices draw the six example cases alike. They still disagree on 170 days. Of twelve disputed sightings read one by one, space and time was better on six, nearest point on three, and three could not be told. Nearest point's failure is attaching a sighting to a segment that went quiet hours earlier, often a single report. On 4 Apr 2026 a 12:18 sighting off Seattle joined a lone report from 01:19 instead of the northbound T137s. Its wins came where a group stayed put (Elliott Bay, 14 Jul 2024) and where the sighting named the same animals as the nearer segment (the T65As on 27 Jun 2022, the T36/T137s on 22 Feb 2024). Scott voted for space and time, reasoning that groups passing each other is more common than a group staying put.
- **Keeping the current rule and widening its limits.** The failure is in the order in which decisions are made, not in the thresholds: a longer reach lets the first segment claim more.
- **Letting named animals forbid a join.** Groups join and split, and observers name different members of the same group, so two reports naming different animals can be the same group. Ecotypes do not mix in the wild, so only a conflict between ecotypes forbids a join.

## Consequences

- The rule can now take 062's cannot-link claims directly, as one more reason a segment may not take a sighting.
- The rule reads what observers said, so a wrong ecotype in a report now changes the map. That is a reason to make identifications correctable, which 014 and 054 already provide for.
- Changing which sighting joins which segment changes the labels on segment heads (029) on about 500 days since 2022.

## Open

- **Preferring a segment that names the same animals.** It fixes both disputed sightings where space and time lost on names. It changes segments on 50 days relative to this rule, and those days have not been read. This is `salish-71m7`'s work.
- **Routing around land and shallows.** Scott expects a distance measured by sea to favour the nearer segment more often. This decision is worth revisiting once that measure exists.
- **Explaining a segment on a sighting's card, and editing segments by hand.** Scott (2026-10-04) sees neither as worth building yet, and expects most corrections to come from identifications added to sightings after the fact. 062 records how an edit would be stored, not when it is built.
