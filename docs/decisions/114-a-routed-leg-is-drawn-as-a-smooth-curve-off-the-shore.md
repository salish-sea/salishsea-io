# 114 — A routed leg is drawn as a smooth curve off the shore

**Status:** accepted; built · **Decided:** 2026-11-06, by Peter, from his question whether drawing the routes with Bézier curves would be crazy · **Work:** bd `salish-84y0`, draft PR #857 · **Amends:** [113](113-a-leg-that-crosses-land-is-drawn-along-the-water.md) (the points a `leg` holds) · **Relates:** [111](111-the-build-decides-a-days-travel-segments-and-the-day-file-carries-them.md)

## Context

[113](113-a-leg-that-crosses-land-is-drawn-along-the-water.md) draws a leg along the route by sea, and that route bends at the corners of the water map's 90 m cells, so it hugs the shore and shows cell-sized steps. Its Active Pass render also showed a track that went out and back through the pass drawing two slightly different lines, because the search finds a slightly different route depending on which end it starts from.

## Decision

**The route is found with the land grown by one cell**, so it keeps about 90 m off the shore. Where growing the land closes a pass one or two cells wide (Dodd Narrows, Sechelt Rapids) and no route is left within the limit, the plain route is used instead. The join's distance is unchanged: this changes only the path that is drawn.

**The leg's points are a smooth curve through the route's bends.** A centripetal Catmull-Rom spline through the bends, sampled every 100 m, is what the build writes as `leg`. Each piece of the curve is checked against the plain water map, and a stretch between two bends where a piece would cross land is drawn straight between those two bends instead.

**A pair is routed from its smaller end.** The two reports are ordered by longitude and then latitude, and the route from the smaller to the larger is reversed when the leg runs the other way, so either direction gives the same line.

**Legs in open water stay straight.** A straight chord between two observations says honestly that the path between them is unknown; a bend round a headland is knowledge, and only that is drawn.

## Rejected

- **Curving in the browser.** It has no water map ([111](111-the-build-decides-a-days-travel-segments-and-the-day-file-carries-them.md)), so it could not check a curve against land.
- **Sampling every 250 or 500 m.** Cheaper: on the five days measured, the files grow 10% and 5% over the days without legs, against 25% at 100 m. But the heaviest day on record, 2026-09-27 with 326 reports, is 458 KB raw and 28 KB gzipped as served, with only 4 routed legs, so the curves add a few KB where it matters least. Peter took the cost.
- **A shore cost in the search instead of growing the land.** Left for later.

## Consequences

- A leg is about 2.2 KB instead of 125 bytes. On the five days measured in 113 the files grow from 253,377 to 317,857 bytes (25%; 24,907 to 44,900 gzipped), and the busiest, 2024-05-07, by 52%.
- The arrows sit at the midpoint of the drawn curve, as 113 puts them at the midpoint of the drawn hop; the browser is unchanged.
- Two legs between different reports at nearly the same places can still differ by a cell.
- The one-cell passes get a smoothed plain route, which may touch the shore.
- Every day file is rewritten once when this ships.
