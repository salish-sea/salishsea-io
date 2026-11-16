# 120 — Curators review a day's reports from every source, and a point read from Facebook waits for them

**Status:** accepted · **Decided:** 2026-11-16, by Peter · **Work:** bd `salish-i1a.3.17` · **Builds on:** [014](014-trust-and-curation-model.md) (claims have a status, curators assert it), [054](054-certainty-is-the-asserters-status-is-ours.md) (status is ours), [062](062-segment-edits-are-claims-about-sightings.md) (segment edits are claims), [117](117-sightings-from-a-facebook-group-arrive-when-a-signed-in-person-sends-the-days-post.md) (sightings from a Facebook group)

## Context

Decision 117 brings sightings from Orca Network's Facebook group by reading the text of its posts and comments with rules. The demo of 8–15 November showed what such rules get wrong. They place a report by the observer's viewpoint rather than the whales, misread a ferry or a misspelling, and miss a place they don't know. Some of what they read is right but incomplete: a time or heading that comes in a later reply. A sighting placed wrongly does harm at once. It goes on the map, into the archive, and into any notice to ships.

How fast a sighting reaches ships matters as much as whether it is right. The partnership with the Marine Exchange of Puget Sound turns a report in the group into a notice to ship crews, and minutes count there. Decision 117 chose its route because it can bring a report in minutes rather than hours.

Other sources have text that a rule reads too: Maplify's comments and iNaturalist's descriptions. And a curator judging a day wants to see a group's reports beside the hydrophone detections of the same animals, not one source at a time.

## Decision

**Curators review a day's data in one view that holds every source.** Facebook posts, Maplify reports, iNaturalist observations and Orcasound detections are shown together, for a day, on a map and a timeline. The timeline gives the speed each point implies from the one before it of the same animals, so a point that would need them to swim too fast stands out. The curator can move a point, approve or withhold it, and correct what was read from its text: its place, time, animals and other labels.

**The curators are Orca Network's staff, Scott Veirs, and others named later.** They are the people who already judge these reports, and Orca Network's staff are the ones who send the group's posts (117).

**A point read from a Facebook post waits for a curator's approval before it shows, until we are confident the reading works.** Then a point shows at once, and a curator can withhold it afterwards. The other sources keep showing at once, as now, and are reviewed afterwards. Because the wait delays notices to ships, approval must be quick. Curators hear when a send brings new points, and a correct point is approved in one step.

## Undecided

- **How correcting what was read relates to confirming the report.** They are different things. A correction says what the report means: this place, not that one. A confirmation or rejection (014) says whether the report, or a part of it, is right. Two separate sets of controls may be too heavy or too subtle for curators to use well, so whether the interface shows them apart or folds them together is open (Peter, 2026-11-16).
- **What counts as confidence that the reading works.** For example, the share of points that curators approve unchanged over some weeks. Who decides to lift the wait, and on what evidence, is open.
- **How a correction is stored.** Probably as a claim with provenance, as 014's identifications and 062's segment edits are, so that a better reader can be run again without losing a curator's correction. Not yet designed.

## Rejected

- **Show Facebook points at once and withhold the wrong ones afterwards.** Until the reading has proved itself, a wrong point would reach the map and the ships first.
- **A separate review screen for each source.** A curator judges a sighting by the others around it, from every source.

## Consequences

- The curator role in 014, which is not built, is now needed for the Facebook route's production version (bd `salish-i1a.3.17`), and the write API needs to know who is a curator.
- A Facebook point has a status before it shows. The build derives its occurrences (bd `salish-i1a.3.6`) but publishes only approved ones until the wait is lifted.
- Notices to ships wait for approval too. The interface's speed is part of the Marine Exchange partnership's latency.
