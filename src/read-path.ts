/**
 * Where a logged-out visitor's reads come from (decision 056): Supabase, as
 * always, or the static files the read-path build writes.
 *
 * Chosen at build time by VITE_READ_SOURCE, `supabase` (the default) or
 * `static`, so production keeps reading Supabase while the same `main` builds
 * the prototype that reads files. Cutover and rollback are the same one-line
 * change.
 *
 * A signed-out visitor's day of sightings on the map, and the calendar's counts,
 * read files; the manifest tells an open tab when a new build has landed.
 * Everything else — the calendar, profiles, share links, and anything a
 * signed-in contributor sees — still asks Supabase.
 */

import type { Extent } from './extents.ts';
import { idShard } from './read-path-shard.ts';
import { HAULOUT_SITES_FILE, type HauloutSite } from './catalog.ts';

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
 * The calendar's day counts for one region, for every day from `from` to `to`
 * inclusive (ISO dates), from the month files under `calendar/` — what the
 * `occurrence_days` call returns for the same range and region. A day with no
 * sightings is absent.
 *
 * The grid always reaches into next month, which no build has covered yet, so a
 * month after the manifest's coverage isn't fetched at all: its days get no
 * circle, as a failed load leaves them today. A missing month within coverage is
 * one with no sightings. With no manifest, nothing is built, and that throws.
 */
export async function fetchCalendarCounts(
  from: string,
  to: string,
  regionSlug: string,
): Promise<Map<string, number>> {
  const manifest = await fetchManifest();
  if (!manifest) throw new Error(`${READ_PATH_BASE}manifest.json: nothing built yet`);
  const coveredMonth = manifest.covered_through.slice(0, 7);
  const counts = new Map<string, number>();
  for (const month of monthsBetween(from, to)) {
    if (month > coveredMonth) break;
    const url = `${READ_PATH_BASE}calendar/${month}.json`;
    const response = await fetch(url);
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const byRegion = await response.json() as Record<string, Record<string, number>>;
    for (const [day, count] of Object.entries(byRegion[regionSlug] ?? {})) {
      if (day >= from && day <= to) counts.set(day, count);
    }
  }
  return counts;
}

/** Every `YYYY-MM` from `from`'s month to `to`'s, inclusive. */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.slice(0, 7).split('-').map(Number) as [number, number];
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= last) return months;
    if (++month > 12) { month = 1; year++; }
  }
}

/**
 * The occurrence a `?o=<id>` link names, read from the files: its day from the
 * id index (`ids/<shard>.json`, see read-path-shard.ts), then the occurrence
 * from that day's file, with no region applied — a linked sighting opens even
 * outside the region on screen. Null when the id names no sighting the last
 * build has, which the caller treats as it treats an unknown id; an error when
 * nothing has been built or a fetch fails.
 */
export async function findOccurrence<T extends Located & {id: string}>(id: string): Promise<T | null> {
  const url = `${READ_PATH_BASE}ids/${idShard(id)}.json`;
  const response = await fetch(url);
  if (response.status === 404) {
    if (await fetchManifest()) return null;
    throw new Error(`${url}: nothing built yet`);
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const days: unknown = await response.json();
  // The id comes from the URL: `constructor` must not find an inherited property.
  const day = days && typeof days === 'object' && Object.hasOwn(days, id)
    ? (days as Record<string, unknown>)[id]
    : undefined;
  if (typeof day !== 'string') return null;
  const occurrences = await fetchDayOccurrences<T>(day, null);
  return occurrences.find(o => o.id === id) ?? null;
}

/**
 * Every haul-out site, as the main map's layer draws them: what
 * `fetchHauloutSites` gets from PostgREST, written beside the sites' pages by
 * the build (scripts/read-path/profiles.ts). A missing file is an error, not an
 * empty list: the build always writes it, so its absence means nothing is built.
 */
export async function fetchStaticHauloutSites(): Promise<HauloutSite[]> {
  const url = `${READ_PATH_BASE}profiles/haulouts/${HAULOUT_SITES_FILE}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return await response.json() as HauloutSite[];
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
  // A failed first poll means the baseline comes from a later one, and a build
  // may have landed in between, so that later baseline counts as a change.
  let missedFirst = false;
  let running = false;
  const tick = async () => {
    // One poll at a time: on a slow connection a poll and its refetch can outlast
    // the interval, and an older one must not land after a newer one.
    if (running || !isVisible()) return;
    running = true;
    try {
      let manifest;
      try {
        manifest = await fetchManifest();
      } catch {
        if (seen === undefined) missedFirst = true;
        return;
      }
      const taken = manifest?.snapshot_taken_at ?? null;
      const changed = seen === undefined ? missedFirst : taken !== seen;
      if (changed && !(await onNewBuild())) return;
      seen = taken;
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}

