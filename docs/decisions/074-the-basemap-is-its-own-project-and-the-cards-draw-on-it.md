# 074 — The basemap is its own project, served from tiles.salishsea.io, and the preview cards are drawn on it

**Status:** accepted; amended 2026-10-13 (the AWS account) and 2026-10-14 (the map page switches first; then the image tiles) · **Decided:** 2026-10-08 · **Context:** `salish-3zok` · **Follows:** [068](068-the-map-stays-on-openlayers.md) (our own basemap, drawn by OpenLayers), [073](073-the-basemap-depths-are-30-m-lightly-shaded.md) (its depths) · **Amends:** [020](020-map-preview-cards.md) and [067](067-the-ecotype-page-compares-matrilines-with-small-maps.md), whose maps are Esri's tiles

## Context

068 committed us to a basemap of our own, and the prototype showed it can do better than Esri's ocean tiles: it holds detail past z14, where Esri's go blank. Two things widen what it is for.

**The preview cards should look like the site.** A card is the main way SalishSea.io shows up anywhere else, and the basemap is a quiet part of how the site looks, so a card drawn on someone else's map loses some of that. The basemap may not be distinctive enough for this to matter much; consistency is reason enough. The cards (020) and the small maps on the ecotype and individual pages (067) are both composited from Esri's 256-pixel image tiles today.

**orcasite should be able to use it.** Orcasound's site draws the same Esri ocean tiles, with Leaflet, and nobody is attached to that implementation. A basemap that only SalishSea.io's code can draw would be a fork waiting to happen.

## Decision

**The basemap is its own project, [`salish-sea/basemap`](https://github.com/salish-sea/basemap).** It holds the scripts that build the tiles, the style, and its own decision records; later decisions about sources, styling and coverage go there. SalishSea.io is one of its users, not its owner.

**It publishes two versions from one style:**

- **Vector tiles (PMTiles) and the style.** These are what interactive maps draw. They stay sharp at any zoom and can be restyled.
- **Image tiles rendered from that style** (256-pixel, down to about z12). These are for anything that stitches images together rather than drawing a map, starting with the preview cards and the small maps. They are rendered server-side, so labels and fonts may differ slightly from the live map's. The colours and depth shading, which are what carry the look, will be the same.

**orcasite gets SalishSea.io's map, not only its basemap.** orcasite draws Esri's ocean tiles with Leaflet today, and nobody is attached to that. What a listener choosing a hydrophone would gain is the recent sightings around it, so the likely shape is SalishSea.io's map made into a web component, with the basemap as one ingredient. That component would belong with SalishSea.io, not with the basemap. Its design is its own line of work and not settled here, nor is which renderer SalishSea.io's map uses: 068 chose OpenLayers before the map was in view for another site, and it is being re-examined.

**It is served from tiles.salishsea.io:** its own bucket and CloudFront distribution, with CORS so other sites can fetch from it, defined in the basemap repository's own CDK stack. ~~Which AWS account is open: SalishSea.io's infrastructure lives in Orcasound's account today (`648183724555`, the only account in its organization).~~ *Amended 2026-10-13:* it lives in Orcasound's AWS account (`648183724555`), beside the rest of SalishSea.io's infrastructure; Peter chose that on 2026-10-13 over a separate account for the basemap, which would have kept its costs apart from SalishSea.io's but needed an account, billing and credentials of its own. salishsea.io's content security policy adds that host. Each build's files sit under a versioned path, so a rebuild can't change what a published page shows halfway through a deploy.

*Amended 2026-10-14:* **the map page switched first**, to the vector tiles, before any image tiles exist. It draws a copy of one published version's style, with our sources and layers on top, and keeps to the area the basemap draws at every zoom: its detailed coast, 136–120°W and 36–54.8°N, which covers the killer whale range we take sightings from (the basemap's decision [011](https://github.com/salish-sea/basemap/blob/main/decisions/011-the-coast-covers-salishsea-ios-data.md)), inside a coarse map of the Northeast Pacific, 180–90°W and 15–70°N, so the map can zoom out to frame the whole range ([012](https://github.com/salish-sea/basemap/blob/main/decisions/012-a-coarse-map-covers-the-northeast-pacific.md)). Its fonts and icons come from tiles.salishsea.io too, so the content security policy names no other host for the map. The profile pages' maps (now pictures, [076](076-the-map-moves-to-maplibre.md)), the small maps and the cards still stitched Esri's image tiles together, until the amendment below.

**The preview cards and the small maps switch to the image tiles once they exist.** This amends 020's choice of Esri tiles and 067's use of them. Their attribution changes with them: OpenStreetMap, Protomaps, NOAA and NRCan in place of Esri's.

*Amended 2026-10-14:* **the image tiles exist, and the cards, the small maps and the profile pages' pictures all draw them** (`salish-3zok.16`). They are the map's style without its labels, in 256-pixel tiles drawn at 512, stored once under a name made from their contents; a published version's style names its set in its metadata, and `scripts/update-basemap.ts` copies that URL into the two places that stitch tiles, `src/profile-map.ts` and the card renderer. They reach zoom 10 everywhere the map does, and zooms 11 to 15 only along the Salish Sea's shore, where the haul-outs' pictures need them; drawing those zooms everywhere would take 207,000 tiles ([the basemap's decision 014](https://github.com/salish-sea/basemap/blob/main/decisions/014-image-tiles-are-drawn-from-the-style-along-the-shore.md)). Each credits OpenStreetMap, linked to its copyright page where the credit is on a web page, and the depth grids' publishers, NOAA, Natural Resources Canada and GEBCO; Protomaps asks for no credit of its own. A picture closer than zoom 10 lays that zoom's tiles under its own, so where a close tile is missing, as over a mooring buoy in open water, the coarser one shows through. Nothing SalishSea.io shows comes from Esri any more.

**What it is built from is published under the terms that come with it.** Anything derived from OpenStreetMap is offered under the ODbL, with attribution; NRCan's data carries the Open Government Licence – Canada; NOAA's is public domain.

## Rejected

- **The basemap as a directory in this repository, served at salishsea.io/basemap/.** It would work for us, but another site would then depend on our deploys and our origin, and the basemap's history would be mixed into ours.
- **Cards that stay on Esri while the site moves.** It's cheaper, but the cards are where consistency counts most.
- **Rendering the cards' maps from the vector tiles on demand**, inside the card renderer. That needs a GL renderer in a Lambda; image tiles rendered ahead of time are a change of tile address for a renderer that already composites tiles.
- **Image tiles only.** They would serve the cards and a Leaflet orcasite, but they blur past their last zoom, which is what we are leaving Esri over.
