# 107 — A sighting's card shows what people said about it on iNaturalist, credited to them

**Status:** accepted · **Decided:** 2026-11-02, by Peter (that the card reproduce the comments, the chips staying as they are; that SalishSea.io is non-commercial; that they come from the build's files; that identifications without a remark be grouped; the inline layout) · **Work:** bd `salish-065b`; the epic it starts is `salish-6122` · **Amends:** [rights-policy §5.5](../rights-policy.md#55-inaturalist-identifications-and-comments-are-mirrored-not-published-d-23) (D-23, "never republished"), [106](106-a-comment-can-name-the-animal-a-sighting-was.md) (a visitor never sees the remark) · **Builds on:** [075](075-an-inaturalist-observation-is-evidence-and-identifications.md), [081](081-what-inaturalist-takes-down-we-take-down.md)

## Context

[Decision 106](106-a-comment-can-name-the-animal-a-sighting-was.md) made the codes people name in an iNaturalist observation's comments and identifications the sighting's own. A card then showed chips that a stranger's comment had put there, with nothing to say so. bd `salish-065b` first asked for the chips to show where each came from. Mockups of three ways to mark them were made and set aside.

Peter, 2026-11-02: "The intention is that users, especially curators, but perhaps also ML models, can weigh in on reports similarly to how they do on inat. I'm thinking the chips stay as they are, but we reproduce the comments on the card." Someone weighing a report needs the words, not a mark on a chip. The rights policy forbade this: it kept comments and identifications in the mirror and said they are "never republished" ([§5.5](../rights-policy.md#55-inaturalist-identifications-and-comments-are-mirrored-not-published-d-23), D-23). Showing their text or their authors was named as the thing that needs its own rights pass.

## Decision

**An iNaturalist sighting's card shows what people said about it, under its photos.**

![The card for iNaturalist observation 116194505: chips T19B, T19 and T19C; two photos; under a hairline, "Identified as Killer whale by 13 people on iNaturalist"; then "marsidae · identified it as Killer whale · May 9, 2022" over the remark "Those are T19B 'Galiano' and T19 'Nootka' (and possibly T19C 'Spouter')! They're quite well known individuals, nice capture!", its codes linked](images/107-card-activity.png)

- **Identifications without a remark are grouped by taxon**, as iNaturalist's own summaries do: "Identified as Killer whale by 13 people on iNaturalist". With several taxa: "Identified on iNaturalist as Killer whale by 12 people and Bigg's killer whale by 1 person". An observation carries about three identifications and almost none has a remark, so listing each one would make an iNaturalist sighting's document about a quarter larger and say little.
- **Each comment, and each identification with a remark, is listed in full**, oldest first, under a line saying who wrote it and on what Pacific day, and for an identification what it identified the sighting as: "marsidae · identified it as Killer whale · May 9, 2022". The observer is named as such ("sjmurray55, the observer"), since their word on their own sighting weighs differently. The text is rendered as a report's is, with codes linked to the animals' pages.
- **What stays out is what stays out of 106's reading:** a withdrawn identification, what iNaturalist's moderators hid, and anything written by an account iNaturalist has deleted ([081](081-what-inaturalist-takes-down-we-take-down.md)).
- **It is shown inline,** not behind a click. Peter chose this over a one-line summary that opens. A sighting with any has one or two entries on average (3,485 over 2,385 sightings), and the busiest observation in the mirror has 26 comments.
- **The chips are unchanged.** A chip read from a comment looks like one the observer wrote. The comment under the photos is where a reader sees who said it.

**The words come from the build's files, not from iNaturalist's API.** The build writes two keys into each document: `identified_as`, a list of taxa with how many people chose each, and `activity`, the comments and remarks with each one's kind, iNaturalist id, time, author, whether the observer wrote it, the taxon an identification names, and its text. Both are empty for every other source. A taxon is named as the sighting's own is: as iNaturalist now calls it ([032](032-retired-taxa-resolved-on-read.md)), by the register's common name where it has one, so iNaturalist's "Orca" reads "Killer whale". An author is credited as iNaturalist credits them, by display name, else by login. A card has them without another request. The mirror's rules apply to what it shows, as they do to the codes read from the same text, and when people come to weigh in on SalishSea.io itself (`salish-6122`), their claims can sit in the same list under the same rules. The rejected alternative is below.

### The rights pass (rights-policy §5.5, amended)

iNaturalist offers no license choice for a comment or an identification. Its Terms of Service license what a person contributes under CC BY-NC unless they say otherwise, so a comment is under its author's CC BY-NC (§5.5's basis, unchanged). That license allows reproducing the text on two conditions:

- **NC (non-commercial):** SalishSea.io is non-commercial (Peter, 2026-11-02).
- **BY (attribution):** each comment and remark is shown with its author's name as iNaturalist credits them, beside the card's link to the observation on iNaturalist, where the original is.

So §5.5's "never republished" becomes "shown on the sighting's card, credited, and nowhere else." The Darwin Core archive still leaves out iNaturalist (§5.1), and nothing is shown on profile pages or map labels.

## Measured on production

Over a copy of production on 2026-11-02, 2,385 of 33,438 iNaturalist sightings have comments or remarks to show: 3,485 entries in all. iNaturalist documents grow 8.5% (41.7 MB to 45.3 MB); every other document grows by the two empty keys, about 4%; in all, 66.5 MB becomes 71.0 MB, 7% more. Listing every identification instead of grouping them would have made iNaturalist documents about a quarter larger. The occurrences step takes about 1.1 s more, 6.3 s against 5.2 s on Hostess, with the same peak memory.

## Rejected

- **Marking the chips by where each came from** (bd `salish-065b` as first written; mockups of a caption, words in the chip and a speech-bubble mark). A mark says someone else named the animal; it doesn't let anyone judge whether they were right.
- **Fetching the comments from iNaturalist's API when a visitor opens the card.** It would always be current, where the mirror can lag a new comment by up to a month (106). But the card would depend on iNaturalist answering at viewing time, the site's content-security policy would have to admit iNaturalist's API, the mirror's rules (081) would not apply, and claims made on SalishSea.io later would come from somewhere else.
- **Listing every identification,** with or without a remark: about a quarter more bytes per iNaturalist sighting, nearly all of them "Killer whale" again.
- **Showing only comments that name an animal:** a curator needs the whole thread, including the comment that says "not the T90s".
- **A one-line summary that opens on a click:** Peter chose inline.
