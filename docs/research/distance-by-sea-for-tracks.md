# Measuring distance by sea, for joining reports into tracks and drawing them through water

**Research date:** 2026-11-04 · **Author:** research agent (AI-assisted), for Peter Abrahamsen · **Status:** background/reference; informs the distance-by-sea epic and its children, and [decision 063](../decisions/063-segments-join-by-space-and-time-and-never-across-ecotypes.md)'s open item on routing around land

## Why

On 14 July 2025 the map draws a track through the middle of Saltspring Island ([the day](https://salishsea.io/?d=2025-07-14&o=inaturalist%3A303486024&x=-13728665&y=6262934&z=11)). A Whale Alert report in Trincomali Channel at 19:09 UTC joins the T69s at Maple Bay, in Sansum Narrows, at 20:32. The two points are about 13 km apart in a straight line and about 40 km apart by sea, because Saltspring Island lies between them. Decision 063 measures distance in a straight line, so the join passes its speed check (three times the species' speed, after a 3 km allowance, against 6.8 km/h for killer whales): 10 km in 83 minutes is about 7 km/h. By sea it is about 27 km/h, and the same check refuses it. The straight-line distance also decides which of two tracks a report joins, which Scott expects a distance by sea to get right more often (063, "Open"), and the half-hour ring around a track's last report should be clipped to water and measured along it (decision 103, `salish-2adm`). GitHub [#445](https://github.com/salish-sea/salishsea-io/issues/445) collects the tracks that go wrong.

A distance by sea is never shorter than the straight line, and equals it whenever the straight line stays in water. So the expensive work is needed only for the pairs of reports with land between them.

"Verified" below means the source's own page or code was read. "Search summary" means it was seen only in a search result.

## The short answer

- **The basemap already does most of this.** For its water regions ([basemap decision 027](https://github.com/salish-sea/basemap/blob/main/decisions/027-every-water-name-has-a-region-and-the-regions-cover-the-water.md)), [`scripts/regions.py`](https://github.com/salish-sea/basemap/blob/main/scripts/regions.py) builds a grid of water at about 90 m over 42–51.5°N and east of 129°W, and every unclaimed cell joins the nearest named seed "a ring at a time through the water", which is a breadth-first search over that grid. Started from one report, the same loop gives the distance by sea to every cell; started from two, the path between them. The grid is never published. The published regions list reaches 300 m onto the shore, so it would let a route cross a spit or any isthmus under 600 m, and it is 6.6 MB with 210,000 vertices; it is not a water mask. (Verified: the basemap's code, decision and Makefile, and the list downloaded 2026-11-04.)
- **OpenStreetMap's land is open to this use.** Decision 027 kept OpenStreetMap out of the regions because a region's name goes into the Darwin Core archive, and an ODbL name could make the archive a derivative database. Sea distances and track paths live in the day files; nothing from the tracks reaches the archive. The basemap's build already holds the OpenStreetMap extracts and the 30 m depth mosaic, so a mask could come from either or both: the coastline for the shore, the depth grid for the ground that dries at low tide, which decision 027 counts as water because humpbacks forage over the flats.
- **No published grid is finer or more open than what the basemap has** (next section).
- **A grid search is the fit; a visibility graph is not, yet.** The marine telemetry world reroutes tracks around land with visibility graphs (`pathroutr`, below), which are exact and smooth but grow with the number of coastline vertices; the one JavaScript library took about 20 seconds for 4,400 vertices, and our coast has 210,000 even smoothed to 90 m. A breadth-first or A* search over a bitmask is about sixty lines with no dependency. An any-angle variant (Theta*) gives legs that bend at headlands instead of following grid steps.

## Grids that already exist

- **The basemap's water grid** (above): depth grid below zero plus drying ground, less land as NOAA's charts and British Columbia's terrestrial boundary draw it, keeping only water connected to the open sea. Known limits from decision 027: a channel narrower than a cell is land, and a bay whose mouth is narrower than a cell is cut off. Dodd Narrows and Pole Pass, which Bigg's killer whales use, are near 90 m wide, so a mask built for routing wants checking there, and its sources allow 30 m. Verified.
- **Washington Ecology's Marine Bathymetry Mosaic (1999)**, funded by the Puget Sound Ambient Monitoring Program, PSEMP's predecessor: a 20 m depth grid over Washington's marine waters and southern Vancouver Island, interpolated from old soundings; licence "unknown", no datum stated. The basemap's 30 m mosaic of NOAA's and Canada's current grids is newer and covers the whole Salish Sea. [Listing](https://opennetzero.org/the-washington-state-department-of-ecology/marine-bathymetry-mosaic-1999-zipped-fgdb), verified.
- **The Whale Museum's 445 quadrants**, republished by NOAA: squares clipped to the shore for counting sighting days, not a water mask. See [How monitoring programs divide the Salish Sea](salish-sea-subregions-in-monitoring.md).
- **SalishSeaCast's NEMO grid** (UBC): 398 by 898 cells, about 500 m, from Juan de Fuca Strait to Johnstone Strait, Apache 2.0 for v21-08. Too coarse for Active Pass or Dodd Narrows, and a model widens channels to keep them open. [ERDDAP entry](https://salishsea.eos.ubc.ca/erddap/info/ubcSSnBathymetryV21-08/index.html), verified.
- **NOAA's Salish Sea and Columbia River Operational Forecast System and PNNL's Salish Sea Model** run FVCOM meshes of 100 to 500 m cells in Puget Sound, up to 10 km on the shelf. Neither publishes the mesh files, only model output. [SSCOFS](https://tidesandcurrents.noaa.gov/ofs/sscofs/sscofs_info.html), [PNNL](https://www.pnnl.gov/projects/salish-sea-model/hydrodynamics), search summary.
- **Other land and water data.** OpenStreetMap's [land polygons](https://osmdata.openstreetmap.de/data/land-polygons.html) are the finest coastline, under the ODbL. GSHHG (LGPL, 2017) and Natural Earth (public domain) are coarser. NOAA's Puget Sound 1/3 arc-second DEM and the Canadian Hydrographic Service's NONNA-10 are the sources the basemap already stitches. Verified by the research agent.

## Methods

- **Grid search.** Breadth-first search gives a distance field from one source, which the ring needs; A* gives one shortest path, bounded here by decision 063's 20 km limit so each search covers a small patch. Paths follow grid directions unless an any-angle variant is used: Theta* and Lazy Theta* add a line-of-sight shortcut and give near-straight legs that bend at headlands ([Daniel, Nash, Koenig and Felner, JAIR 39, 2010](https://arxiv.org/pdf/1401.3843v1.pdf), verified). Making cells beside the shore slightly dearer keeps a path in mid-channel. The usual pitfall of a raster is losing a narrow pass; cells of 100 m or finer keep the passes whales use.
- **Visibility graph over the land polygons' vertices.** Exact in the plane and smooth; the shortest path bends only at vertices. It is the method of the R package [`pathroutr`](https://github.com/jmlondon/pathroutr) (NOAA Marine Mammal Laboratory), which reroutes seal and whale telemetry tracks around land, and of [`aniMotum`](https://ianjonsen.github.io/aniMotum/articles/Path_rerouting.html)'s `route_path()`, which wraps it. Both are R-only. Pitfalls: paths graze the coast unless the polygons are inflated, and thousands of islets make the graph huge. The one JavaScript library, [`visibility-graph.js`](https://github.com/rowanwins/visibility-graph) (MIT), reports about 20 seconds to build a graph of 4,400 vertices. Verified.
- **Least cost over bathymetry**, as R's [`marmap::lc.dist`](https://rdrr.io/cran/marmap/man/lc.dist.html) does: the grid search with a depth cost. Worth it only if shallows should repel routes. Verified.
- **Shipping-lane graphs.** Python's [`searoute`](https://github.com/genthalili/searoute-py) and [`scgraph`](https://github.com/connor-makowski/scgraph) route over global lane networks and are far too coarse for the Gulf Islands. Verified.
- **JavaScript libraries.** [`ngraph.path`](https://github.com/anvaka/ngraph.path) (MIT) does A* over a graph; no JavaScript library does geodesic fast marching or a distance transform. The project already depends on `@turf/distance` for the straight line. Verified.

## Prior art

No whale-sighting site found routes its tracks around land. Ocean Wise's WhaleReport, the Orca Behavior Institute's maps and Whale Alert draw points. Routing appears only in telemetry post-processing, through the R packages above. Search summary; absence of evidence only.

## Recommended plan

1. **Measure.** Test every published track leg against land over the days since 2022, with [`scripts/segments/compare.ts`](../../scripts/segments/compare.ts), to learn how many legs cross land and where.
2. **The basemap publishes a water mask**, before the regions' 300 m skirt, as a one-bit raster named for its contents beside the place lists (as [basemap decision 018](https://github.com/salish-sea/basemap/blob/main/decisions/018-the-names-the-map-labels-are-published-as-lists.md) names them), from OpenStreetMap's coastline, the depth grid, or both. Over the Salish Sea alone (125.5–122°W, 47–50.5°N) at 90 m that is about 12 million cells, 1.5 MB raw and a few hundred KB compressed; at 30 m, nine times that.
3. **A sea-distance module in the read-path build**: unchanged when the straight line stays in water, otherwise A* within the 20 km limit; a report placed on shore is moved to the nearest water cell first.
4. **The join rule measures by sea**, and decision 063 is amended. The code is a line; the work is reading the days whose tracks change, against Scott's annotated days, which `salish-71m7` also waits on.
5. **Legs that cross land are drawn along the water**, written into the day files, so the browser stays as it is.
6. **Where the browser's own join runs.** A signed-in tab joins its unpublished sightings in the browser today. Either the browser loads the mask, or those draw straight until the next build. A decision record.
7. **The half-hour ring is clipped to water** (`salish-2adm`), from the same distance field.

## Unverified

- The 13 km and 40 km figures for the Saltspring leg are read off the map, not computed.
- Whether Dodd Narrows and Pole Pass survive in the basemap's 90 m grid.
- The widths given for Porlier Pass (about 300 m) and Active Pass (about 500 m).
- The claim that no sightings site routes tracks around land rests on what the research agent could find.
