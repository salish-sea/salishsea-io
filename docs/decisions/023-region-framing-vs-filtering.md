# 023 — A region's framing is not its filter

**Status:** accepted
**Date:** 2026-07-31
**Supersedes:** the "filter bounds and zoom bounds are the same value" rule in [022, decision 5](022-regions-filter-data.md)
**Issue:** bd `salish-yfd` (follow-up), PR #359

## Problem

[022](022-regions-filter-data.md) made a region the scope of the query and shaded the map outside it. Decision 5 widened the Salish Sea box from `salishSRKWExtent` `[-124, 47, -122, 49.5]` to `salishSeaExtent` `[-126, 47, -122, 50.5]`, because the narrow box silently dropped the Strait of Georgia north of 49.5 and the western Strait of Juan de Fuca. That was right, and still is.

Decision 5 then went further and required filter bounds and zoom bounds to be **the same value**, enforced by a test. The stated reason: if they diverged, a sighting could pass the filter and be counted by the calendar while sitting outside the viewport its own bubble moves you to.

That reasoning was wrong, and it broke two things.

**Every Salish Sea framing moved half a zoom level out.** The bubble is also what the map fits to, so widening the filter widened the view. #352 had chosen the tight box deliberately — "the water the sightings are actually in" — and a filtering decision silently overrode a framing one. Measured against a checkout of the pre-022 code, clicking the bubble:

| viewport | before | after 022 |
|---|---|---|
| 1440×900 | 8.32 | 7.82 |
| 1920×1080 | 8.6 | 8.1 |
| 2560×1440 | 9.03 | 8.53 |

Exactly −0.5 everywhere.

**Load stopped agreeing with click.** The initial zoom is hardcoded per breakpoint — `z=8`, or `z=7` when `window.innerWidth < 800` — and does not adapt to the actual viewport. The bubble, by contrast, fits the region to whatever size the map really is. On a large monitor that fit is *tighter* than the landing view, so clicking the already-selected region zoomed **in**. With the mask drawing the difference, **76.6% of a 2560×1440 screen was shaded on first load** (55.6% at 1920×1080). The map read as mostly disabled before the user touched anything.

## Decision

**`extent` is the filter. `zoomExtent` is the framing. They may differ.** Salish Sea filters on `salishSeaExtent` and frames on `salishSRKWExtent`.

**The app frames the active region on load**, not only when `?r=` names one. An explicit `x/y/z` still wins, as does `?o=`.

**A test enforces the safe direction: framing may be tighter than the filter, never wider.**

That asymmetry is the substance of this record. The original worry — data inside the filter but outside the viewport — is not a problem, because *the viewport was never a promise about what exists*. The mask is. Framing tighter means you start well inside what is being shown and pan outward through clear water before meeting the boundary. Framing wider means you land already looking at shaded area, which is the failure 022 actually shipped.

## Consequences

Framing is restored to pre-022 values at every size, and load and click now agree. Shading on first load:

| viewport | 022 | now |
|---|---|---|
| 1440×900 | 30% | 28.2% |
| 1920×1080 | 55.6% | 31.9% |
| 2560×1440 | **76.6%** | 32.8% |
| 390×844 | 34.8% | 21.2% |

What remains shaded is inland land east of -122 — Cascades, not water.

**The hardcoded landing zoom is still there**, and is the underlying oddity: `z=8`/`z=7` by breakpoint, blind to the actual viewport. Framing the region on load hides it for the default case, but any future landing view that is not region-derived will inherit the same blindness. Not fixed here.

**Only Salish Sea differs today.** Every other region frames on its own filter bounds. If a second one ever needs to diverge, the reason should be written down — the test permits it, which means nothing else will ask.

## Method note

The −0.5 figure and the shaded fractions were measured by checking out the pre-022 commit and the 022 commit into separate git worktrees, running each on its own dev server, and reading `View.getZoom()` and the visible extent from the live pages at four viewport sizes.

An earlier attempt compared the *current* build fed the old coordinates and called that "before". It is not: same mask code, different camera. It missed the −0.5 entirely and led to telling the reporter that nothing had changed. When a regression is about behaviour that changed between two commits, run both commits.
