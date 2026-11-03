# 105 — The build and the browser read sighting text with one reader, which replaces the regular expressions

**Status:** accepted (merged as PR [#828](https://github.com/salish-sea/salishsea-io/pull/828), 2026-11-02) · **Decided:** 2026-11-01, by Peter (the plan, in bd `salish-2n60`); the details below were settled while building it, 2026-11-02 · **Work:** bd `salish-2n60`; `salish-uh38` stores what this leaves out · **Amends:** [102](102-reading-sighting-text-is-measured-against-a-gold-set.md) (its test of the regular expressions retires with them) · **Builds on:** [061](061-ingest-and-derivation-move-into-the-build.md), [054](054-certainty-is-the-asserters-status-is-ours.md)

## Context

Until now the build read a sighting's free text with two regular expressions ported from Postgres as twins, quirks included: one for a travel direction, one for the codes it names (`T65A5`, `J27s`, `CRC56`). The browser had three more patterns of its own for a contributor's sighting before the build published it, and for the pod on a map label. [Decision 102](102-reading-sighting-text-is-measured-against-a-gold-set.md) checked in a gold set of 200 Maplify reports read by hand, and [the measurement against it](../research/reading-sighting-text.md) found that a few rules over the words read those reports almost perfectly: wrong on two fields of 200 reports, where the regular expressions were wrong on 92. The rules read things the regular expressions could not see: *T46s (-D)* says T46D was absent, *T36/36Bs* names T36Bs, *NB* is northbound, and *north of Alki* is a place, not a heading. Peter asked for that reader to become the one the site runs.

## Decision

**One module, [`src/sighting-text.ts`](../../src/sighting-text.ts), reads a sighting's text for the build and for the browser.** It has no dependencies and no dictionary, so it bundles into the site and runs in node unchanged. It answers each code the text names as a claim: the code, whether the text says the animal was present or absent, and how sure the reporter was ([054](054-certainty-is-the-asserters-status-is-ours.md)'s `certain`, `probable` or `possible`). It also answers the pods named and the direction. The browser's `detectPod` and `detectIndividuals` call it. `detectEcotype` stays a pattern of its own, because the reader names no ecotype.

**In the build, a pass in node writes what each text says into a table the occurrence views join.** [`derive/readings.ts`](../../scripts/read-path/derive/readings.ts) streams each source's texts out of DuckDB (Maplify's comments, iNaturalist's descriptions, our own sightings' bodies), reads them, and writes `memory.reading(id, direction, claims, pods)`, as the water region and Maplify's entity are already written. The views in [`derive/occurrences.sql`](../../scripts/read-path/derive/occurrences.sql) take from it:

- **`identifiers`** are the codes the text says were present, hedged or not, as before. A code the text says was absent is no longer one of them. Storing absence and certainty is `salish-uh38`'s work. A humpback's BC catalogue code (`BCX1068`) is one too, by Peter's choice in review: it shows on the map label and in a card's list of animals, unlinked, and goes into the archive's `unvalidatedIdentifiers`. It will link to a profile page if the register adopts that catalogue.
- **`direction`** is one of the eight compass points, as the document's vocabulary allows. When the reader answers `milling` or `unknown`, the direction is null. Milling is a behaviour, not a direction, and belongs with the behaviour tags of bd `salish-2ua9`. *Direction unknown* says there is none.
- **`pods`** is a new key in every document: the pod letters the text names, such as `["J", "K"]`. A bout's is empty, since its pods are among its identifiers, from its tags.

**The archive takes each record's codes and direction from the occurrences the build derived,** as it already took the water region, rather than reading the text a second time. The map and the archive can't disagree on what a report says.

**The gold set keeps judging the reader.** [`src/sighting-text.test.ts`](../../src/sighting-text.test.ts) records which gold rows the reader gets wrong today, as `derive/extract-gold.test.ts` did for the regular expressions, and a change to its rules shows there as a change to that list. The regular expressions are kept in [`scripts/gold/readers/regex.sql`](../../scripts/gold/readers/regex.sql) so the measurement can still compare against them. Their test of agreement with Postgres retires: Postgres is gone, and the build no longer runs them.

## What changed, measured on production

Over every production text on 2026-11-02, the old reading and the new were compared occurrence by occurrence: 62,137 occurrences, 30,993 with text. One report in ten with text reads differently (3,045). By kind, with an example of each:

| change | count | example |
|---|---|---|
| a humpback's BC catalogue code is now read | 1,112 codes | *BCY0458 Raptor and BCX1068 Split Fluke circling* gains BCX1068 |
| a direction where there was none | 637 | *Biggs T46Bs NB* gains north |
| a different direction | 560 | *L pod was eastbound, now trending west*: east becomes west |
| a direction dropped: a bearing, a place, *facing* | 417 | *2 miles east of location*: east becomes none |
| a code written without its letter | 303 codes | *Bigg's T36, 36Bs, T99s NB* gains T36Bs |
| a code the text says was absent, no longer listed | 167 codes | *Biggs T137s (minus T137D) Northbound* loses T137D |
| a direction dropped: the text says milling | 119 | *still milling around at 12:43 off Burfoot* |
| a code listed twice, now once | 76 | |
| a direction dropped: the text says it is unknown | 19 | *Direction unknown* |
| a code read where there was none, other | 24 codes | *the greater L4s* gains L4s; *T37-A* is T37A, where the old reading had T37 (5 such) |

The comparison caught four mistakes the gold set could not, because none of its 200 reports had the pattern. All four are fixed in the reader, and the gold rows it gets right are unchanged:

- From 2020 to early 2022 Orca Network wrote the whole report inside its tag, *[Orca Network: T65As northbound]* (258 reports), and the reader was given nothing to read. The report is now what follows the colon.
- Codes written in lower case, *t46s* and *crc22*, were not read. Now they are, when the letter touches its number.
- A number without its letter was read as a Bigg's code anywhere in a report that said Biggs, so *spread in 1s to 4s* named T1s and T4s. Now such a number counts only in a list after a code (*T36, 36Bs*), or right after *Biggs*.
- A reporter's surname was read as a direction: *(Steve East)*. A capitalised compass word right after another capitalised word is now part of a name, unless that word is a verb of travel, as in *Heading South*.

One known wrong reading remains: *J2* in a parenthesis is a boat whose AIS track a reporter followed, and is read as the whale J2 (five reports). A rule against one-letter, one-digit codes would also drop T007, a code in our catalogue.

The pass costs about half a second, 4.7 s against 4.15 s for the whole derive step on Hostess. Its memory is lost in the noise between runs, about 770 MB at peak either way on Hostess, which allocates more freely than the 2 GB Fly machine. Appending each reading's claims as lists of structs through DuckDB's Node API had cost 110 MB and 0.3 s more. Writing each reading as JSON text and letting DuckDB parse it costs neither.

## Amended 2026-11-02: a negation in a sentence (bd `salish-sepv`)

Reading comments on iNaturalist observations ([106](106-a-comment-can-name-the-animal-a-sighting-was.md)) showed the reader taking "not the T090s actually" as naming the T90s. People correcting each other write *not*, and some observers write "T100s (no T100E)". The reader now makes absent the codes a negation governs:
- **A negation** is *not*, *no* or a negative verb (*isn't*, *don't*, *did not see*, …), followed within a few words of the same clause by a code ("not the T090s", "I don't recognize this as any T077").
- **A list after it is governed too**, over *and*, *or*, *nor*, *&*, a slash or only a space ("no T060D T060E"), and so are short forms ("Not seeing T65A2 & A3", "No T65A & B"). A letter alone is a short form only after a list separator and not before a bearing ("No T65A, E of Lime Kiln" names no T65E). A comma continues the list only inside a parenthesis the negation is in ("(no T049A1, T049A2)"), before a short form, or, after *no* or a negative verb, in a list that ends in *or* or *nor* and a code ("no T65A, T65B or T65C"). Elsewhere a comma starts a correction, so "Not T090s, T030Bs or T037s" makes only the T90s absent. A plural written with an apostrophe is part of the list ("no T46B's, T46C's").

These are not negations:
- *not sure*, *not certain* and *not positive* are hedges that make a code possible;
- *not only*, *not just* and *no doubt* affirm, and *whether or not* and *if not* say nothing either way;
- a possessive is about something of the animal's, not whether it was there: "not T65A's usual range", "not T65A's son". A code with *'s* is a plural, and negated, when punctuation, the end, or a word of time or place follows: "No T124D's today";
- *never* is left out, because "never seen the T65As this far north before" is said of animals that are there;
- a negated question, "Isn't it T65A?", makes its codes possible rather than absent. One asked with an auxiliary and a pronoun (*isn't it*, *aren't they*) runs to the end of its sentence, commas and all ("Isn't it T65A, the one with the notch?"), and never makes its codes absent, even without its *?*. Any other question is the negation's own clause: *but*, or a comma that doesn't continue a list, ends it, so "No T65A, is it T65B?" still makes T65A absent. A sentence ends at a full stop before a capital, a semicolon or *!*; an ellipsis, *i.e.*, *e.g.* and abbreviations such as *Pt.* and *approx.* don't end it. A full stop before a lower-case word doesn't end it either, which can miss a negation, but never invents one.

Over every production text on 2026-11-02, 15 of about 66,000 read differently:
- 4 of 38,900 Maplify reports: "one not CRC 2440", "Not seeing T65A2 & A3", "Did not see T37A or T137" and "have not seen T46D and T46E";
- 7 of 16,079 iNaturalist descriptions, such as "T060s (no T060D T060E)";
- 4 remarks: the two found in 106's sample, and "I don't see T124C".

14 of them are now right. The 15th is a link whose address contains "no" and "?", which turns a code read out of the address from certain to possible, and which was never a real reading anyway. The gold rows the reader gets wrong are unchanged.

## Rejected

- **Patching the regular expressions instead.** The measurement in decision 102 showed the misses are patterns that rules over the words fix. Patterns over characters cannot say that *(-D)* removes an animal named before it.
- **Keeping the browser's own patterns.** A contributor's sighting would carry one set of codes until the build published it, then another.
- **Reading the text again in the archive's step.** The archive would need its own pass and could disagree with the map. It already reads `build.occurrences` for the place.
- **Storing `milling` and `unknown` as directions.** Milling is something the animals are doing, not a heading, and *unknown* is the absence of one. The document's direction stays the eight compass points that the site's types, the archive's `travelDirection` and the map's heading assume.
- **Appending the claims through the Node API as typed lists.** This was measured and rejected: see above.
