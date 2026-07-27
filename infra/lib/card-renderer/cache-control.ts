// How long a card may be cached.
//
// The governing fact is that a sighting's *record* keeps changing for a few days
// after the sighting itself. Reports arrive late, ingest runs on a schedule,
// counts get revised, a species gets re-identified, photos appear. A card
// rendered an hour after a sighting is the one most likely to be wrong soon, and
// under the original rule it was the one cached hardest — occurrence cards were
// unconditionally immutable for a year.
//
// So freshness is keyed on how recent the *subject* is, not on the card type.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a subject stays volatile. Four days covers ingest lag plus the tail
 * of late community reports; past that a day's set has effectively settled.
 */
export const FRESH_WINDOW_DAYS = 4;

/**
 * Recent subject: short enough that a correction shows up quickly, long enough
 * that a burst of crawlers hitting a freshly-shared link doesn't re-render (and
 * re-fetch ~18 basemap tiles) per request. Not zero for that reason.
 */
export const FRESH = 'public, max-age=300, must-revalidate';

/**
 * Settled subject. Deliberately NOT `immutable`: curation can revise an old
 * record (decision 014), and `immutable` tells caches never to revalidate even
 * on a manual reload, which would make every correction depend on someone
 * remembering to run a CloudFront invalidation. A month of cache is nearly all
 * the benefit with an automatic way out.
 */
export const SETTLED = 'public, max-age=2592000';

/**
 * A 404. Long enough that a crawler storm over one bad id doesn't hammer
 * Supabase, short enough that a genuinely new occurrence isn't 404-locked.
 */
export const MISS = 'public, max-age=300';

function isWithinFreshWindow(subjectMs: number, now: Date): boolean {
  // Future-dated subjects count as fresh: a clock skew or a bad observed_at
  // should not earn a month of caching.
  return now.getTime() - subjectMs < FRESH_WINDOW_DAYS * DAY_MS;
}

/**
 * Cache-Control for a card whose subject is an instant — an occurrence's
 * `observed_at`.
 *
 * Known limitation: this reads the observation time, not the record's last
 * modification, which the API does not expose. An old sighting ingested today
 * is treated as settled even though it is brand new to us. Bounded in practice,
 * since the first render happens after ingest.
 */
export function cacheControlForInstant(observedAtIso: string, now = new Date()): string {
  const observed = Date.parse(observedAtIso);
  // An unparseable timestamp is a data problem; cache it briefly rather than
  // for a month, so it self-corrects.
  if (Number.isNaN(observed)) return FRESH;
  return isWithinFreshWindow(observed, now) ? FRESH : SETTLED;
}

/**
 * Cache-Control for a card whose subject is a whole Pacific calendar day.
 * The day is treated as ending at its own midnight, so "today" is fresh from
 * its first minute.
 */
export function cacheControlForDate(pacificDate: string, dayEndsIso: string, now = new Date()): string {
  const dayEnds = Date.parse(dayEndsIso);
  if (Number.isNaN(dayEnds)) return FRESH;
  // Measure from the END of the day: a card for today is fresh all day, and a
  // card for four days ago settles four days after that day finished.
  return isWithinFreshWindow(dayEnds, now) ? FRESH : SETTLED;
}
