# 100 — A sighting's landmark is the nearest name reporters use, on its region's shore

**Status:** accepted · **Decided:** 2026-10-30, by Peter · **Work:** bd `salish-fwyt.2.3` (under `salish-fwyt.2`) · **Builds on:** [099](099-a-sightings-place-is-its-water-region.md) (a sighting's place is its water region), [basemap decision 018](https://github.com/salish-sea/basemap/blob/90569a0/decisions/018-the-names-the-map-labels-are-published-as-lists.md) (the place lists)

## Context

099 gave each sighting the water region it was in, such as "Haro Strait", and left landmarks undecided. The sidebar mockup's card says "Haro Strait, off Lime Kiln": the region says which water, and the landmark says where in it. The basemap's place lists hold about 1,400 names on land near the water (points, islands, towns, villages and ferry landings), and most sightings are within 3 km of one. But many of those names are ones few people know, such as Skiou Point, and some are the names of piers rather than places.

We measured three rules against the 7,448 Maplify sightings of 2026 in the Salish Sea. 425 of their reports name a listed place within 15 km of the sighting, which says both which names reporters use and which name a reporter gave a sighting. To keep the third rule from being graded on the reports that chose its names, its names came from January–June reports and it was scored on July–October's.

| Rule | Sightings with a landmark | Picks the reporter's own name |
|---|---|---|
| The nearest listed name within 3 km | 78% | 43% |
| Only names the basemap labels from zoom 11 or earlier, within 5 km | 68% | 31% |
| Only names reporters have used, within 5 km | 64% | 57% |

The nearest name gives sightings in False Creek "off Granville Island Dock (False Creek Ferries)", and more than half of its picks are names no reporter has used. The basemap's label zoom measures how much open water lies off a point, not how well known it is, and Lime Kiln Point is labelled only from zoom 12.

A landmark should narrow the region down, so it should be on that region's shore. The nearest name within 5 km sometimes isn't: Restoration Point faces the main basin, 3 km from the Rich Passage sightings it was picked for. A point of land or a ferry landing sits on the shore, so the build can check it against the region's outline. A town or an island has only a point near its middle in the lists (Vashon Island's is inland), so it can't be checked. Leaving towns and islands out to keep the check cut the share of sightings with a landmark from 61% to 43%, and the share given the reporter's name from 55% to 34%, because reporters place whales by towns and islands as often as by points.

## Decision

**A sighting's landmark is the nearest name reporters use, within 5 km of its point,** looked up by the read-path build and written into its document as `landmark`. A point of land or a ferry landing counts only if it is within 0.5 km of the edge of the sighting's region (the regions already reach 300 m onto the land). A town, village, city or island counts by distance alone. A sighting with no region has no landmark, since a landmark narrows a region.

**The names are a list checked into the repo, [`data/reference/landmarks.tsv`](../../data/reference/landmarks.tsv), which a script proposes from the reports and a pull request reviews** ([scripts/propose-landmarks.ts](../../scripts/propose-landmarks.ts)). A name is proposed once a report within 15 km of the place names it. A shortened name, such as "Lime Kiln" for Lime Kiln Point or "Alki" for Alki Point, counts only after a word that places something (*off*, *near*, *at*, *from*, *past*, *rounding*, *between* and the like), so that a reporter called Sandy doesn't count for Sandy Point. Each row says what a card writes, which the review can change. **A card writes the official name, "Point" and all** ("off Lime Kiln Point", not the mockup's "off Lime Kiln"; Peter, 2026-10-30): it is the name the map labels, and nobody has to choose a short form for each place. A ferry landing is the exception, proposed under its town's name ("Mukilteo", not "Mukilteo Ferry Terminal"). A row whose card text is empty is never a landmark, and a refresh keeps it so.

**A gazetteer row carries its position, and an OpenStreetMap row doesn't.** The gazetteers' names are in the public domain or under the Open Government Licence – Canada. OpenStreetMap's are under the ODbL, which [074](074-the-basemap-is-its-own-project-and-the-cards-draw-on-it.md) keeps apart from the rest. So the build fetches the OpenStreetMap list the style names, as it fetches the regions, and finds each such row's place by its name and kind. The gazetteers' list has 47 names shared by more than one place (there are five Sandy Points), and a row's position says which is meant. The OpenStreetMap list has three, such as the two Stuart Islands, which are far enough apart that distance chooses.

**A report's card writes the landmark after the region, with "off":** "Haro Strait, off Lime Kiln Point", "Sinclair Inlet, off Bremerton". "Off" reads right for a point, an island and a town on the water alike. A segment's card and an encounter keep 099's regions alone.

**The landmark needs no qualifier.** A region's name already tells namesakes apart by the larger water around it, as "Mud Bay (Lopez Sound)" does, and the landmark is read beside its region. So "Saratoga Passage, off Sandy Point" can mean only one Sandy Point. The two kinds of second name go in opposite directions: the parentheses say which one, and "off" says where in it.

## Rejected

- **The nearest listed name:** names nobody uses, and agrees with reporters least often among the rules that cover most sightings.
- **The basemap's label zoom as a measure of how well known a name is:** it measures the open water off a point. It drops Lime Kiln Point and keeps names such as Green Point and Neill Point that no report uses.
- **Choosing the names from the reports at build time:** the landmarks would move whenever a report came in, with nobody looking. The checked-in list changes only by a reviewed pull request, as the catalogue does (064).
- **Only points and ferry landings, which can all be checked against the region:** loses a third of the landmarks and most of the agreement with reporters.
- **Positions for the OpenStreetMap rows in the repo:** the list would be a work derived from OpenStreetMap, under the ODbL, in a repo that keeps that licence apart.

## Undecided

- **Wording for a sighting far from any name reporters use.** It has its region alone (Peter, 2026-10-30: no idea yet).
- **Darwin Core's `locality`:** as for the region (099), once the rights policy credits the sources (`salish-fwyt.2.1`). An OpenStreetMap name there would bring the ODbL's terms with it. *Settled 2026-10-31 (rights policy §7.4, D-25): the archive's `locality` is the region alone, and the landmark stays out of the archive.*
- **Canadian waters have fewer landmarks:** most reports that name places come from Orca Network's observers around Puget Sound.

## Consequences

- The build's `water-regions` task fetches the OpenStreetMap place list as well as the regions; the derivation takes both, and `data/reference/landmarks.tsv`, with `--landmarks` ([scripts/read-path/landmarks.ts](../../scripts/read-path/landmarks.ts)).
- Refreshing the list needs a copy of the Maplify mirror; [the runbook](../runbook/read-path-build.md) says how to take one.
- A basemap version that renames or moves a listed place leaves its row unmatched. `scripts/update-basemap.ts` reports such rows, so the pull request that moves the site to that version fixes them.
