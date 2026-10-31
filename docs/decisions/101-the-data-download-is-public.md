# 101 — The data download is public, with its third-party records, and owes no one a notice first

**Status:** accepted · **Decided:** 2026-10-31, by Peter · **Work:** bd `salish-8gd` · **Amends:** [004](004-rights-and-licensing.md) and the [rights policy](../rights-policy.md)'s §4

## Context

The rights policy said the Darwin Core archive's third-party records, the Maplify sightings that make up nearly all of it, should stay unlinked until two things happened (§4.1 and §4.5, the hold called D-05): a check of those records for problems that would mislead a researcher, and a "courtesy notification" to Whale Alert/Conserve.IO, Orca Network and Cascadia Research, followed by two to four weeks for them to reply. Our own records were to wait for a notice on the sighting form (D-08). The About page has linked the archive publicly since 18 June 2026, when neither had happened.

The courtesy notices were never a decision anyone made. On 10 June an agent planning the archive concluded that those organisations had stated no terms for their sightings, and designed the hold as a request for their permission. On 17 June Peter pointed out that Acartia, the data cooperative every Maplify sighting comes through, has its contributors grant CC BY 4.0 at registration, which settles the permission. The agent then kept the hold and renamed the permission request a courtesy notice (`a8d7c32`). Peter's only input was the CC BY fact. Contacting partner organisations isn't this project's work, and isn't tracked here.

The other conditions are met:

- **The check,** on 30 October: nothing systematic beyond one error. A Maplify record's date was the UTC day its report arrived, the next day for one report in six. #805 and #806 fixed it. The smaller findings (48 automatic detections labelled as seen by a person, 264 observer names that aren't people, 34 repeated rows, a subspecies GBIF matches only to the species) are listed in #805 and don't mislead about where or when animals were.
- **Our own records' consent,** on 31 October: the terms of use (#807, [086](086-what-we-know-now-is-a-file-to-poll.md)) replace D-08's notice. The archive includes a contributor's sightings once they have agreed.

## Decision

**The archive is public and linked, with every source it holds.** The hold (D-05) has ended: the check is done, and the courtesy notices are no longer a condition. CC BY asks for credit, not notice, and the archive gives the credit Acartia asks for: each record names its source organisation and the chain it came through (`datasetName`, `dynamicProperties`), and the metadata names Acartia and links acartia.io.

**A source organisation that asks to be left out is left out.** The per-source switch (D-03) stays for that, and for a source a later check finds broken.

**One archive, not a second one of our own records alone.** D-07 asked whether our own records needed an archive of their own, so they could go public before the third-party ones. They are filtered at build time instead, by each contributor's agreement to the terms (#807), so the question is closed.

## Rejected

- **Keeping the courtesy condition.** It rests on a permission question CC BY already answers, nobody decided on it, and it would hold the archive for outreach that falls outside this project.
- **Unlinking the archive until the notices go out.** It has been public for four months, nothing in its license asks for notice, and taking it down now would hide data people may already cite.

## Consequences

- The rights policy's §4 is amended in place: the notices are marked as no longer a condition, with what they said kept.
- [004](004-rights-and-licensing.md) is marked amended by this record, and the decision index's D-05 and D-07 rows say how they ended.
- bd `salish-8gd` closes.
