# 076 — The map moves to MapLibre GL, and the profile pages' map becomes a picture

**Status:** accepted · **Decided:** 2026-10-12 · **Context:** bd `salish-3zok.1`; the work is `salish-bt4r` (the map page and the form) and `salish-43kc` (the profile map) · **Supersedes:** [068](068-the-map-stays-on-openlayers.md) (the map stays on OpenLayers) · **Relates:** [029](029-map-symbology.md) (the symbology the port rebuilds), [057](057-profile-pages-are-prerendered.md) and [067](067-the-ecotype-page-compares-matrilines-with-small-maps.md) (prerendered pages and their static maps), [074](074-the-basemap-is-its-own-project-and-the-cards-draw-on-it.md) (our own basemap)

## Context

068 kept the map on OpenLayers because MapLibre GL looked about four times heavier and offered nothing OpenLayers lacked. Measurements taken two days later, on 2026-10-08, told a different story, and the decision was reopened (the numbers are in `salish-3zok.1`):

| | OpenLayers | MapLibre GL |
|---|---|---|
| Script, gzipped | 177 KB | 445 KB |
| First load of the map page on 4G | 3.8–4.3 s | 2.9 s |
| First load on slow 3G | 33 s | 29 s |
| Frames a second panning 5,000 points, processor slowed fourfold | 22 | 48 |

MapLibre is still the bigger download, but the map page loads faster with it, because MapLibre draws on the graphics processor and starts drawing tiles sooner. It also stays smooth with many points on a slow processor, where OpenLayers drops to 22 frames a second. On an iPhone 15 Pro, OpenLayers crashed the tab drawing 5,000 points at the phone's full pixel density; capping it at twice the density fixed that, but it shows where OpenLayers' canvas drawing runs out.

The other cost 068 counted was the rewrite. A trial port of the sighting form's map tools (placing, dragging and selecting points, the bearing line between observer and subject) passed all 33 of its checks in about 210 lines, against about 280 in OpenLayers. The whole port is estimated at a few days.

The plan was to run the benchmark on an older Android phone before deciding. The phone can't be found, and the next piece of map work, showing how certain a report's position is and letting someone enter that when they report a sighting (bd `salish-hb8k`), would otherwise be written for OpenLayers and then written again. Peter decided on 2026-10-12 to go ahead without the Android result.

## Decision

**The map page and the sighting form are drawn by MapLibre GL.** Every style becomes data: a style function that OpenLayers ran per feature becomes properties set once on each feature, read by declarative MapLibre layers. Selection and hovering become feature state. Specific choices:

- **Shared links keep working.** A permalink's `x`, `y` and `z` keep their meaning: EPSG:3857 metres, and OpenLayers' zoom number, which counts 256-pixel tiles where MapLibre counts 512-pixel ones and so runs one higher. The map converts where it reads and writes the URL, and nowhere else. Every zoom threshold in the code moves down by one when it is ported.
- **The basemap stays Esri's ocean tiles** until our own exists (074), drawn as a raster source of 256-pixel tiles. MapLibre fetches tiles with `fetch`, so the content security policy adds Esri's hosts to `connect-src`.
- **Text uses glyphs we serve ourselves**, Noto Sans in the ranges our labels use. MapLibre draws text from prebuilt glyph files, not the browser's fonts. Emoji and the direction arrow can't be drawn that way, so they are drawn once with the browser's canvas and added as images.
- **The boxed two-line labels of 029 are kept**, as text over a stretchable image fitted to it (`icon-text-fit`).
- **The editing tools are hand-written**, starting from the trial port. MapLibre has no equivalent of OpenLayers' `Select`, `Modify` or pointer interactions.
- **Circles measured in metres on the ground**, such as a haul-out site's radius or the "now at" estimate on a travel line, are drawn as polygons computed in longitude and latitude, as the haul-out ring already is. MapLibre's own circles are sized in screen pixels.
- **Labels now avoid one another across layers**, so a sighting's label and a viewing location's name no longer print over each other: the sighting's label wins, because MapLibre places the labels of the layers drawn on top first. OpenLayers kept labels apart only within a layer, which 068 listed as a reason to reopen.

**The profile pages' map becomes a static picture, prerendered with the page, as the ecotype page's small maps already are (067).** That map neither pans nor zooms: it shows where an animal or group has been reported, and a dot links to the main map. Its renderer is the only script a profile page loads (057), so moving it to MapLibre would put 445 KB on every profile page to draw a fixed picture. Drawn as SVG with Esri's tiles, as `src/small-multiples.ts` draws the small maps, it needs no script at all. Each picture still fits its own reports, and a haul-out's still shows the site's radius.

**Sequence:** the main map and the sighting form move first, in one change, with the map looking as it does today. The profile map becomes a picture next. `ol` leaves the dependencies when both are done. Showing how certain a position is comes after both.

## Rejected

- **Waiting for the Android test.** The phone is lost, and the measurements we have all point the same way. A phone too slow for MapLibre would struggle more with OpenLayers, which did worse on every slowed-processor run.
- **Staying on OpenLayers and capping the pixel density.** The cap stops the iPhone crash, but the slowed-processor runs still show OpenLayers struggling with many points.
- **MapLibre for the profile pages' map too.** One library everywhere is tidier, but it would put 445 KB on pages whose map does nothing a picture can't.
- **Keeping OpenLayers for the profile pages' map.** Two map libraries in the dependencies, one of them kept for a map that needs no library at all.
- **Moving the URL to MapLibre's zoom numbers.** It would make the code simpler at the boundary, but every link already shared would open one zoom level too far out.

## Consequences

- The map page downloads about 270 KB more script, gzipped. It still loads sooner, but the cost lands on every visit, including those that never look at a map.
- 074's plan to read our own basemap through `ol-pmtiles` and `ol-mapbox-style` changes: MapLibre reads PMTiles through the `pmtiles` package, and the style is MapLibre's own format, so no translation is needed.
- The trial port and the benchmark are kept outside the repository, at `~/.claude/projects/-Users-rainhead-dev-salishsea-io/maplibre-edit-spike` and `renderer-bench` on Peter's machine.
