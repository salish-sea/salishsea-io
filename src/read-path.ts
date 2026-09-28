/**
 * Where a logged-out visitor's reads come from (decision 056): Supabase, as
 * always, or the static files the read-path build writes.
 *
 * Chosen at build time by VITE_READ_SOURCE, `supabase` (the default) or
 * `static`, so production keeps reading Supabase while the same `main` builds
 * the prototype that reads files. Cutover and rollback are the same one-line
 * change.
 *
 * Only a signed-out visitor's day of sightings on the map reads files so far.
 * Everything else — the calendar, profiles, share links, and anything a
 * signed-in contributor sees — still asks Supabase.
 */

import type { Extent } from './extents.ts';

export type ReadSource = 'supabase' | 'static';

/** The configured source. */
export function readSource(): ReadSource {
  return parseReadSource(import.meta.env.VITE_READ_SOURCE);
}

/**
 * A value that is neither source is a typo in a deploy's environment, and
 * failing loudly beats quietly reading the other source.
 */
export function parseReadSource(value: string | undefined): ReadSource {
  if (value === undefined || value === '' || value === 'supabase') return 'supabase';
  if (value === 'static') return 'static';
  throw new Error(`VITE_READ_SOURCE must be 'supabase' or 'static', not '${value}'`);
}

/**
 * Where the files are served. Same origin as the page, so the CSP's
 * `connect-src 'self'` already covers it; in development vite.config.js serves
 * a build's export directory here.
 */
export const READ_PATH_BASE = '/read-path/';

type Located = {location: {lon: number | null, lat: number | null} | null};

/**
 * A day's occurrences, newest first, from `days/<date>.json` — the same rows
 * `fetchOccurrences` gets from PostgREST, with the same region filter applied
 * here instead of in Postgres.
 *
 * A day with no sightings has no file, so a 404 is an empty day. That is only
 * honest while nothing else can make the file go missing: once the files are
 * served, a manifest has to say which days the build covered, or a failed
 * publish would read as a quiet day on the water (salish-t3g.1). Any other
 * failure throws, and the caller reports it.
 */
export async function fetchDayOccurrences<T extends Located>(
  date: string,
  extent: Extent | null,
): Promise<T[]> {
  const url = `${READ_PATH_BASE}days/${date}.json`;
  const response = await fetch(url);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const day = await response.json() as T[];
  if (!extent) return day;
  // Inclusive on every side, as PostgREST's gte/lte were. A row with no
  // location fails every comparison there, so it is excluded here too.
  const [minx, miny, maxx, maxy] = extent;
  return day.filter(({location}) => {
    const lon = location?.lon ?? null;
    const lat = location?.lat ?? null;
    return lon !== null && lat !== null &&
      lon >= minx && lon <= maxx &&
      lat >= miny && lat <= maxy;
  });
}
