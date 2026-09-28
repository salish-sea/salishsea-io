/**
 * Where a logged-out visitor's reads come from (decision 056): Supabase, as
 * always, or the static files the read-path build writes.
 *
 * Chosen at build time by VITE_READ_SOURCE, `supabase` (the default) or
 * `static`, so production keeps reading Supabase while the same `main` builds
 * the prototype that reads files. Cutover and rollback are the same one-line
 * change.
 *
 * Only a signed-out visitor's day of sightings on the map reads files so far,
 * and the manifest tells an open tab when a new build has landed.
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
 * What the last build covered (scripts/read-path/manifest.ts). Every Pacific
 * day up to and including `covered_through` is in the files; a new
 * `snapshot_taken_at` means a new build.
 */
export type Manifest = {
  version: 1,
  snapshot_taken_at: string,
  covered_through: string,
};

/** The current manifest, or null when nothing has been built yet. */
export async function fetchManifest(): Promise<Manifest | null> {
  const url = `${READ_PATH_BASE}manifest.json`;
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const manifest = await response.json() as Manifest;
  if (manifest.version !== 1) throw new Error(`${url}: unknown version ${manifest.version}`);
  return manifest;
}

/**
 * A day's occurrences, newest first, from `days/<date>.json` — the same rows
 * `fetchOccurrences` gets from PostgREST, with the same region filter applied
 * here instead of in Postgres.
 *
 * A day with no sightings has no file, and neither does a day no build has
 * reached. The manifest tells them apart: a missing day the last build covered
 * is empty, and any other missing day throws, because an empty list there would
 * say the water was quiet when the truth is we don't know yet. Any other failure
 * throws too, and the caller reports it.
 */
export async function fetchDayOccurrences<T extends Located>(
  date: string,
  extent: Extent | null,
): Promise<T[]> {
  const url = `${READ_PATH_BASE}days/${date}.json`;
  const response = await fetch(url);
  if (response.status === 404) {
    const manifest = await fetchManifest();
    // Both are ISO dates, so they compare as strings.
    if (manifest && date <= manifest.covered_through) return [];
    throw new Error(`${url}: not built yet (covered through ${manifest?.covered_through ?? 'nothing'})`);
  }
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

/**
 * Call `onNewBuild` whenever the manifest names a new snapshot, checking every
 * `intervalMs` while the page is visible. The first manifest seen is the
 * baseline, not a change. A failed poll is left for the next tick, and so is a
 * new build whose `onNewBuild` resolves false: the snapshot counts as seen only
 * once the page has actually caught up with it. Returns a function that stops
 * the watch.
 */
export function watchManifest(
  onNewBuild: () => boolean | Promise<boolean>,
  {intervalMs = 60_000, isVisible = () => document.visibilityState === 'visible'}: {
    intervalMs?: number,
    isVisible?: () => boolean,
  } = {},
): () => void {
  let seen: string | null | undefined;
  const tick = async () => {
    if (!isVisible()) return;
    let manifest;
    try {
      manifest = await fetchManifest();
    } catch {
      return;
    }
    const taken = manifest?.snapshot_taken_at ?? null;
    if (seen !== undefined && taken !== seen && !(await onNewBuild())) return;
    seen = taken;
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}

