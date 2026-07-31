# 022 — Regions filter the data, and the map outside them is shaded

**Status:** accepted
**Date:** 2026-07-31
**Issue:** bd `salish-yfd`, GitHub [#16](https://github.com/salish-sea/salishsea-io/issues/16)
**Follows:** [021](021-calendar-date-picker.md) (which added the calendar and the `occurrence_days` view this amends)

## Problem

The region bubbles added in #352 were pure navigation: clicking one moved the map and changed nothing else. Two things followed.

**Absence read as absence.** Pan past the edge of our ingest coverage and you see empty water. Nothing distinguishes "no whales were reported here" from "we carry no data here at all". For a site whose whole claim is to show how whales use these waters, that is a factual misrepresentation by omission — GitHub #16.

**A region was not a thing you could hold.** Pan away and the framing was gone. There was nothing to share, nothing in the URL, and no way to ask "what happened in Puget Sound" as a question about the data rather than about the viewport.

## Decision

A region is the **scope of the query**. Selecting one filters the occurrences the map draws, the sidebar lists, and the calendar counts; it persists across pan, zoom, day changes and reload; it lives in the URL as `?r=<slug>`; and the map outside it is shaded.

Six choices, in the order they were made.

### 1. The mask means "the region you selected", not "where coverage ends"

One concept, one mask. Picking a region both filters and shades.

*Rejected:* a permanent coverage mask derived from source/taxon extents, with a lighter region outline over it. Truer to #16's framing — coverage really is a property of ingest, not of user choice — but it means two overlapping shaded areas to design, caption and explain. *Also rejected:* shading the intersection of region and coverage, whose meaning shifts depending on which constraint binds, and so can't be captioned at all.

The accepted option has a real cost: with Salish Sea as the default we shade water where we do hold data. That is a lie of a different shape, and the "Everywhere" bubble (6) is what keeps it honest.

### 2. Regions are lon/lat rectangles

Reuse the `Extent` constants already in `src/constants.ts`. Exact, predictable, and ships without sourcing geodata.

*Cost, accepted:* a rectangle shaded over the Salish Sea is crude. It clips Puget Sound's southern end and includes Vancouver Island's interior.

*Rejected:* real polygons (Salish Sea water body, NOAA SRKW critical habitat) — better looking and semantically real, but needs sourcing, licensing, simplification, and a home. *Also rejected:* bbox filter with a polygon mask, which makes the shading and the filter disagree at the edges, so points appear inside shaded water.

### 3. The filter reaches the calendar, not just the map

Everything the sidebar shows must agree. A calendar counting sightings the map won't draw makes a day read "busy" and then click through to empty water — precisely the confusion this work exists to remove.

This forced the only schema change. `occurrence_days` (added in 021) was a view exposing `day` and `occurrence_count`; the bbox has to apply *before* the `GROUP BY`, so there was nothing for a client-side predicate to bite on. It is now a function taking a required date range and optional bounds. Null bounds `COALESCE` to whole-world limits so the planner sees one shape for every region.

The map and the observation list needed **no** migration. PostgREST addresses the `location` composite's fields with `->`, so a four-sided bbox is an ordinary filter on the occurrences view.

> `->` and not `->>`. The text form compares lexically, so numeric bounds silently match **nothing** — zero rows, no error. Verified against production data: `->` returned exactly the 38,275 rows `SELECT count(*)` gives for the same box; `->>` returned 0.

### 4. Every bubble filters

One control, one meaning. Picking San Juans hides a sighting off Victoria twenty miles away; acceptable because the mask makes the hiding visible.

*Rejected:* coarse regions filter while fine ones only navigate — two visually identical bubbles doing different things.

### 5. "Salish Sea" means `salishSeaExtent`, not the SRKW-clipped box

The bubble previously used `salishSRKWExtent` = `[-124, 47, -122, 49.5]`, chosen in #352 to frame "the water the sightings are actually in". Right for a viewport, wrong for a filter: as the **default** it silently drops the Strait of Georgia north of 49.5 and the whole western Strait of Juan de Fuca. A default that hides real data without saying so is the bug this feature exists to fix. The filter uses `salishSeaExtent` = `[-126, 47, -122, 50.5]`.

Filter bounds and zoom bounds are the same value for every region, and a test enforces it. If they diverged, a sighting could pass the filter and be counted by the calendar while sitting outside the viewport its own bubble moves you to.

### 6. There is an "Everywhere" escape hatch

Without it the widest region is the SRKW range `[-125.5, 36, -122, 54]` while ingest reaches `acartiaExtent` `[-136, 36, -120, 54]`, leaving real data permanently unreachable. "Everywhere" drops the filter and draws no mask. This is not hypothetical: on a single July day it surfaces 52 occurrences against the Salish Sea default's 28, from Haida Gwaii to San Francisco.

## Consequences

**Query cost went down.** Measured on production (61k occurrences):

| query | time |
|---|---|
| a month, no region | 169 ms |
| a month + Salish Sea bbox | 75 ms |
| Salish Sea bbox, **no day bound** | 3,448 ms |

The bbox cuts rows before they reach the occurrences view's nested-loop joins against taxa/providers/collections/organizations, which is where the time actually goes.

**No spatial index, deliberately.** `location` on the view is a computed composite — `row(ST_X(…), ST_Y(…))::lon_lat` — not a geography, so no index could apply to a predicate against it. And the Salish Sea box matches 62% of the corpus, where a seq scan wins anyway. Revisit if the corpus grows an order of magnitude, or if regions become polygons.

**The date bound is load-bearing.** Row three above is what a region query costs without one. `from_day`/`to_day` are required arguments precisely so there is no way to call the function without a range.

**Narrow regions read as quiet, permanently.** Day circles keep 021's fixed 120/day domain, so San Juans (79 sightings over the July grid) will always look sparse next to the Salish Sea (932). That is consistent with 021's reasoning — ink proportional to volume, not renormalised per view — and it is a true statement: the San Juans *are* quieter. Noted because it looks like a bug the first time you see it.

**Still open.** The `?o=` permalink can name an occurrence the active region excludes; today it is fetched and focused, and the mask shows it sitting outside. Whether that should widen the region, clear it, or stay as-is is not settled. Likewise, saving a sighting outside the active region leaves it invisible in the list — the contributor sees the map move to it, then loses it.
