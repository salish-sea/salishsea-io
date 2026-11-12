# Behaviour in sighting text

*Measured 2026-11-10 to 2026-11-12 for bd `salish-2ua9`. The question that matters most is which behaviours change where the animals are likely to be next ([decision 103](../decisions/103-what-a-port-needs-is-where-whales-may-be-next.md)). What was decided from it is [decision 116](../decisions/116-a-sightings-text-gives-its-behaviour-in-the-reporters-words-and-which-part-of-the-group-it-saw.md).*

## What we found

**A quarter of the reports with text say something about how the animals are moving, and a list of phrases catches nearly all of it.** Over a year of published reports, 1,357 of 5,739 reports with text carry at least one phrase that bears on movement: milling, feeding or hunting, a speed, a change of heading, or how spread out the group is. The share is highest for Southern Residents and gray whales (40% each) and lowest for Bigg's (20%). The phrases are formulaic, because most reports are Orca Network's relays written in a house style, so a fixed list reads them with few mistakes. On the gold set ([decision 102](../decisions/102-reading-sighting-text-is-measured-against-a-gold-set.md)) the list agrees with the hand-read behaviour of 199 of 202 reports.

A worked example, from a row of the gold set:

> J pod leaders steadily southbound, trailers back near Kayu Kayu, wide north-south spread

The reader answers *spread out*, and a heading of south. For a forecast of where J pod will be, that says the group keeps its heading and covers miles of water, so the reported position is only a part of it.

**Each community of observers has its own words.** Southern Residents are reported *foraging* (33 reports) and never *hunting*; Bigg's are reported *hunting* (43) and never *foraging*; gray whales and humpbacks are reported *feeding* (179 and 18). That is why a tag keeps the reporters' word.

**Whether a behaviour is still going on matters, and the words say so.** About twenty reports put a behaviour in the past: *Biggs, southbound after feeding*; *T36, T36Bs and T137A … now committed to northbound travels after feeding*. Those animals have stopped feeding and are travelling, which is the opposite of what the bare word says. The reader skips a phrase that follows *after*, *finished*, *no*, *not* or *without* in the same clause. A few reports deny a behaviour outright (*no surface activity*), and the same rule handles them.

**A spread group is reported from whichever part of it a spotter can see.** On 2026-11-09, J and K pods' track swings 3 to 6 km east and west within half an hour, and steps 3.5 km forward, 1.5 km back and 5 km forward again within another, because successive points are different parts of the group. 87 reports mention a group's leaders or trailers, and 31 put one of them *here*, at the reported position. Measured from *leaders here* to *leaders here*, the same stretch is a steady 6 km/h.

## The tags

The phrases are in [`src/behaviour.ts`](../../src/behaviour.ts). The table counts the reports each tag was read from, between 2025-11-10 and 2026-11-09. An orca's ecotype comes from the taxon, or else from the codes or pods the report names (T codes are Bigg's; J, K and L are Southern Residents).

| tag | Southern Resident (847) | Bigg's (1,641) | orca, ecotype not said (1,109) | humpback (758) | gray whale (682) | pinniped (443) | other (259) | all |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| milling | 47 | 110 | 65 | 61 | 57 |  | 2 | 342 |
| stalled | 10 | 8 | 3 |  | 1 |  |  | 22 |
| hanging around |  |  |  |  | 2 | 7 | 3 | 12 |
| circling |  | 2 |  | 5 | 3 |  |  | 10 |
| shuffling |  | 1 |  |  |  |  |  | 1 |
| drifting | 1 | 2 | 1 |  | 1 | 1 |  | 6 |
| resting | 1 |  | 1 |  | 2 | 11 |  | 15 |
| logging |  | 5 |  | 3 | 1 |  |  | 9 |
| hauled out |  |  |  |  |  | 16 |  | 16 |
| foraging | 33 |  | 2 | 3 | 1 | 3 | 2 | 44 |
| feeding |  | 6 | 6 | 18 | 179 | 4 | 9 | 222 |
| hunting |  | 43 | 35 |  |  | 5 | 4 | 87 |
| eating |  | 1 | 1 |  |  | 5 | 7 | 14 |
| kill |  | 6 |  |  |  |  |  | 6 |
| attacking |  | 2 | 1 |  | 1 |  |  | 4 |
| chasing |  | 2 | 2 |  |  | 1 | 1 | 6 |
| quickly | 17 | 30 | 14 | 5 | 2 | 1 | 1 | 70 |
| fast | 3 | 9 | 6 | 1 | 1 | 1 |  | 21 |
| porpoising | 6 | 2 | 2 |  |  |  |  | 10 |
| slowly | 26 | 51 | 38 | 10 | 24 |  |  | 149 |
| meandering |  |  |  | 1 | 1 |  |  | 2 |
| directional changes | 26 | 14 | 9 |  | 1 |  |  | 50 |
| flipped | 9 | 6 | 1 |  | 1 | 1 |  | 18 |
| turned around |  | 3 |  |  | 2 |  |  | 5 |
| back and forth |  |  |  | 1 | 2 |  | 3 | 6 |
| zigzag |  |  |  | 1 |  |  |  | 1 |
| spread out | 229 | 47 | 17 |  | 1 |  |  | 294 |
| in groups | 12 | 8 | 8 |  |  | 1 |  | 29 |
| split up | 1 | 1 |  |  |  |  |  | 2 |
| grouped up | 14 | 14 | 10 |  |  |  |  | 38 |
| together | 1 |  | 2 | 2 | 2 | 2 | 1 | 10 |
| long down times | 6 | 14 | 8 | 2 | 3 |  | 1 | 34 |
| long dives | 1 |  |  | 3 | 1 |  |  | 5 |
| sounded |  |  |  | 1 |  |  |  | 1 |
| fluking |  |  |  | 19 |  |  |  | 19 |
| surface active | 76 | 45 | 24 | 10 | 3 |  |  | 158 |
| breaching | 23 | 5 | 8 | 18 | 2 |  | 1 | 57 |
| tail slapping | 3 | 3 | 4 | 1 |  | 1 |  | 12 |
| pec slapping |  |  |  | 4 |  |  |  | 4 |
| spyhopping | 2 | 3 | 1 |  |  |  |  | 6 |
| playing |  | 1 | 2 |  |  | 4 | 4 | 11 |

What the counts say for a forecast:

- **Spread is the Southern Residents' word.** 229 of their 847 reports say the group is spread out, often *spread north to south* or *spread from shore to mid channel*.
- **Speed is said in words more often than it could be measured.** *Slowly* (149) and *quickly* (70) are direct evidence for the speeds bd `salish-xz0i` needs.
- ***Flipped* means the group reversed its heading.** Eighteen reports say it, usually hedged (*possibly flipped southbound*). Like *directional changes*, it says that the last heading is a poor guide.
- **Gray whales are reported feeding** in 179 of their 682 reports, more than any other kind, and a feeding whale is one a forecast should expect to stay in the area.
- **Long down times say when a group will be hard to find,** not where it will go: it can surface far from where it was last seen.

## How it was checked

- **Precision:** twelve random matches per phrase were read by hand in a first draft, which grouped synonyms. Four rules were wrong and are fixed. *Travelling* nearly always accompanies a heading the direction already carries (*traveling SB*), and sometimes means company (*traveling with T124A2*), so there is no travelling tag. *Dove* and *diving* catch ordinary dives, so only long ones count. *Loosely grouped* had counted as both spread out and grouped up, and now counts as neither. *Fishing* is as often the observer (*fishing for salmon from my kayak*) as the animal.
- **Names:** a capitalised word is a name, not a behaviour, when a place word follows it (*Mill Bay*, *Hunts Point*), when it is in a reporter's credit in brackets (*(Jim Chase)*, *(Sara Quick)*), or after *by* (*videos by Chase and Sarah*). Anywhere else a capital is just a capital (*J Pod Milling*, *milling/Foraging*). *Zig Zag*, *Zigzag*, *Fluke* and *Split Fluke* are humpbacks, so *zigzag* and *fluking* match only in lower case, even starting a sentence. *No* in *Point No Point* is not a denial. Humpback nicknames are the main hazard for a list of phrases, and any new phrase should be checked against them.
- **The gold set:** each report's hand-read behaviour phrases are put through the same list and compared with what the reader finds in the full text; [`src/behaviour.test.ts`](../../src/behaviour.test.ts) records the rows that disagree. Of the three, two are the reader being right where the label is literal (*after feeding*; *changed direction*, which the labeller didn't record), and one is a miss (*two traveling north together*).
- **What no tag takes:** field marks (*blows visible*, *white lower jaw visible*), headings the direction already reads (*trending north*), positions (*hugging the shore*), and the order of a group (*leaders here*, *moved on one by one*), which is read as the part of the group instead.
- **Leaders and trailers:** all 31 reports read as putting the leaders or the trailers *here* were read right by hand, including *J and K pod leaders N of here, trailing male milling/foraging here*, which is the trailers.

Reproduce with `node scripts/gold/behaviour.ts <dir of day files>`, `--examples <tag>` and `--gold`. The day files are the site's own, `https://salishsea.io/read-path/days/<date>.json`.
