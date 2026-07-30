import { Temporal } from "temporal-polyfill";

/**
 * Pure helpers behind <date-calendar>. Kept apart from the component so the
 * grid arithmetic and the volume encoding are testable without a DOM.
 */

export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** Weeks per grid. Fixed rather than fitted so the panel below doesn't jump as months are paged. */
const WEEKS = 6;

/**
 * The 42 days a month's grid shows, Sunday-first, including the leading and
 * trailing days of the adjacent months that fill out the first and last weeks.
 */
export function monthGrid(month: Temporal.PlainYearMonth): Temporal.PlainDate[] {
  const first = month.toPlainDate({day: 1});
  // Temporal's dayOfWeek is ISO (Monday=1 … Sunday=7); % 7 turns it into an
  // offset from the preceding Sunday.
  const start = first.subtract({days: first.dayOfWeek % 7});
  return Array.from({length: WEEKS * 7}, (_, i) => start.add({days: i}));
}

/**
 * Volume at which a day's circle reaches full size. Near the 99th percentile of
 * days that have any sightings (prod, 2026-07: median 15, p90 61, p99 119), so
 * ordinary days spread across most of the range and only exceptional ones clip.
 */
export const FULL_SCALE_VOLUME = 120;

/** Below this fraction of full size a circle reads as a smudge, so one sighting gets at least this. */
const MIN_VISIBLE_SCALE = 0.22;

/**
 * How large to draw a day's volume circle, as a fraction of full size — 0 for a
 * day with nothing, otherwise between {@link MIN_VISIBLE_SCALE} and 1. The
 * caller decides what "full size" is in px or %.
 *
 * Area — not width — carries the value: a day with four times the sightings
 * gets a circle four times the ink, which is how a circle is read. The domain is
 * fixed rather than per-month so a quiet December looks quiet next to a busy
 * July instead of being renormalized to look the same.
 */
export function volumeScale(count: number): number {
  if (count <= 0)
    return 0;
  const scale = Math.sqrt(Math.min(count, FULL_SCALE_VOLUME) / FULL_SCALE_VOLUME);
  return Math.min(1, Math.max(MIN_VISIBLE_SCALE, scale));
}
