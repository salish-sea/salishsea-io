# 080 — A sighting is unconfirmed until someone other than its reporter agrees, and the map shows it so

**Status:** accepted · **Decided:** 2026-10-19, by Peter · **Work:** bd `salish-bwma` · **Answers:** the first rule [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) left open ("how confidence is computed") · **Relates:** [008](008-source-schemas-are-upstream-mirrors.md) (upstream flags are parsed, not adopted), [054](054-certainty-is-the-asserters-status-is-ours.md) (certainty and status), [029](029-map-symbology.md) and [077](077-a-ring-shows-where-the-animal-may-have-been.md) (what the map's marks mean)

## Context

The map and the sidebar draw every sighting the same way, whether several people have agreed on what it was or only the person who reported it has. Peter asked that tentative ones, such as iNaturalist observations still marked "Needs ID", be shown differently.

075 decided that iNaturalist's quality grade is iNaturalist's verdict, made by its rules, and is not adopted as ours; our confidence is derived from the identifications we mirror. 008 says the same of Maplify's `trusted` flag: an upstream field may be read as an input to a concept of ours, never surfaced as our concept.

## Decision

**A sighting is either confirmed or unconfirmed.** "Unconfirmed" is our concept. Each source has its own rule for it, because each records agreement differently:

- **iNaturalist:** only other people's current identifications count; the observer's is the claim being checked. One of the species we show, or of a taxon within it, agrees, and one naming a different branch disagrees. The observation is confirmed when someone agrees and at least two thirds of those who take a side agree; disputed when someone disagrees and that isn't so; otherwise unconfirmed. An identification only to a broader group, such as "toothed whales", neither agrees nor disagrees. *(Amended twice on 2026-10-22; see "How the iNaturalist rule is applied" below. As first decided it read: ~~confirmed when someone other than the observer has a current identification of the species we show, or of a taxon within it, and no current identification names a different branch~~.)*
  - *Example:* someone posts a photo as a harbour porpoise and nobody else has looked. That's unconfirmed. A second person agrees, and it's confirmed. A second person suggests Dall's porpoise instead, and it's disputed. If two more then agree it's a harbour porpoise, three to one, it's confirmed, and the one who disagreed is still noted.
  - *Over the mirror on 2026-10-19:* of 88,818 observations, 82,337 are confirmed and 6,481 unconfirmed, 722 of those disputed. Of 2026's 16,303, 1,634 are unconfirmed, about 10%.
- **Maplify:** unconfirmed when Maplify doesn't mark the report trusted. Its `trusted` flag is an input here, as 008 allows, not the meaning of the word. That's 14,938 of 47,542 reports, and 2,672 of 2026's 8,472. The Darwin Core archive already takes only trusted reports, and still does.
- **Orcasound:** a bout whose species is tagged `possible` (054) is unconfirmed. A `possible` tag on a pod or an animal below the species keeps its trailing `?` and doesn't make the sighting unconfirmed.

Sightings entered on SalishSea.io itself, and HappyWhale's, are shown as confirmed for now; whether they should be is not decided here.

**How it looks.** On the map, an unconfirmed sighting is an outlined dot: a white centre with an edge in the species' colour, at the size of a confirmed dot. It is not a ring in 077's sense, which is a large faint area to the radius the animal may have been within. In the sidebar, its entry says "Unconfirmed", or "Disputed" for an iNaturalist observation whose identifications disagree. Profile pages list it marked the same way. Nothing is hidden.

## How the iNaturalist rule is applied

Writing the rule down as a query (`salish-bwma`, `scripts/read-path/derive/occurrences.sql`) needed three readings the text above leaves open:

- **The taxon we show** is the observation's species, or, for one identified only to a genus or above, that taxon itself. Someone's identification of a subspecies of it agrees.
- **The observer's own identification never disputes it.** When others agree on the species and only the observer names another, the community has overruled the observer, and the sighting is confirmed as what they agree on. Peter chose this on 2026-10-22: of 208 observations the first wording made disputed, 152 were disputed only by their observer, such as [409581771](https://www.inaturalist.org/observations/409581771), a humpback to three identifiers and a sperm whale to the person who saw it.
- **A disagreement that is outvoted doesn't stop a confirmation.** The first wording let any one other person's disagreement make a sighting disputed, and so unconfirmed. Peter judged that three people overruling one is a strong signal, here as on iNaturalist, and that our verdict on such a sighting should be the species they agree on, in what we publish and export as much as on the map; the disagreement is still a fact worth keeping. So the verdict needs two thirds of those who take a side, the share iNaturalist asks for its community identification, applied to the identifications we mirror and by our rule rather than adopted from its grade. In the mirror on 2026-10-22, 186 of the 188 observations the earlier wording made disputed had their dissent outvoted, most often three to one; [404645856](https://www.inaturalist.org/observations/404645856), a humpback to three people and the oceanic dolphins and porpoises to a fourth, is one.
- **An identification of a taxon the mirror doesn't hold** neither confirms nor disputes, because its place in the tree is unknown. The ingest fetches every such taxon on its next scheduled run, so this lasts a few minutes. On 2026-10-22 there were 24 such identifications by people other than the observer, among them a gull, a giraffe, and three subspecies of species we show.

How our judgment should be kept apart from the claims it judges, and named, is an open question in [087](087-our-judgment-is-separate-from-the-data.md). A sighting's document in the day files carries the result as `confirmation`: `confirmed`, `unconfirmed` or `disputed`; and, for an iNaturalist observation, `disagreements`, how many other people's identifications name another branch, which is null for a source without identifications. The sidebar notes a confirmed sighting's disagreements quietly ("1 identifier disagrees"); its dot is a confirmed one.

## Not decided here

- **A higher bar for surprising sightings.** Peter's direction for later: a sighting that is unusual where or when it was made, or of a rare species, might need more than one other person's agreement, or a curator's. That needs a notion of what is expected, which we don't have yet.
- **Reputation** (014). An identifier we trust might confirm a sighting alone, and a curator might confirm one directly (054's `status`). Neither exists yet.
- **Our own sightings and HappyWhale's**, as above.

## Rejected

- **iNaturalist's quality grade as the rule.** 075 rejected adopting it, and still does: this rule gives nearly the same answer, but it's ours to change.
- **Hiding unconfirmed sightings,** or hiding them by default. Most are right, and a sighting nobody has checked yet is still the first word that whales are about.
- **A faded dot.** Fading reads as "less important" or "longer ago", not "not yet checked", and a pale dot is hard to find against the depth tints.
- **The 077 ring.** That shape already means "the animal may have been anywhere in here".
