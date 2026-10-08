# 067 — The ecotype page compares its matrilines with a small map each

**Status:** accepted; built · **Decided:** 2026-10-06 · **Context:** GitHub [#624](https://github.com/salish-sea/salishsea-io/issues/624), bd `salish-7ta7` · **Amends:** [017](017-ecotype-profile-pages.md) (the page's matriline directory) · **Builds on:** [057](057-profile-pages-are-prerendered.md) (prerendered pages), [020](020-map-preview-cards.md) (the basemap and its terms) · *Amended 2026-10-08 by [074](074-the-basemap-is-its-own-project-and-the-cards-draw-on-it.md):* the small maps' basemap moves to image tiles rendered from our own basemap, as the cards' does; until then it is Esri's, as below

## Context

The Bigg's ecotype page pooled every Bigg's report into one map. It showed where Bigg's go, but not whether the T065As keep to different waters than the T099s. BeeAtlas answers the same question on its genus pages with one colour per species and the species list as the legend.

Colour doesn't work here. Seventy of the 132 Bigg's matrilines have been reported, and nobody can tell 70 colours apart. Bigg's also travel together: 28% of the reports that name a matriline name two or more, and a dot can't be two colours. A throwaway prototype on real data (screenshots on #624) compared a small map per matriline with six matrilines coloured on one map. On the coloured map the six blended through Puget Sound. On the small maps the differences showed at once: the T065As loop through Hood Canal, and the T123s range further north into the Gulf Islands.

## Decision

**Every reported matriline gets a small map of its own, every map at the same scale, in the page's Matrilines section.** That section follows the pooled Sightings section, which is about the ecotype as a whole, because seventy maps run long. The maps run most-reported first, and each links to its matriline's page, which has the interactive map. The matrilines never reported are listed after them by name. A report that names two matrilines is on both of their maps.

- **Each map draws exactly what its matriline's page does:** `group_occurrences`, deduplicated the same way. The ecotype page reads that relation for the first time, so its task in Stelis's graph takes it as an input.
- **One fixed extent, the Salish Sea from Tacoma to the Strait of Georgia** (124.3°W to 122.1°W, 47.05°N to 49.45°N; [`src/small-multiples.ts`](../../src/small-multiples.ts)). It holds 99% of located matriline reports. Fitting the extent to the data instead would let one report off the outer coast shrink every map. The reports outside aren't drawn, and the page says so.
- **Static SVG, prerendered with the page; no script.** The basemap is Esri's ocean tiles as `<image>`s, the layer and terms the interactive maps already use (decision 020): the reader's browser fetches them from Esri, as it does for any map here. Every map shares the extent and zoom, so the browser fetches the same dozen tiles once. Reports in the same two-unit cell become one circle, as dark as the overlapping dots would be. For Bigg's this makes the page 37 KB compressed, against 4.5 KB without the maps.
- **The page states what the maps can't show.** Reports cluster where people watch from, along shorelines and ferry routes, so the note under the heading says to compare the maps with each other rather than read any one as a range.

The client-rendered page, which now runs only in development, still lists the matrilines by name. Drawing the maps there would take a request per matriline.

## Rejected alternatives

- **A few matrilines in colour on the main map**, about six at a time with the rest grey. It shows only a handful at once, and the prototype showed even six blending. This is option 2 on #624, and it remains possible as a later "compare two" view.
- **An OpenLayers map per matriline**, as the prototype drew them. Seventy live maps cost a script and a canvas each, for maps nobody pans or zooms. A dot can't open its report either, since the small map's job is the overall pattern, and its matriline's page does the rest.
- **A coastline we draw ourselves**, as BeeAtlas does. Decision 020 compared drawn coastlines with Esri's tiles at card size and chose the tiles, and the small maps are about card size.
- **Counting reports that reach a matriline only through its members**, such as a report naming T065A2 alone, which the register places in the T065As ([050](050-matriline-membership-is-the-registers.md)). A matriline's page counts only reports that mention the matriline as a group, and the two would then disagree about the same matriline.

## Consequences

- When Southern Residents get profile pages (#511), the same maps can compare their pods, or the two ecotypes.
- Changing the extent changes every map at once. It's a constant, so moving it is a one-line change, with the share of reports inside it to recheck.
