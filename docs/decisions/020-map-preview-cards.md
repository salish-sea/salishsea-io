# 020 — Map-rendered link preview cards

**Status:** accepted (2026-07-27)
**Context:** GitHub issue [#38](https://github.com/salish-sea/salishsea-io/issues/38);
bd `salishsea-io-bym`. Amends [decision 019](019-no-fallback-preview-image.md).

Decision 019 removed a misleading site-wide preview image and left most shared
links with a text-only card. That was the honest state, not the desired one:
#38 has always asked for a rendered map of the sighting. This is that.

## Decision

**A shared link gets an image of where the sighting was**, rendered on demand at
`/cards/*` and named by the edge OG handler.

| Shared URL | `og:image` |
|---|---|
| `?o=<id>` with a `cc0`/`cc-by` photo | that photo (unchanged, decision 019) |
| `?o=<id>` without one | `/cards/o/<id>.jpg` — the sighting marked, zoom 9 |
| `?d=<date>`, no `o` | `/cards/day/<date>.jpg` — that day's sightings |
| neither | no image; text-only site card (unchanged) |

A photo of the animal still beats a map of its position, so the photo wins when
we have one. The map fills the roughly nine-in-ten sightings that have no
re-usable photo. Decision 019's principle is intact: the image is always *of the
thing shared* — there is still no generic stand-in.

### Basemap: real Esri tiles, not a coastline we draw

Settled by building both and looking at them
([comparison](https://claude.ai/code/artifact/972045b7-371e-4e59-8862-c4df5ade0cab)).
The prediction going in was that a real basemap would be visual mush at card size
and a drawn coastline would read better. The opposite was true. Esri's *World
Ocean Base* is already muted and chart-like, so the marker sits on it cleanly
while bathymetry gives the water texture. The drawn alternative (Natural Earth
10m) was passable at zoom 9, visibly faceted at zoom 11, and an empty blue
rectangle over open water — where a great many sightings are.

A second measurement independently killed the drawn-coastline idea: **54.4% of
the last 90 days' sightings fall outside the Salish Sea** (3,620 of 6,656).
Whale Alert and iNaturalist cover the whole coast, so any baked-in regional
asset is wrong for the majority of the data.

### Basemap sourcing and terms

**What the renderer does.** For each card it requests tiles from the same public
Esri endpoints the app's own maps use, composites them into a single image,
renders Esri's required attribution into that image, and serves it over our CDN.
Tiles are not redistributed as tiles, and nothing is packaged for offline use.

**Attribution.** *"Esri, Garmin, GEBCO, NOAA NGDC, and other contributors"* —
the service's own `copyrightText` — appears on every card, as the basemap's terms
require.

**The provision we considered.** The ArcGIS item for this layer
(`1e126e7520f9466c9ca28b8f28b5e500`) says: *"This layer is not intended to be used
to export tiles for offline. If you would like to export imagery for offline use
in ArcGIS applications, you may use the World Ocean Base (for Export) layer."*
That companion layer (item `5d85d897aee241f884158aa514954443`) requires an ArcGIS
Location Platform or Developer account and app credentials.

Read in context, that restriction addresses **exporting tile caches for offline
use in ArcGIS applications**, which is not what this renderer does: it fetches on
demand and serves attributed images online. On that reading the standard layer is
the appropriate one, and it is the layer the site already uses for its live maps.

**This is our own reading, not advice and not a ruling.** No legal review has been
done and Esri has not been asked. The honest summary is that the provision is
directed at a different activity and we believe our use is outside it — with the
residual uncertainty that comes from interpreting someone else's terms.

**What that buys us, practically.** The tile source is one constant
(`TILE_HOSTS` in `infra/lib/card-renderer/basemap.ts`). Moving to the companion
layer, or to a different basemap entirely, is a config change plus a credential.
If the cards attract meaningful traffic, or if a cheap answer from Esri is
available, take the account and remove the question rather than continue reasoning
about it.

### Day cards frame the region and count only what they show

A day card frames the Salish Sea rather than fitting its view to the day's
markers. Fitting is the obvious choice and the wrong one: with most sightings
outside the region, a day's set routinely spans California to Alaska, and fitting
yields a continent with specks on it.

Its caption therefore counts the markers **plotted**, never the number fetched. A
viewer can only see what is in frame; a caption counting dots outside it would be
a caption that lies about its own picture. A card that says "14 sightings" over
14 visible dots is honest even though 43 were reported that day worldwide.

### Rendering is a regional Lambda, not an edge function

The viewer-request function is capped at 128 MB and 5 s and forbidden
environment variables — no room for `sharp`, ~18 tile fetches and a second of
CPU. So `/cards/*` is its own CloudFront behaviour over a Lambda Function URL
(IAM + OAC, so it is unreachable except through the CDN). The edge handler only
*names* card URLs; the renderer fetches its own data, which keeps a card URL
cacheable by id alone.

A card that cannot be rendered returns **404, not a placeholder image** — the
crawler then falls back to a text-only card, which is decision 019's outcome and
better than a broken image.

## Consequences

- Occurrence cards are immutable (a past sighting never moves); today's day card
  carries a 15-minute TTL because it is still accumulating.
- The `/cards/*` behaviour has no edge function attached. Letting the OG handler
  intercept the images it just advertised is precisely the bug that once served
  an HTML body as an image; there is a test asserting it stays off.
- Profile pages (individual, matriline, ecotype) remain text-only. Plotting a
  subject's whole sighting history is a second data shape and can follow once
  this is proven.
- Honouring a shared `x/y/z` viewport is deferred — it multiplies cache keys for
  a rare kind of share.

## Rejected alternatives

- **Drawn coastline from bundled vector data.** Lost on looks and on coverage;
  see above.
- **Third-party static-map API** (Mapbox, MapTiler). Least code, but it puts a
  public API token in every shared card and a volatile external dependency in the
  most public surface the site has.
- **Headless Chromium screenshotting the real map component** — what #38
  originally proposed via `capture-website`. Pixel-perfect fidelity to the app,
  but ~200 MB of Chromium and multi-second cold starts to draw what is, in the
  end, a basemap and a dot.
- **Pre-rendering every occurrence.** 61,201 images for the handful ever shared.
  On-demand plus a long TTL costs nothing for cards nobody asks for.
