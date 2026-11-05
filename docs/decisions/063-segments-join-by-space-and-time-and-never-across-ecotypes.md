# 063 — A sighting joins the segment nearest in space and time, and never one of another ecotype

**Status:** accepted; built · **Decided:** 2026-10-04 · **Amends:** how [`segments.ts`](../../src/segments.ts) builds segments · **Relates:** [062](062-segment-edits-are-claims-about-sightings.md), [029](029-map-symbology.md) · **Context:** GitHub [#445](https://github.com/salish-sea/salishsea-io/issues/445), bd `salish-lvzr` (build), `salish-71m7` (named animals)

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

## Amendment, 2026-10-31 — reports at the same instant go in order of id

"In time order" left ties to whatever order the caller passed the reports in, and the map, the day's list, the encounter timeline and the subject timeline each get theirs from somewhere else. Order can matter: when a Bigg's report and a resident report arrive at the same moment beside a track that names no ecotype, whichever is offered first joins it, and the other has to start its own. On 65 of the 569 days since 2022 with two reports at the same instant, reversing the order changed the tracks. Reports at the same instant now go in order of their id, so every view draws the same tracks. The day files already list them that way, so the map's tracks don't change: none of the 1,738 days drew differently (`salish-gnk3`, found by the property tests of `salish-us33`).

Also asked by those tests, and left as decided: a report that names both ecotypes, joining a track, lets a later report of either ecotype join it too. That is the rule as written above ("a different one and none of its own"), and it accounts for the 2 mixed segments this record counts.

## Amendment, 2026-11-04 — the build decides, and the day file carries the answer

The join rule above is unchanged; where it runs changed. [111](111-the-build-decides-a-days-travel-segments-and-the-day-file-carries-them.md): the build joins each day's reports and writes each report's segment into the day file, so the browser groups published reports by that field and applies this rule only to a signed-in tab's own sightings the file does not have yet. That lets the distance in the rule be measured by sea (`salish-20u7`) in the build alone.

## Amendment, 2026-11-05 — the distance is measured by sea

The rule above is unchanged except for how far apart two reports are. The build now measures that by sea (`salish-20u7.3`, [`seaDistanceFor`](../../src/sea-distance.ts)), on the basemap's water mask (basemap decision 028; [CONTEXT.md](../../CONTEXT.md)), and the limits, the speed check and the score are as they were: 12 hours, 20 km, the 3 km allowance, three times the species' speed, distance in kilometres plus the species' speed times the hours since.

**What "by sea" means here.** When the straight line between two reports stays in water, that is the distance, as before. Otherwise it is the shortest route through the water cells, as a swimmer would take it. A report on shore is first moved to the nearest water within 2 km. When no route is within 20 km, the leg cannot join. A report outside the mask's box, or on land with no water within 2 km, has no sea to measure in, so it is measured in a straight line and can still join. The search stops at 22 km rather than 20, because a route counted along grid cells runs up to about 8% longer than the same route once straightened, and the 20 km limit is held to the straightened length (without this, 38 more days changed, nearly all of them routes of 19 to 20 km refused for the grid's bend).

**Where it applies.** In the build, which writes each report's segment into the day file ([111](111-the-build-decides-a-days-travel-segments-and-the-day-file-carries-them.md)) and joins the same days again for the subjects' encounters. Both read the same mask. The browser keeps the straight line for a signed-in tab's own sightings that the file does not have yet; it has no mask, and the next build replaces its guess.

**Effect, measured over the 1,742 days since 2022 with sightings of tracked species** (`WATER_MASK=… pnpm exec tsx scripts/segments/compare.ts --rules current,seaDistance --changed`):

| | stranded | mixed | links over 6 h | links over 10 km | tracks | alone | held-out disagree |
|---|---|---|---|---|---|---|---|
| straight line | 24 | 5 | 417 | 2,076 | 5,162 | 6,041 | 59 |
| by sea | 28 | 4 | 394 | 1,854 | 5,138 | 6,267 | 53 |

237 of the 1,742 days draw different tracks (14%). Most of the change is a join refused: 216 legs have no water route within 20 km and 23 are too fast by sea, against 133 reports that join another track. Segments rise by about one a day on the days that change. "Stranded" rises by 4; those four have not been read.

**Worked example, 14 Jul 2025 (Saltspring).** A Whale Alert report in Trincomali Channel at 12:09 Pacific and the T69s at Maple Bay at 13:32 are 17 km apart in a straight line, from the reports' own positions, and joined, and the map drew the track through the middle of the island. By sea it is 33 km, so no join. (The test of this pair in `src/segments.test.ts` uses two points read off the map nearby, 14 km apart in a straight line and 29 km by sea.) The T69s start their own segment. The same day two reports an hour apart, 17 km apart in a straight line and 19 km by sea, are refused by the speed check ([map](https://salishsea.io/?d=2025-07-14&o=inaturalist%3A327034040)).

**Still open.**
- **The 20 km limit is a limit on the sea route, however long the gap.** Of the 216 refusals, 36 were more than six hours after the track's last point, where the animals could easily have swum 25 km. Whether the limit should grow with the time since, or only the speed check decide, is not settled; it was designed for straight lines.
- **Reports on the wrong side of a narrow island.** Two reports an hour and a quarter apart and 7 km apart in a straight line (at 122.76 and 122.69 degrees west, near 48.25 north, on 14 Mar 2025) are 52 km apart by water, because the mask puts them on opposite sides of Whidbey Island. Either the animals were on the far side or a report is a few kilometres out, and the rule cannot tell.
- **Scott's annotated days** (`salish-71m7`) should be judged on these same days, together with preferring a segment that names the same animals.
- **The half-hour ring clipped to water** (`salish-2adm`), **and legs that cross land drawn along the water** (`salish-20u7.4`), which use the same module but do not change which reports join.
