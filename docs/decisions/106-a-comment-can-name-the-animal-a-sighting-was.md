# 106 — A comment or an identification on an iNaturalist observation can name the animal it was

**Status:** accepted · **Decided:** 2026-10-12 by Peter (that reading a comment for an animal is not republishing it, bd `salish-4s42`); 2026-11-02 by Peter (that it be built, and that deleted accounts' remarks are not used, [081](081-what-inaturalist-takes-down-we-take-down.md)); the details below were settled while building it, 2026-11-02 · **Work:** bd `salish-4s42` · **Builds on:** [105](105-the-build-and-the-browser-read-sighting-text-with-one-reader.md) (the reader), [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) (an observation is its evidence and its identifications), [rights-policy §5.5](../rights-policy.md#55-inaturalist-identifications-and-comments-are-mirrored-not-published-d-23)

## Context

People often name the animal in an iNaturalist observation's comments or identifications, not in its description. [Observation 116194505](https://www.inaturalist.org/observations/116194505) has no codes in its description, and an identifier wrote "Those are T19B 'Galiano' and T19 'Nootka' (and possibly T19C 'Spouter')!" Until now the build read only the observer's description ([105](105-the-build-and-the-browser-read-sighting-text-with-one-reader.md)), so such a sighting named no animal on its card and appeared on no animal's profile page. The iNaturalist mirror has kept comments and identifications, with their text, since #678.

Over a copy of production on 2026-11-02, iNaturalist's observations carry 7,123 comments and 3,500 identifications with text. About one comment in eighty and one identification in ten names an animal, mostly in the shape "T019B Galiano", "This is K14 'Lea' :)" or "T090B on first picture".

## Decision

**The build reads each comment and each identification's remark on an iNaturalist observation with the same reader as the description,** `readText` in [`src/sighting-text.ts`](../../src/sighting-text.ts), exactly as written: a remark has neither the collection tag nor the "Submitted by" tail that the reader strips from a report. It reads:

- every comment, and the remark on every identification its author still holds;
- not a withdrawn identification's remark, since its author took that identification back;
- not what iNaturalist's moderators hid, whose text the mirror doesn't keep;
- not what an account iNaturalist has deleted wrote ([081](081-what-inaturalist-takes-down-we-take-down.md)).

**A code a remark says was present becomes one of the sighting's own, and so do the pods it names.** It joins the occurrence's `identifiers` and `pods`, after the observer's, so the sighting's card, its map label and the animals' profile pages all come from one list, as they did before. A profile page lists a sighting because its card names the animal. A sighting on T19B's page whose card didn't say T19B would be a contradiction, both for a visitor and in the data. Two limits apply:

- **A code the observer names stays the observer's.** One the observer says was absent (*T46s (-D)*), in the description or in a comment of their own, stays out whatever anyone else says, since the observer was there. About a third of comments are the observer's own, often a correction or an addition.
- **The direction comes only from the observer.** A commenter's "heading north" may be about another moment, and only the observer saw this one.

The Darwin Core archive is unaffected: it leaves out every iNaturalist record (rights-policy §5.1).

**Each code records where it was read, and whether the observer wrote it.** The occurrence's `identifier_origins` lists, for each of its identifiers in order, `report` for the occurrence's own text, or `comment` or `identification` with that remark's iNaturalist id, and `by_observer`. The identifier candidates carry them as `origin`, `origin_id` and `by_observer`. A comment is the observer's when its author's login is the observer's; an identification says so itself. A code that several remarks name is taken from the observer's own remarks first, then from comments before identifications, each in the order iNaturalist numbered them. This lets the confidence [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) leaves open weigh someone else's word apart from the observer's. Nothing weighs it yet, and nothing a visitor sees shows it yet: a chip read from a comment looks like one the observer wrote, until bd `salish-065b` shows on the card where each came from.

**A visitor sees the code, never the remark or who wrote it.** Peter ruled on 2026-10-12 that reading an animal out of a comment is not republishing the comment ([rights-policy §5.5](../rights-policy.md#55-inaturalist-identifications-and-comments-are-mirrored-not-published-d-23)). Showing the words, or crediting their author, still needs its own rights review.

How it is built: [`derive/readings.ts`](../../scripts/read-path/derive/readings.ts) writes `memory.remark_claims`, one row per remark that names something, beside 105's `memory.reading`. 105's table stays the reading of the observation's own text, so each code keeps where it was read. The iNaturalist view in [`derive/occurrences.sql`](../../scripts/read-path/derive/occurrences.sql) adds the remarks' codes and pods to the observer's, and writes `identifier_origins` beside them as a column of `build.occurrences` that the document leaves out. [`derive/identifier-candidates.sql`](../../scripts/read-path/derive/identifier-candidates.sql) reads the two lists side by side. The Stelis graph declares `inaturalist_mirror.comments` as an input of the occurrences, so a comment that reaches the mirror re-derives iNaturalist's observations. A new comment doesn't always reach it at once: iNaturalist moves an observation's `updated_at` for a new identification but not always for a comment (130 of the 7,126 comments in the mirror are newer than their observation's `updated_at`), and the ingest's sweep follows `updated_at`. Such a comment arrives when its observation is next fetched for another reason: within a run for one seen in the last ten days, otherwise when the monthly anti-entropy sweep reaches its dates.

## What changed, measured on production

Over the same copy, built with this change and without it:

- **386 sightings gain codes, and 323 of them had none.** 10 gain a pod. Nothing else in any sighting's document changes.
- **466 new identifier candidates**, 82 read from comments and 384 from identifications; 36 of them are the observer's own remarks. 430 of them resolve to an animal or a matriline in the register. No candidate the descriptions gave was lost.
- **304 sightings now appear on an animal's profile page** where they appeared on none, and 190 animals gain sightings. The links to individuals grow from 66,929 to 67,584, to matrilines from 9,601 to 9,645, and to ecotypes from 9,021 to 9,354.
- **Accuracy:** in a random 30 of the 430, 29 are right. The wrong one comes from a comment that corrects someone: "not the T090s actually. This was the T030Bs, the T117Bs and T124C" names the T90s too. The reader understands a report's shorthand for absence, *T46s (-D)*, but not *not* in a sentence, which reports rarely use and comments do. The reader has since learnt to read that sentence ([105](105-the-build-and-the-browser-read-sighting-text-with-one-reader.md), amended for bd `salish-sepv`), so the T90s are now absent. A hedge such as "possibly T019C" counts as an unhedged code does, as in the observer's text, until `salish-uh38` stores certainty.
- **Cost:** reading every remark takes 63 ms. The occurrences step costs about 0.2 s more, and the identifier candidates about half a second more, measured on Hostess while it was busy, so roughly. Peak memory is unchanged.

## Rejected

- **Codes from remarks as profile links only, kept off the sighting's card.** This was the first version of this change. A sighting would appear on T19B's page while its card didn't name T19B, so the page and the card would disagree about the same sighting. It also broke the rule that every profile link comes from the sighting's own list. The reason given, keeping a commenter's guess out of the archive, doesn't apply: the archive leaves out iNaturalist.
- **Appending the remarks to the description and reading them as one text.** A commenter's direction would become the sighting's, a commenter could override the observer's "(-D)", and the origin of each code would be lost.
- **Reading withdrawn identifications' remarks.** Their authors took them back. A comment can't be withdrawn, only deleted, and then it leaves the mirror.
- **Treating the observer's own comments as anyone else's.** A third of comments are the observer's, and a correction such as "T137s (-B)" is the observer speaking: its absence must count as the description's would, and a later confidence must be able to tell it from a stranger's.
- **Waiting for presence and certainty on candidates (`salish-uh38`).** That work adds columns beside these, and doesn't change which codes a remark names.
