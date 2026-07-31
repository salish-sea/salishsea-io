# 021 — Calendar date picker with sighting-volume circles

**Status:** accepted (2026-07-30)
**Context:** bd `salish-dq2`.

The sidebar picked the observation date with `<input type="date">` plus ◀/▶ day
buttons. It said nothing about *when there is anything to look at*: a visitor
stepping back through days had no way to tell a blank day from a busy one
without landing on it, and no sense of the season at all.

## Decision

**The sidebar renders a month calendar, and each day carries a circle whose
area is proportional to that day's sighting count.** The date input is gone; the
day-stepping buttons stay, now labelled with the selected date in longhand
(`Fri, Jul 3, 2026`), which is the readable date the input used to provide.

`<date-calendar>` ([src/date-calendar.ts](../../src/date-calendar.ts)) emits the
same `date-selected` event as the day buttons and the sighting form, so nothing
above it changed. The grid arithmetic and the volume encoding are in
[src/calendar.ts](../../src/calendar.ts), apart from the component and tested
without a DOM.

### Counts come from a live view, not the matview

> **Amended by [022](022-regions-filter-data.md).** `occurrence_days` is no
> longer a view. Regions filter the calendar's counts too, and the bounding box
> has to apply before the `GROUP BY`, so it is now a function taking a required
> date range and optional lon/lat bounds. Everything below about *why* the
> counts are read live rather than off the matview still holds; only the shape
> of the object changed.

`public.occurrence_days` groups `public.occurrences` by the PST8PDT calendar
day — the same day boundary as `?d=`, `fetchOccurrences`, and
`dateFromObservedAt`, so a day's circle counts exactly the records the map draws
for that day.

`public.occurrences` is a 4-way UNION and `public.occurrence_index` (decision
017's matview) would answer the same question in ~7ms instead of ~120ms. We read
live anyway: the matview lags ingest by up to ~6 minutes, and the calendar sits
directly above the form where a contributor adds a sighting. Their own day's
circle has to grow the moment they save it — that feedback is the point of bd
`salish-i1a.2` (making the sighter's contribution visible), and 120ms for a
control paged by hand is not a cost worth trading it for.

Clients filter on `day`; Postgres pushes that predicate down through the
`GROUP BY` into each UNION branch, so cost scales with the month rather than the
corpus.

### It borrows the presence table's vocabulary, not a new one

The profile pages already show activity over time: `renderPresenceTable` in
[src/profile-shared.ts](../../src/profile-shared.ts) — a month × year grid with a
blue ramp and the count in each cell. The calendar is the same idea on a day
grid, so it reuses that table's tokens rather than inventing a parallel set:
`#94a3b8`/0.75rem/500 column headers, `#1e3a5f`/0.8125rem cell numerals,
`tabular-nums`, and the same Material-blue family for the fill.

Day numerals are ordinary HTML text, not SVG `<text>`. Drawn inside the circle's
`viewBox` they were scaled by the viewBox-to-px ratio, which distorts stroke
weight and metrics enough that the grid read as a different typeface from the
rest of the panel. Only the circle is a drawn shape now, and it is a
`border-radius: 50%` span sized in CSS.

The picker has **one arrow treatment**, `stepButtonStyles`, shared by the month
steppers and the day steppers (exported from `date-calendar.ts`, per the
`profileStyles` convention). They are quiet chrome — borderless, `#64748b`,
1.75rem square — because they sit inside the control and step the label between
them. Boxing them like the "Go to…" select would have given one small control
three competing button styles. Month nav, day grid and day stepper share a
21rem measure so all three arrow pairs land on the same two vertical lines.

The arrows are **drawn**, not typed. Set as `◀`/`▶` (U+25C0 / U+25B6) — as the
old day buttons were — they render from a per-glyph font fallback, because
neither Mukta nor Helvetica carries those codepoints. The pair is not
metrically matched in the fonts that get picked (12px vs 10.56px of advance at
`font-size: 12px` in Chromium) and *which* font gets picked varies by machine,
so the two arrows were visibly different sizes and differently so per platform.
They are now `chevronLeftIcon`/`chevronRightIcon` in
[src/icons.ts](../../src/icons.ts), on the same Material Symbols
`0 -960 960 960` grid as the rest of the icon set: exact mirrors everywhere.
**Don't set UI arrows as text.**

### Area, on a fixed domain

Radius scales with `sqrt(count)`, so **ink is proportional to volume** — the way
a circle is actually read. The domain is fixed at 120/day (≈p99 of days with any
sightings) rather than renormalized per month, so a quiet February looks quiet
next to a busy July instead of being rescaled to look the same. Peak-season
months do run near the top of the domain and compress; that is a true statement
about the data (in July, every day is busy), and the exact count is one hover or
one screen-reader label away.

## Consequences

- One extra request per month viewed, cached client-side; paging back and forth
  doesn't refetch. A failed request leaves a bare but working date picker.
- The calendar occupies ~330px of sidebar height. On narrow screens it fills the
  panel above the fold, so the observation list needs a scroll to reach — the
  previous date input cost one row. Accepted for now; bd `salish-dvd` holds the
  open question of whether to collapse it on mobile.
- `occurrence_days` is a new public read surface. It exposes only counts of
  records that are already anon-readable.

## Rejected alternatives

- **Normalize the circle domain to the visible month.** Guarantees full contrast
  in every month, but makes months incomparable and rescales the same day's
  circle depending on which grid it appears in.
- **Read counts from `occurrence_index`.** Cheap and nearly correct, but a
  contributor's new sighting wouldn't register for minutes — precisely the case
  the feature should reward.
- **A materialized `occurrence_days`.** Same lag, plus another cron job to keep
  in step.
- **Keep the date input and add a sparkline.** Doesn't answer "which day", which
  is the question being asked at the moment of picking.
