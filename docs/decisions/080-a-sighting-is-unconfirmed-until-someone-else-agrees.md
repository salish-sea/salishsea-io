# 080 — A sighting is unconfirmed until someone other than its reporter agrees, and the map shows it so

**Status:** accepted · **Decided:** 2026-10-19, by Peter · **Answers:** the first rule [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) left open ("how confidence is computed") · **Relates:** [008](008-source-schemas-are-upstream-mirrors.md) (upstream flags are parsed, not adopted), [054](054-certainty-is-the-asserters-status-is-ours.md) (certainty and status), [029](029-map-symbology.md) and [077](077-a-ring-shows-where-the-animal-may-have-been.md) (what the map's marks mean)

## Context

The map and the sidebar draw every sighting the same way, whether several people have agreed on what it was or only the person who reported it has. Peter asked that tentative ones, such as iNaturalist observations still marked "Needs ID", be shown differently.

075 decided that iNaturalist's quality grade is iNaturalist's verdict, made by its rules, and is not adopted as ours; our confidence is derived from the identifications we mirror. 008 says the same of Maplify's `trusted` flag: an upstream field may be read as an input to a concept of ours, never surfaced as our concept.

## Decision

**A sighting is either confirmed or unconfirmed.** "Unconfirmed" is our concept. Each source has its own rule for it, because each records agreement differently:

- **iNaturalist:** confirmed when someone other than the observer has a current identification of the species we show, or of a taxon within it, and no current identification names a different branch. Otherwise unconfirmed. An identification only to a broader group, such as "toothed whales", neither confirms nor disputes.
  - *Example:* someone posts a photo as a harbour porpoise and nobody else has looked. That's unconfirmed. A second person agrees, and it's confirmed. A second person suggests Dall's porpoise instead, and it's unconfirmed, because the identifications disagree.
  - *Over the mirror on 2026-10-19:* 82,337 of 88,818 observations are confirmed, 5,759 unconfirmed and 722 disputed. Of 2026's 16,303, 1,634 are unconfirmed, about 10%.
- **Maplify:** unconfirmed when Maplify doesn't mark the report trusted. Its `trusted` flag is an input here, as 008 allows, not the meaning of the word. That's 14,938 of 47,542 reports, and 2,672 of 2026's 8,472. The Darwin Core archive already takes only trusted reports, and still does.
- **Orcasound:** a bout whose species is tagged `possible` (054) is unconfirmed. A `possible` tag on a pod or an animal below the species keeps its trailing `?` and doesn't make the sighting unconfirmed.

Sightings entered on SalishSea.io itself, and HappyWhale's, are shown as confirmed for now; whether they should be is not decided here.

**How it looks.** On the map, an unconfirmed sighting is an outlined dot: a white centre with an edge in the species' colour, at the size of a confirmed dot. It is not a ring in 077's sense, which is a large faint area to the radius the animal may have been within. In the sidebar, its entry says "Unconfirmed", or "Disputed" for an iNaturalist observation whose identifications disagree. Profile pages list it marked the same way. Nothing is hidden.

## Not decided here

- **A higher bar for surprising sightings.** Peter's direction for later: a sighting that is unusual where or when it was made, or of a rare species, might need more than one other person's agreement, or a curator's. That needs a notion of what is expected, which we don't have yet.
- **Reputation** (014). An identifier we trust might confirm a sighting alone, and a curator might confirm one directly (054's `status`). Neither exists yet.
- **Our own sightings and HappyWhale's**, as above.

## Rejected

- **iNaturalist's quality grade as the rule.** 075 rejected adopting it, and still does: this rule gives nearly the same answer, but it's ours to change.
- **Hiding unconfirmed sightings,** or hiding them by default. Most are right, and a sighting nobody has checked yet is still the first word that whales are about.
- **A faded dot.** Fading reads as "less important" or "longer ago", not "not yet checked", and a pale dot is hard to find against the depth tints.
- **The 077 ring.** That shape already means "the animal may have been anywhere in here".
