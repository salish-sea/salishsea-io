# 113 — A leg that crosses land is drawn along the water

**Status:** accepted · **Decided:** 2026-11-05, by Peter · **Work:** bd `salish-20u7.4` (epic `salish-20u7`, distance by sea) · **Amends:** [111](111-the-build-decides-a-days-travel-segments-and-the-day-file-carries-them.md) (the day file's rows may carry `leg`) and [056](056-the-logged-out-read-path-is-built-as-static-files.md) (the day file's paragraph) · **Relates:** [063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md), [`docs/research/distance-by-sea-for-tracks.md`](../research/distance-by-sea-for-tracks.md)

## Context

[063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md), amended, joins a report to a track by the distance by sea, up to 20 km, and [111](111-the-build-decides-a-days-travel-segments-and-the-day-file-carries-them.md) moved that join into the build, which writes each report's `segment` on the day file. The map still drew a track as straight lines between consecutive reports. A pair of reports 8.1 km apart in a straight line and 16.9 km apart by sea (2026-09-19) joins, because the sea route is within the limit, and is then drawn straight across the land between them. The join says the animals went round; the picture says they went over.

The route is already known to the build: [`seaDistance`](../../src/sea-distance.ts) returns, for a pair whose straight line crosses land, the path it measured, straightened by line of sight so that it bends only at headlands. The browser cannot find the route itself, because it has no water mask (111).

## Decision

**The build writes the route on the later report of each such leg, as `leg`.** For each segment's consecutive pair of reports, in the time order the join uses, [`withSegments`](../../scripts/read-path/occurrence-days.ts) asks `seaDistance` again (about a millisecond a pair). When the answer is a route around land and within the join's 20 km, the later report gets `leg`: `[[lon, lat], …]` from the earlier report to this one, rounded to 5 decimals (about a metre), with both ends included. The field comes after `segment`, the last key.

**Nothing is written otherwise.** A leg whose straight line stays in water, the first report of a segment, a pair with no route, a point outside the mask or too far from water, and a build run without `--water-mask` all write no `leg`.

**The browser draws the line through the route.** `segment2travelLine` in [`src/segments.ts`](../../src/segments.ts) puts each report's `leg` points, without its two ends, between the previous report and this one, so the line bends at headlands and still passes through every report at its own location. `travelArrows` puts one arrow on each hop as before, but at the middle of the hop's drawn length, turned along the piece of the route it sits on, not at the middle of the chord between the two reports. The line's `reportAt` property says which coordinates are reports, so the arrows can tell hops apart.

**What stays as it was.** The ring and the "now" position ([`imputedPositions`](../../src/segments.ts)) still use the last report and the species' speed. The join rule is unchanged. A signed-in tab's own unpublished sightings have no `leg` and draw straight (111).

## Rejected

- **The browser routes.** It would need the mask, which 111 rejected for every visitor, and would then compute a second answer for what the build already knows.
- **Smoothing the route into a curve.** The straightened route bends only where land forces it; a curve would cut corners across the land it is meant to avoid, or need its own check against the mask.
- **Writing every leg's path.** Most legs are straight and need no path; the files would grow for nothing, and a reader could not tell the legs that go round land from the others.

## Consequences

- Measured with the fixture mask on five real days (2026-09-19, 2026-09-09, 2024-05-07, 2025-01-30, 2025-07-14): 31 of 219 reports gain a `leg`, and the five files grow from 249,454 to 253,350 bytes in all, about 1.6%. The busiest, 2024-05-07, grows by 3.5% (16 of 57 reports); 2025-01-30 gains nothing. A leg is a few points: about 130 bytes.
- Every day file is rewritten once when this ships, as when 111 shipped.
- A signed-in tab's own sightings draw straight lines until the next build publishes them, at most five minutes later.
- The profile maps ([076](076-the-map-moves-to-maplibre.md)) still draw straight legs; they are not changed here.
