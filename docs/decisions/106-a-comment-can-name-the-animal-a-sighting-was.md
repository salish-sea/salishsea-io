# 106 — A comment or an identification on an iNaturalist observation can name the animal it was

**Status:** accepted · **Decided:** 2026-10-12 by Peter (that reading a comment for an animal is not republishing it, bd `salish-4s42`); 2026-11-02 by Peter (that it be built, and that deleted accounts' remarks are not used, [081](081-what-inaturalist-takes-down-we-take-down.md)); the details below were settled while building it, 2026-11-02 · **Work:** bd `salish-4s42` · **Builds on:** [105](105-the-build-and-the-browser-read-sighting-text-with-one-reader.md) (the reader), [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) (an observation is its evidence and its identifications), [rights-policy §5.5](../rights-policy.md#55-inaturalist-identifications-and-comments-are-mirrored-not-published-d-23)

## Context

People often name the animal in an iNaturalist observation's comments or identifications, not in its description. [Observation 116194505](https://www.inaturalist.org/observations/116194505) has no codes in its description, and an identifier wrote "Those are T19B 'Galiano' and T19 'Nootka' (and possibly T19C 'Spouter')!" Until now the build read only the observer's description ([105](105-the-build-and-the-browser-read-sighting-text-with-one-reader.md)), so such a sighting appeared on no animal's profile page. The iNaturalist mirror has kept comments and identifications, with their text, since #678.

Over a copy of production on 2026-11-02, iNaturalist's observations carry 7,123 comments and 3,500 identifications with text. About one comment in eighty and one identification in ten names an animal, mostly in the shape "T019B Galiano", "This is K14 'Lea' :)" or "T090B on first picture".

## Decision

**The build reads each comment and each identification's remark on an iNaturalist observation with the same reader as the description,** `readText` in [`src/sighting-text.ts`](../../src/sighting-text.ts), exactly as written: a remark has neither the collection tag nor the "Submitted by" tail that the reader strips from a report. It reads:

- every comment, and the remark on every identification its author still holds;
- not a withdrawn identification's remark, since its author took that identification back;
- not what iNaturalist's moderators hid, whose text the mirror doesn't keep;
- not what an account iNaturalist has deleted wrote ([081](081-what-inaturalist-takes-down-we-take-down.md)).

**A code a remark says was present becomes an identifier candidate, and nothing else.** It links the sighting to the animal's profile page, as a code in the description does. It does not join the occurrence's `identifiers`, so the map's label, the sighting's card and the Darwin Core archive show only what the observer wrote. The direction and the pods come only from the observer's text, as before: a commenter's "heading north" may be about another day.

**Each candidate records where it was read:** `origin` is `report` for the occurrence's own text, or `comment` or `identification`, and `origin_id` is that comment's or identification's iNaturalist id. A code named both in the description and in a remark is the report's. One named only in remarks is the first comment's, or else the first identification's. Recording the origin lets the confidence [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) leaves open weigh someone else's word apart from the observer's; nothing weighs it yet.

**A profile page shows the sighting, never the remark or who wrote it.** Peter ruled on 2026-10-12 that reading an animal out of a comment is not republishing the comment ([rights-policy §5.5](../rights-policy.md#55-inaturalist-identifications-and-comments-are-mirrored-not-published-d-23)). Showing the words, or crediting their author, still needs its own rights review.

How it is built: [`derive/readings.ts`](../../scripts/read-path/derive/readings.ts) writes `memory.remark_claims`, one row per remark that names something, beside 105's `memory.reading`, which stays the reading of the observation's own text. The iNaturalist view in [`derive/occurrences.sql`](../../scripts/read-path/derive/occurrences.sql) gathers the present codes into a column of `build.occurrences`, `remark_identifiers`, which the occurrence's document doesn't include, and [`derive/identifier-candidates.sql`](../../scripts/read-path/derive/identifier-candidates.sql) reads both. The Stelis graph declares `inaturalist_mirror.comments` as an input of the occurrences, so a new comment re-derives iNaturalist's observations.

## What changed, measured on production

Over the same copy, built with this change and without it:

- **466 new candidates**, 82 read from comments and 384 from identifications, on 386 sightings. 430 of them resolve to an animal or a matriline in the register. No candidate the descriptions gave was lost.
- **304 sightings now appear on an animal's profile page** where they appeared on none, and 190 animals gain sightings. The links to individuals grow from 66,929 to 67,584, to matrilines from 9,601 to 9,645, and to ecotypes from 9,021 to 9,354.
- **Accuracy:** in a random 30 of the 430, 29 are right. The wrong one comes from a comment that corrects someone: "not the T090s actually. This was the T030Bs, the T117Bs and T124C" names the T90s too. The reader understands a report's shorthand for absence, *T46s (-D)*, but not *not* in a sentence, which reports rarely use and comments do. That is bd `salish-sepv`. A hedge such as "possibly T019C" makes a candidate as an unhedged code does, until `salish-uh38` stores certainty on candidates.
- **Cost:** about 0.2 s more for the occurrences, on Hostess, with the same peak memory. Reading every remark takes 63 ms.

## Rejected

- **Adding the codes to the occurrence's `identifiers`.** The map's label and the archive's `unvalidatedIdentifiers` would then show a commenter's guess as the observer's report, and the archive would republish what someone else wrote.
- **One reading per observation, with its remarks appended to its description.** A direction or pod a commenter mentions would become the sighting's, and the origin of each code would be lost.
- **Reading withdrawn identifications' remarks.** Their authors took them back. A comment can't be withdrawn, only deleted, and then it leaves the mirror.
- **Waiting for presence and certainty on candidates (`salish-uh38`).** That work adds columns beside these; it doesn't change which codes a remark names.
