# 088 — A dead animal is shown as dead, and is last seen when first found dead

**Status:** accepted · **Decided:** 2026-09-23 to 2026-10-23, by Peter · **Work:** bd `salish-1y8` · **Relates:** [029](029-map-symbology.md) (map symbology, amended for the bone), [063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md) (travel segments), [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) (an observation is evidence and identifications), [080](080-a-sighting-is-unconfirmed-until-someone-else-agrees.md) (confirmation, which is read the same way)

## Context

iNaturalist's observers and identifiers can annotate an observation "Alive or Dead". In the Salish Sea about 287 of 11,298 cetacean and 618 of 23,345 pinniped observations are annotated Dead (2026-09-23). We read none of it, so a whale skeleton on a beach was drawn on the map, joined into tracks and named on profile pages as an animal seen alive. [iNaturalist 409519682](https://www.inaturalist.org/observations/409519682), a humpback near Forks on 2026-10-16 whose only photo is the bones, was one.

## Decision

- **The annotation is read as iNaturalist reads it.** An annotation counts unless its votes' net score is negative. A sighting's `vitality` is what the highest-scoring counting annotation says: `dead`, `alive` or `undetermined` ("Cannot Be Determined", or two counting annotations disagreeing at the same score). With none, it is null, which is not "alive". Only iNaturalist carries it.
- **A dead animal is never part of a travel segment.** It is a segment of its own, and nothing joins it. A carcass is not part of a travelling group's path.
- **The map draws it as a bone** in its taxon's colour, and the sidebar says "Dead". How the bone looks is [029](029-map-symbology.md)'s amendment.
- **An individual found dead was last seen at its earliest record as dead.** A profile page's "Last reported" names that record, with "dead", even when the carcass is reported again later. Only a record that names the individual counts. A sighting of a matriline is a sighting of each of its living members, but a carcass is one animal, so a dead record that names only a matriline is linked to none of its members. Records of individuals found dead are expected to be rare.
- **Our own sighting form doesn't ask** whether the animal was alive (2026-10-23).
- **The mirror's history is backfilled** (2026-10-23), so observations from before the mirror kept annotations show their vitality too, rather than waiting for the anti-entropy window to reach them.

## Rejected

- **"Last reported" as the newest record, dead or alive.** Every later report of the same carcass would make the animal seen later.
- **Asking on our form, for now.** Peter judged there is no need for it at this time.

## Not decided here

- **Whether Maplify's stranding reports feed `vitality`.** They would need a rule of their own for recognising one.
- **Whether a dead record should also change an individual's life status in the catalogue.** That is the catalogue's to decide, not this derivation's.
