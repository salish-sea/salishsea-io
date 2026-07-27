// The site's day boundaries.
//
// A `d=` URL parameter names a Pacific calendar date, and the app resolves it to
// [midnight, +1 day) in Pacific time (`src/salish-sea.ts`, via Temporal's
// PST8PDT). Node has no Temporal, so the same boundary is derived here from
// Intl. Getting this wrong shifts a whole day's sightings by up to 8 hours, so it
// lives in one module with its own tests rather than inline at each call site.

const ZONE = 'America/Los_Angeles';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How far the zone is from UTC at a given instant, in ms (negative in the
 * Americas). Derived by formatting the instant in the zone, reading it back as
 * though it were UTC, and taking the difference.
 */
function zoneOffsetMs(instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));

  const at = (type: string) => Number(parts.find(p => p.type === type)!.value);
  // hourCycle h23 still reports midnight as "24" in some ICU versions.
  const asIfUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'));
  return asIfUtc - instantMs;
}

/** The instant at which the given Pacific calendar date begins. */
function startOfPacificDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d);
  // One correction lands inside the right day; a second settles the case where
  // the first guess fell on the other side of a DST transition.
  let instant = naive - zoneOffsetMs(naive);
  instant = naive - zoneOffsetMs(instant);
  return instant;
}

/** A `YYYY-MM-DD` string that names a real calendar date. */
export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  // Rejects 2026-02-31 and friends, which Date would silently roll forward.
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * The half-open instant range covering a Pacific calendar date, as ISO strings
 * ready for a PostgREST `gte`/`lt` filter. The end is computed from the next
 * date's own midnight, so a 23- or 25-hour DST day comes out the right length.
 */
export function pacificDayRange(date: string): { startIso: string; endIso: string } {
  if (!isValidDate(date)) throw new Error(`not a calendar date: ${date}`);
  const start = startOfPacificDay(date);
  const nextDate = new Date(start + 36 * 3600_000); // safely inside the next day
  const next = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(nextDate);
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(startOfPacificDay(next)).toISOString(),
  };
}

/** Today's date in Pacific time, `YYYY-MM-DD`. */
export function currentPacificDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
