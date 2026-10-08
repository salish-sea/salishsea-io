# 074 — The basemap is its own project, served from tiles.salishsea.io, and the preview cards follow it

**Status:** accepted · **Decided:** 2026-10-08 · **Context:** `salish-3zok` · **Follows:** [068](068-the-map-stays-on-openlayers.md) (our own basemap, drawn by OpenLayers), [073](073-the-basemap-depths-are-30-m-lightly-shaded.md) (its depths) · **Amends:** [020](020-map-preview-cards.md) and [067](067-the-ecotype-page-compares-matrilines-with-small-maps.md), whose maps are Esri's tiles

## Context

068 committed us to a basemap of our own, and the prototype showed it can do better than Esri's ocean tiles: it holds detail past z14, where Esri's go blank. Two things widen what it is for.

**The preview cards should look like the site.** A card is the main way SalishSea.io shows up anywhere else, and the basemap is a quiet part of how the site looks, so a card drawn on someone else's map loses some of that. The basemap may not be distinctive enough for this to matter much; consistency is reason enough. The cards (020) and the small maps on the ecotype and individual pages (067) are both composited from Esri's 256-pixel image tiles today.

**orcasite should be able to use it.** Orcasound's site draws the same Esri ocean tiles, with Leaflet, and nobody is attached to that implementation. A basemap that only SalishSea.io's code can draw would be a fork waiting to happen.

## Decision

**The basemap is its own project, in its own repository in the `salish-sea` organization.** It holds the scripts that build the tiles, the style, the package that draws them, and its own decision records; later decisions about sources, styling and coverage go there. SalishSea.io is one of its users, not its owner.

**It publishes two versions from one style:**

- **Vector tiles (PMTiles) and the style.** These are what interactive maps draw. They stay sharp at any zoom and can be restyled. SalishSea.io's maps draw them with OpenLayers (068), and orcasite can draw them with whatever it moves to.
- **Image tiles rendered from that style** (256-pixel, down to about z12). These are for anything that stitches images together rather than drawing a map, starting with the preview cards and the small maps. They are rendered server-side, so labels and fonts may differ slightly from the live map's. The colours and depth shading, which are what carry the look, will be the same.

**It publishes a web component for using it,** an npm package from the same repository:

- **A map element** that draws the basemap and takes data layers on top. A site that just wants the map uses this, without having to know about OpenLayers. orcasite is the first such site, whatever its map is now: React handles custom elements.
- **The layers on their own**, as a function returning OpenLayers layers, for a site that already has an OpenLayers map with its own controls. SalishSea.io uses this: its map carries the sighting symbols, the editing tools and the mask, and wrapping that map inside someone else's element would get in the way. The element is built on the same function, so the two can't drift apart.

Each release of the package names the tile build it reads, so one version number covers both the code and the tiles.

**It is served from tiles.salishsea.io:** its own bucket and CloudFront distribution, with CORS so other sites can fetch from it, defined in the basemap repository's own CDK stack in the same AWS account. salishsea.io's content security policy adds that host. The basemap's raster and vector files sit under one versioned path, so a rebuild can't change what a published page shows halfway through a deploy.

**The preview cards and the small maps switch to the image tiles once they exist.** This amends 020's choice of Esri tiles and 067's use of them. Their attribution changes with them: OpenStreetMap, Protomaps, NOAA and NRCan in place of Esri's.

**What it is built from is published under the terms that come with it.** Anything derived from OpenStreetMap is offered under the ODbL, with attribution; NRCan's data carries the Open Government Licence – Canada; NOAA's is public domain.

## Rejected

- **The basemap as a directory in this repository, served at salishsea.io/basemap/.** It would work for us, but another site would then depend on our deploys and our origin, and the basemap's history would be mixed into ours.
- **Cards that stay on Esri while the site moves.** It's cheaper, but the cards are where consistency counts most.
- **Rendering the cards' maps from the vector tiles on demand**, inside the card renderer. That needs a GL renderer in a Lambda; image tiles rendered ahead of time are a change of tile address for a renderer that already composites tiles.
- **Only the element, with SalishSea.io's map moved inside it.** Our map's tools would then live in someone else's component, or the component would grow an interface for every one of them.
- **Image tiles only.** They would serve the cards and a Leaflet orcasite, but they blur past their last zoom, which is what we are leaving Esri over.
