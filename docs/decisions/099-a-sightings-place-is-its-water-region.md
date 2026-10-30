# 099 — A sighting's place is the water region its point is in, named by the build

**Status:** accepted · **Decided:** 2026-10-29, by Peter · **Work:** bd `salish-fwyt.2.2` (under `salish-fwyt.2`) · **Builds on:** [basemap decision 027](https://github.com/salish-sea/basemap/blob/4644c3d/decisions/027-every-water-name-has-a-region-and-the-regions-cover-the-water.md) (the water regions), [097](097-a-travel-segment-is-one-card-in-the-days-list.md) (a travel segment's card), [098](098-an-animals-timeline-is-months-of-encounters.md) (an animal's timeline)

## Context

A sighting carries only its coordinates, so a card couldn't say where it was. The sidebar mockup's cards had a line for it ("Haro Strait, off Lime Kiln"), and Peter asked for it on 27 October. A water body's label point can't answer "in Haro Strait": a big strait's label sits far from most sightings in it. So Peter asked for a layer built for the purpose, in which every point at sea falls in exactly one named region. That layer is the basemap's water regions, from version 2026.10.22: one region for each water name its map labels, covering the water from 42°N to 51.5°N, built from government data only. Each region carries its name as a card says it. A name used more than once gets a qualifier ("Mud Bay (Lopez Sound)"), and the open coast is "off Vancouver Island" or "off Oregon". The site shows the regions under the map's Water regions switch, so they can be reviewed in place.

## Decision

**A sighting's place is the name of the water region its point is in,** looked up once per sighting by the read-path build and written into its document as `place`. The point is where the animal was, not where it was seen from. A point in no region (on land beyond the 300 m the regions reach onto the shore, in fresh water, or outside 42–51.5°N) has a null place.

**The build fetches the regions list that the site's own style names** (`src/basemap-style.json`, from `scripts/update-basemap.ts`). So the pull request that moves the site to a new basemap version also moves every sighting's place. The list's URL is named for its contents, and the fetch refuses a download that doesn't match. Every arm of the derivation reads the list, so a new list re-derives them all.

**A report's card names its place under its title, bare:** "Haro Strait", or "off Oregon", which is why there is no "in". **A segment's card names where it began and ended:** "Haro Strait to Boundary Pass", or a single name when that's the same water. **An encounter's place is the one most of its reports were in;** a tie goes to the earliest. The timeline uses this place, and it replaces the timeline's stopgap, the nearest water label in the browser.

## Rejected

- **Looking places up in the browser:** every visitor would download the 6.6 MB list. The Darwin Core archive and anything else that reads the build's files would get nothing.
- **The nearest label point** (the timeline's stopgap): it says "Puget Sound" for much of the Main Basin, and it can't say a sighting is inside a strait whose label is far away.
- **"In" before the name:** it fails on "off Oregon", and the name reads clearly on its own.

## Undecided

- **Landmarks** ("off Bush Point", "near Suquamish"): within 3 km of 76% of sightings, but many are names few people know (Skiou Point). *Decided 2026-10-30 in [100](100-a-sightings-landmark-is-a-name-reporters-use.md):* the nearest name reporters use, written after the region ("Haro Strait, off Lime Kiln").
- **Darwin Core's `locality`:** the place belongs there, once the rights policy credits the regions' Canadian and British Columbian sources (`salish-fwyt.2.1`).
- **A sighting just saved** has no place until the next build, a few minutes later.

## Consequences

- The build has a `water-regions` task, which fetches the list into `/data/mirrors/water-regions.json`. The derivation takes it with `--regions` ([scripts/read-path/derive-occurrences.ts](../../scripts/read-path/derive-occurrences.ts), [scripts/read-path/water-regions.ts](../../scripts/read-path/water-regions.ts)).
- Postgres never had a place, so the comparison with its answers leaves `place` out ([scripts/read-path/compare-occurrences.ts](../../scripts/read-path/compare-occurrences.ts)).
- The glossary gains **Water region**.
