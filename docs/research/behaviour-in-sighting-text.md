# Behaviour in sighting text

*Measured 2026-11-10 for bd `salish-2ua9`, behaviour tags extracted from a sighting's text. The question that matters most is which behaviours change where the animals are likely to be next ([decision 103](../decisions/103-what-a-port-needs-is-where-whales-may-be-next.md)).*

## What we found

**A fifth of the reports with text say something about how the animals are moving, and a short list of phrases catches nearly all of it.** Over a year of published reports, 1,371 of 5,739 reports with text carry at least one phrase that bears on movement: milling, foraging, a speed, a change of heading, or how spread out the group is. The share is highest for Southern Residents (41%) and gray whales (40%), and lowest for Bigg's (21%). The phrases are formulaic, because most reports are Orca Network's relays written in a house style, so a fixed list of phrases reads them with few mistakes. On the gold set ([decision 102](../decisions/102-reading-sighting-text-is-measured-against-a-gold-set.md)) the draft vocabulary agrees with the hand-read behaviour of 198 of 202 reports.

A worked example, from a row of the gold set:

> J pod leaders steadily southbound, trailers back near Kayu Kayu, wide north-south spread

The reader answers *travelling* (steadily) and *spread out* (wide north-south spread). For a forecast of where J pod will be, that says the group keeps its heading, and that it covers miles of water, so the reported position is only its front.

**Whether a behaviour is still going on matters, and the words say so.** About twenty reports put a behaviour in the past: *Biggs, southbound after feeding*; *T36, T36Bs and T137A … now committed to northbound travels after feeding*. Those animals have stopped foraging and are travelling, which is the opposite of what the bare word says. The reader skips a phrase that follows *after*, *finished*, *no*, *not* or *without*. A few reports deny a behaviour outright (*no surface activity*), and the same rule handles them.

## The draft vocabulary

The tags and their phrases are in [`scripts/gold/behaviour.ts`](../../scripts/gold/behaviour.ts). The table counts the reports each tag was read from, between 2025-11-10 and 2026-11-09. An orca's ecotype comes from the taxon, or else from the codes or pods the report names (T codes are Bigg's; J, K and L are Southern Residents).

| tag | bearing on movement | Southern Resident (847) | Bigg's (1,641) | orca, ecotype not said (1,109) | humpback (758) | gray whale (682) | pinniped (443) | other (259) | phrases, with the reports each caught |
|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| milling | staying in one area | 56 | 120 | 67 | 66 | 63 | 7 | 5 | milling 342, stalled 20, hanging around 12, circling 9 |
| foraging | staying in one area | 34 | 59 | 46 | 21 | 180 | 17 | 22 | feeding 221, hunting 85, foraging 44, eating 12, chasing 7, a kill 6, attacking 4 |
| resting | staying in one area, slowly | 1 | 5 | 1 | 3 | 3 | 13 | 0 | resting 15, logging 9, sleeping 2 |
| slow | covering little ground | 26 | 51 | 38 | 11 | 25 | 1 | 0 | slowly 149, meandering 2 |
| fast | covering ground quickly | 25 | 41 | 22 | 6 | 3 | 2 | 1 | quickly 70, fast 21, porpoising 8 |
| travelling | keeping a heading | 5 | 4 | 4 | 1 | 0 | 1 | 0 | steady 15 |
| directional changes | the heading is unreliable | 34 | 23 | 10 | 2 | 6 | 1 | 3 | directional changes 49, flipped 17, back and forth 6, turned around 5 |
| spread out | the group covers a wide area | 234 | 52 | 23 | 0 | 1 | 2 | 0 | spread 294, several groups 17 |
| grouped up | the group covers a small area | 17 | 14 | 14 | 2 | 2 | 2 | 1 | grouped 38, together 9, tight group 3 |
| long dives | lost from view for minutes | 7 | 14 | 8 | 25 | 4 | 0 | 1 | long down times 34, fluked 19, long dives 5 |
| surface active | none | 104 | 53 | 37 | 29 | 5 | 5 | 5 | surface active 158, breaching 55, playing 11, tail slapping 8 |
| hauled out | ashore | 0 | 0 | 0 | 0 | 0 | 16 | 0 | hauled out 16 |

What the counts say for a forecast:

- **Spread is the Southern Residents' word.** 234 of their 847 reports say the group is spread out, often "spread north to south" or "spread from shore to mid channel". A spread group's reported position is one point in miles of whales, often the leaders' (*leaders here, trailers spread to the S*).
- **Speed is said in words more often than it could be measured.** *Slowly* (149) and *quickly* (70) are direct evidence for the speeds bd `salish-xz0i` needs.
- ***Flipped* means the group reversed its heading.** Seventeen reports say it, usually hedged (*possibly flipped southbound*). Like *directional changes*, it says that the last heading is a poor guide.
- **Gray whales are reported feeding.** 180 of their 682 reports say so, more than any other kind, and a feeding whale is one a forecast should expect to stay in the area.
- **Long down times say when a group will be hard to find,** not where it will go: it can surface far from where it was last seen.

## How it was checked

- **Precision:** twelve random matches per tag were read by hand. Four rules were wrong and are fixed. *Travelling* nearly always accompanies a heading the direction already carries (*traveling SB*), and sometimes means company (*traveling with T124A2*), so only *steady* counts. *Dove* and *diving* catch ordinary dives, so only long ones count. *Loosely grouped* had counted as both spread out and grouped up, and now counts as neither. *Fishing* is as often the observer (*fishing for salmon from my kayak*) as the animal.
- **Names:** *Zig Zag* is a humpback (BCX1193), so *zigzag* matches only in lower case. Humpback nicknames are the main hazard for a list of phrases, and any new phrase should be checked against them.
- **The gold set:** each report's hand-read behaviour phrases were put through the same vocabulary and compared with what the reader finds in the full text. Of the four disagreements, three are the reader being right where the label is literal (*after feeding*; *changed direction* and *steadily*, which the labeller didn't record), and one is a miss (*two traveling north together*).
- **What no tag takes:** field marks (*blows visible*, *white lower jaw visible*), headings the direction already reads (*trending north*), positions (*hugging the shore*), and the order of a group (*leaders here*, *lead group*, *moved on one by one*).

## Open questions

These are curation choices, not measurements, and none is settled:

1. **Leaders and trailers.** 87 reports mention a group's leaders, trailers or lead group, and many say which part of the group the position is (*leaders here*). That bears directly on a forecast, since the group extends behind the point. Is it a tag, or a property of the position?
2. **Travelling.** With only *steady* left, the tag catches fifteen reports. Keep it, or let a direction with no milling or foraging stand for travelling?
3. **Resting and hauled out.** Both mean staying put. Are they tags of their own, or forms of milling?
4. **Wording per kind.** One *foraging* tag, shown as *hunting* for Bigg's and *feeding* for baleen whales, or the words as each community uses them?

Reproduce with `node scripts/gold/behaviour.ts <dir of day files>`, `--examples <tag>` and `--gold`. The day files are the site's own, `https://salishsea.io/read-path/days/<date>.json`.
