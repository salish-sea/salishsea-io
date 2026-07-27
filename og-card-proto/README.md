# Prototype — preview card renderers, A vs. D

**Throwaway code, kept as a primary source.** This branch is not merged and is not
maintained. It exists because it settled a design question for GitHub
[#38](https://github.com/salish-sea/salishsea-io/issues/38), and the rendered
output is the evidence.

## The question

Should a sighting preview card be drawn on **real basemap tiles (A)** or on a
**coastline we ship ourselves (D)**?

The going-in assumption was D: that a real basemap would be visual mush at card
size and a clean silhouette would read better small, with no tile fetching, no
API key, and no licensing question.

## The answer: A, clearly

Both renderers drew the same real sightings through the same view window, so the
only variable was the map underneath. See `out/`.

- **Zoom 9** — both are legible. A has noticeably more character.
- **Zoom 11** — D exposes Natural Earth 10m for what it is: faceted, polygonal
  islands. A still looks like a chart.
- **Open water** — D has nothing to draw; the Strait of Juan de Fuca is an empty
  blue rectangle with a dot in it. A still shows the channel.

A second finding killed D independently of looks: **54.4% of the last 90 days'
sightings fall outside the Salish Sea** (3,620 of 6,656). A baked regional
coastline is wrong for most of the data. `out/monterey-outlier-z9-*.jpg` is a
real sighting from 1,300 km away.

The decision, its rationale, and the Esri licensing position live in
[decision 020](https://github.com/salish-sea/salishsea-io/blob/main/docs/decisions/020-map-preview-cards.md).
The shipped renderer is `infra/lib/card-renderer/` on `main`.

## Running it

```sh
npm i sharp
# ne_land.json / ne_islands.json are Natural Earth 10m, not committed:
curl -o ne_land.json https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
curl -o ne_islands.json https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_minor_islands.geojson
node render.js        # writes out/<case>-z<zoom>-<A|D>.jpg
node build-page.js    # writes card-compare.html with the images inlined
```
