# 073 — The basemap's depths are 30 m everywhere, shaded lightly

**Status:** accepted · **Decided:** 2026-10-08 · **Context:** `salish-3zok` (our own basemap; its notes hold the prototype's findings) · **Follows:** [068](068-the-map-stays-on-openlayers.md), which left bathymetry to this work

## Context

Our basemap draws depth two ways: vector depth bands and isobaths, cut from an elevation grid so they stay sharp at any zoom, and a shaded-relief image beneath them that fades out before it would blur. The prototype tried three grids in Haro Strait: GMRT (~40–60 m), NOAA's Coastal Relief Model (CRM, 30 m) and NOAA's CUDEM (10 m here, 3 m available).

The 10 m looked best: less harsh, less heavy. Measured over the same seafloor and averaged to the same display resolution, that was the rendering, not the detail. The same shading recipe gave the 30 m grid shadows about 40% stronger and highlights about 30% stronger, so it came out darker with about a third more contrast. Shaded at 70% of that strength, or with 2× vertical exaggeration instead of 3×, the 30 m measures and looks almost identical to the 10 m at z11 and z12.5. What the 10 m adds is crisper small reefs from about z12.5. Its tiles are 1.3–1.8× the size at z12–13, it needs a z14 level the 30 m doesn't, which makes about 4.5× the archive for the same area, and it is US-only.

## Decision

**One 30 m grid for the whole range, Monterey Bay to northern Vancouver Island,** for both the bands and the relief. All the NOAA grids are public domain, at 1 arc-second:

- NOAA's Southern California CRM v2 covers 31–37°N, which takes in southern Monterey Bay.
- CRM Volume 7 (2025) covers 37–44°N.
- CRM Volume 8 (2025) covers 44–49°N to 127°W, across the border in the Salish Sea.
- North of 49°N and west of 127°W, Natural Resources Canada's West Coast topo-bathy DEM is resampled from 10 m to 30 m. It is under the Open Government Licence – Canada.

The coastline comes from OpenStreetMap, not from any of these grids: their vertical datums differ.

**The relief is shaded lightly, and set in the style, not baked into the tiles.** The tiles hold a full-strength relief; the map draws it at about half opacity, and how much can vary by zoom. Tuning it is then a style edit, not a rebuild.

## Rejected, for now

- **10 m (CUDEM, and NRCan at full resolution) as the base.** It costs a z14 level and about 4.5× the archive per area. Most of what made it look better was lighter shading, which the 30 m now has. It may still come back where sighters zoom in closest, such as west San Juan Island and Haro Strait, if the reef detail turns out to matter; nothing here blocks adding it there.
- **GMRT.** It is coarser, shows swath artifacts, and is CC BY where the NOAA grids are public domain.
- **The Canadian Hydrographic Service's NONNA depths.** Its licence forbids passing the data on.
