# 110 — A matriline's page and timeline gather its sub-lineages' and members' reports, drawn apart from its own

**Status:** accepted · **Decided:** 2026-11-04, by Peter · **Work:** bd `salish-fwyt.7` (epic `salish-fwyt`) · **Settles:** [096](096-a-subjects-view-is-a-list-of-its-events.md)'s question of whether a group's view gathers its members' reports · **Amends:** [098](098-an-animals-timeline-is-months-of-encounters.md) · **Builds on:** [050](050-matriline-membership-is-the-registers.md) (matriline membership is the register's)

## Context

A matriline's page, its sidebar view and its timeline held only the reports that named the matriline itself. Reporters rarely write the larger matriline: they write the sub-lineage they saw, or the animals. T065s had 6 reports and 5 encounters, the last on 3 July 2026, while its sub-lineages T065As and T065Bs had 1,418 reports between them and its members another 822 on their own. Of the 201 matrilines with pages, 57 had an empty timeline.

The register's membership is genealogical ([050](050-matriline-membership-is-the-registers.md)): T065A5 is a member of T065As and of T065s. So a visitor opening T065s expects its descendants' reports, and the page answered as if the matriline had hardly been seen.

## Decision

**A matriline's reports are those that name it, a sub-lineage inside it at any depth (T065As or T065Bs for T065s), or one of its members directly (T065A5).** A member reached only through a group doesn't count again: a report of T065As is T065As's, whichever members it reaches. A member a report says was absent ("T65As (-A5)") doesn't bring the report in, as [109](109-a-sighting-keeps-what-its-text-says-was-absent-or-only-possible.md) keeps it off the animal.

**Each report keeps how it reached the matriline, and a report that reaches it more than one way keeps the most direct**: naming the matriline, then a sub-lineage, then only members. A report naming T065s and T065A5 is one of T065s's own.

**The page's count, its map, "Last reported", search's latest report and the timeline all read these reports**, so they agree. The timeline's line says how many named a sub-lineage or only members ("86 of 140 reports name T065s or its members: 6 T065s itself, 50 a sub-lineage, 30 only members"). A calf's first report ([096](096-a-subjects-view-is-a-list-of-its-events.md)'s amendment of 2026-11-04) now reaches its matrilines' timelines, since the report that names the calf is one of theirs.

**The maps draw the three kinds apart, by colour**, chosen over size or a ring on mockups of T065s's real page: the matriline's own reports in the profile map's blue, a sub-lineage's in a lighter blue, and reports naming only members in grey, the quietest for the least direct. Where reports of different kinds share a spot, the dot takes the most direct kind and is drawn above the others; the newest dot takes its own report's kind. A legend under the map counts each kind: "Reports naming T065s (6)", "Reports naming a sub-lineage, T065As or T065Bs (1,418)", "Reports naming only members, such as T065A5 (822)". The main map beside the sidebar draws a matriline's reports in the same three colours, and the sidebar shows the same legend.

**"Naming only members", not "lone":** the data knows that a report named individuals and no group, not that an animal travelled alone.

## Rejected

- **A second control** (the group's own reports, or the group with its members), which 096 left open: one view that draws the kinds apart answers both questions at once.
- **Size or a ring to tell the kinds apart:** on a busy map of a few thousand dots, colour read at a glance and the others didn't.

## Consequences

- The build writes the new rows into the matrilines' links (`build.group_occurrences`, [derive/profile-links.sql](../../scripts/read-path/derive/profile-links.sql)): a sub-lineage's report carries `via_group`, a member's `via_member`. Over the 201 matrilines with pages, reports went from 9,503 to 20,001, and the derivation's peak memory stayed the same, measured on a copy of production's snapshot.
- An encounter on a matriline's timeline counts `only_members` beside `as_self` ([src/encounter.ts](../../src/encounter.ts)).
- A matriline's month cards no longer list its own sub-lineages and members among the animals it was with.
- A population's or pod's page draws a small map for each of its matrilines from the same links, so each now shows the matriline's whole set of reports, in one colour. This follows from the build's change rather than being decided on its own; a small map that drew only the matriline's own reports would disagree with the page it links to.
- The colours are data colours ([docs/style-guide.md](../style-guide.md)).
