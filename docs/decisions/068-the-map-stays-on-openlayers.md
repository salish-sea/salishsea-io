# 068 — The map stays on OpenLayers, and our own basemap will be drawn by it

**Status:** accepted · **Decided:** 2026-10-06 · **Relates:** [020](020-map-preview-cards.md) (the Esri basemap and why its bathymetry matters), [029](029-map-symbology.md) (the symbology a renderer swap would have to rebuild), [057](057-profile-pages-are-prerendered.md) (the profile page's map is its only script)

## Context

BeeAtlas draws its map with MapLibre GL over a basemap it builds and hosts itself ([BeeAtlas ADR 0026](https://github.com/rainhead/beeatlas/blob/029faa1e71d48e4e5b445ba8aabe32ff0fa6231b/docs/adr/0026-self-hosted-basemap.md)). Moving SalishSea.io to MapLibre too was considered, for two reasons: one map library across Peter's projects, so that what is learned in one carries over to the other, and the expectation that MapLibre would be lighter than OpenLayers.

It is not lighter. Measured on 2026-10-06:

| | gzipped |
|---|---|
| OpenLayers, every module we import, bundled whole (an upper bound; tree-shaking makes the real figure smaller) | ~105 KB |
| maplibre-gl 6.13, main bundle | ~285 KB |
| maplibre-gl 6.13, worker (a separate download) | ~143 KB |

That is about four times the bytes on the map page. The profile pages would feel it most, because their small map is the only script they load (057).

The swap would also be expensive. BeeAtlas came from mapbox-gl, whose API MapLibre shares. We would be coming from OpenLayers, which works differently throughout, and the scoping found about 1,800 lines across 13 files to rewrite. The costliest parts:

- Every style is a per-feature function, and would become precomputed properties read by declarative layers. MapLibre has no label backgrounds, so the boxed two-line segment labels of 029 would need a stretchable icon fitted to the text. It cannot draw emoji, so the sighter marker and the direction arrow would become images.
- The select, drag and place-a-point tools that the sighting form uses are built-in OpenLayers objects. MapLibre has none, so each would be hand-written.
- MapLibre's zoom z is OpenLayers' z+1, and permalinks carry EPSG:3857 metres. Every zoom threshold would shift, and the URL would need converting where it is read and written to keep shared links working.

And most of what would carry over from BeeAtlas is not about the renderer. What BeeAtlas learned the hard way is about running a self-hosted basemap: building the extract, serving it, vendoring fonts, loading the worker, working offline. Only the last two are MapLibre's.

## Decision

**The map stays on OpenLayers.**

**We want our own basemap, and OpenLayers will draw it.** The work is wanted but not yet scheduled (bd `salish-3zok`). When it is done, it follows BeeAtlas where BeeAtlas's lessons don't depend on the renderer. That means a Protomaps PMTiles extract we build and refresh ourselves, served from our own machine, with attribution carried by the sources rather than a hand-written string. OpenLayers reads the archive through [`ol-pmtiles`](https://github.com/protomaps/PMTiles) and applies a Protomaps style through [`ol-mapbox-style`](https://github.com/openlayers/ol-mapbox-style), both maintained by the projects that own the formats.

Three questions that work will have to settle, recorded here so they aren't rediscovered:

- **Bathymetry.** 020 chose Esri's ocean basemap because its depth shading keeps open water from reading as an empty blue rectangle, and a great many sightings are over open water. Protomaps has no bathymetry, so our basemap needs a depth layer from somewhere, and how well `ol-mapbox-style` renders whatever style that layer uses is to be checked, not assumed.
- **Extent.** Killer whales are in scope across their full range, central California to northern BC ([036](036-ingest-scope-killer-whales-range-wide.md)), and over half of recent sightings fall outside the Salish Sea (020). An extract of the Salish Sea alone would be wrong for most of the data.
- **The preview cards.** The card renderer composites Esri tiles on its own (020). Moving the app off Esri while the cards stay on it is allowed, but it should be decided rather than left behind.

## Rejected

- **Move to MapLibre now.** It costs four times the bytes and a rewrite of the map's symbology and editing tools. In return we would get a shared library whose main lessons don't depend on it.
- **Move to MapLibre as part of the basemap work.** It is tempting to do both at once, as BeeAtlas did. But the basemap doesn't need MapLibre, and combining them would make every regression ambiguous between the two changes.

## What would reopen this

A need OpenLayers cannot meet. The candidates seen so far:

- **Label collisions.** OpenLayers keeps labels apart only within a layer, so a sighting's label can still print over a hydrophone. Drawing the reference layers underneath the sightings works around this today (`src/obs-map.ts`).
- **Rendering speed.** Canvas drawing might become too slow at feature counts we don't have yet.
- **The basemap style.** Our basemap might need a style feature that `ol-mapbox-style` cannot render.
