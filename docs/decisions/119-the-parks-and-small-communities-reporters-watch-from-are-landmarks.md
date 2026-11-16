# 119 — The parks and small communities reporters watch from are landmarks, placed from a list the search doesn't load

**Status:** accepted; amended the same day (a small community only fills a gap) · **Decided:** 2026-11-15, by Peter · **Work:** bd `salish-i1a.3.14` (this repo), `salish-i1a.3.16` (the basemap's list) · **Amends:** [100](100-a-sightings-landmark-is-a-name-reporters-use.md) (a landmark is a name reporters use) · **Relates to:** [117](117-sightings-from-a-facebook-group-arrive-when-a-signed-in-person-sends-the-days-post.md) (sightings from a Facebook group), [basemap decision 018](https://github.com/salish-sea/basemap/blob/90569a0/decisions/018-the-names-the-map-labels-are-published-as-lists.md) (the place lists)

## Context

Reports in Orca Network's Facebook group often say where the observer is standing: *I'm seeing the T137s from Boston Harbor*, *Viewing from constellation 1055*, *Just saw his blow directly out from stamm*. The site's two place lists, which the basemap publishes and the site's search loads, leave most of these places out. They keep cities, towns and villages but no smaller communities, and no parks or beaches (basemap decision 018). Of the 19 names that the Facebook demo (bd `salish-i1a.3.10`) couldn't place in the posts of 8–15 November, five were listed names written differently, such as *Alki Pt*; the reader now finds those. The other 14, along with names reporters write in lower case, are of two kinds:

- **Small communities**, which the US gazetteer (GNIS) records as populated places, in the public domain: Richmond Beach, Boston Harbor, Mabana, Eglon, Glendale on Whidbey, Greenbank, Pebble Beach.
- **Parks on the shore**, which OpenStreetMap records and the map already draws (basemap decision 016), under the ODbL: Stamm Overlook Park, Burfoot Park, Carkeek Park, Emma Schmitz Memorial Overlook, Zuanich Park. Constellation Park, named in five rows, is OpenStreetMap's *Charles Richey Senior Viewpoint*, with no other name recorded.

Adding every such place to the two lists would make the site's search download about 70 KB rather than about 31 KB, which is not acceptable (Peter, 2026-11-15). The search doesn't need them: only what reads a report's text does, which is the demo's server today and the build later (bd `salish-i1a.3.6`).

## Decision

**The parks and small communities that reporters name become rows of [`data/reference/landmarks.tsv`](../../data/reference/landmarks.tsv), proposed from the reports and reviewed as its other rows are (100).** Only names reporters have used are listed, so the list stays at tens of names, and a place is missing until someone has named it. A row's `name` is the official one, which places it; its `says` is what a card writes and what reporters call it, so the row for Charles Richey Senior Viewpoint says *Constellation Park*. The reader of report text finds a place by either.

**A small community's row carries its GNIS position,** as a gazetteer row does, because GNIS is in the public domain. Its source is `gnis`, not `gazetteers`, since it is not in the basemap's gazetteer list and is not checked against it.

**A park's row carries no position,** as an OpenStreetMap row doesn't, so that the file stays out of the ODbL. The build finds its position by name and kind in a third list that the basemap publishes beside the two: the named parks within about 500 m of salt water in the Salish Sea region. The style names that list in its metadata as it names the others, and the site's search never loads it; only the build and the demo read it. The basemap's side, and the amendment to its decision 018, is bd `salish-i1a.3.16`.

**A park counts as a landmark as a point of land does** (100): only within 0.5 km of the edge of the sighting's region. A card can then say "Puget Sound, off Lincoln Park". **A small community only fills a gap:** it is a card's landmark only when no other landmark is within reach, and then by distance alone. ~~A small community counts as a town does.~~ (Amended the same day, by Peter, after measuring 2026's 8,589 sightings: counted as towns are, communities gave 265 cards a landmark they lacked, such as "Saratoga Passage, off Mabana", but replaced a better-known one on 711, among them "Port Washington Narrows, off Bremerton", which became "off Sheridan Park" on 66 cards. Filling gaps only keeps the 265 and replaces none.) Emptying a row's `says` keeps it off cards, as for any row, but the reader of report text still finds the place by its `name`.

## Rejected

- **Adding the places to the two lists the search loads.** The search index would grow to about 70 KB.
- **The basemap publishing every shore park, and the reader using them all.** A reviewed list of the names reporters use is smaller, and a reviewer sees each one before it counts. The basemap's list does hold every shore park, but only so that our rows can be placed.
- **The basemap publishing positions for only the parks our list names.** Its build would read a file in this repo, and a new name would wait for a basemap version.
- **Parks placed by hand here,** from public-domain imagery or a park agency's address. Each would be placed by a person and checked against nothing.
- **Small communities counted as towns are:** they replace better-known names on 711 of 2026's cards (above).
- **A list of other names in the basemap,** such as *Constellation Park* for Charles Richey Senior Viewpoint. Basemap decision 018 turned that down for the search; a row's `says` serves the reader here.

## Consequences

- `scripts/read-path/landmarks.ts` accepts the source `gnis`, with a position, and names such a row only where no other landmark is within reach; it will place park rows from the third list. `scripts/update-basemap.ts` reports park rows that a basemap version no longer has a place for, as it does for OpenStreetMap rows.
- `scripts/propose-landmarks.ts` proposes parks and small communities from the Maplify reports and, once they are stored (117), from the Facebook group's.
- The demo's place finder (`tools/facebook-demo/places.mjs`) reads `landmarks.tsv` beside the two lists, so the parks and communities it lists are found by `name` or `says`, and reporters' short forms (*stamm*, *constellation*) as islands' are, by the name without its last word, after a word that places something.
- Until the basemap's third list exists, park rows can't be placed, and only the small communities can be added.
