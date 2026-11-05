/**
 * Reads the published read-path files into the sightings the track rules take
 * (decision 062), for the scripts beside it: compare.ts and land-crossings.ts.
 *
 * It reads what the map reads (decision 056): the calendar's month files for
 * which days have sightings, each such day's file for the sightings, and every
 * individual's links file (the profile page's map of its sightings) for which
 * registered animals a sighting names. `from` is salishsea.io's read-path
 * directory by default, or a build's export directory on disk. What it read is
 * cached under the system temp directory, so later runs are offline; the first
 * run against salishsea.io makes a few thousand requests.
 *
 * Days are Pacific calendar days, as the map draws them, with no region filter.
 * A sighting names an animal when the animal's page links to it: a code on the
 * sighting or an identification of the animal, or of a matriline it is a living
 * member of (profile-links.sql's individual_occurrences).
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Temporal} from 'temporal-polyfill';
import {pacificDay} from '../../src/read-path.ts';
import type {Occurrence} from '../../src/types.ts';
import type {Sighting} from './rules.ts';

const TRACKED = /^(Orcinus orca|Megaptera novaeangliae|Eschrichtius robustus|Balaenoptera acutorostrata)/;

export const DEFAULT_FROM = 'https://salishsea.io/read-path';

export type Row = Omit<Sighting, 'animals'> & {day: string; time: string; animals: number[]};
type Link = {occurrence_id: string; is_present: boolean};

/** A real calendar date, YYYY-MM-DD. It goes into a cache file name, so nothing else is let through. */
export function calendarDate(flag: string, value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)) return value;
  throw new Error(`--${flag} must be a calendar date like 2026-09-03, not "${value}"`);
}
calendarDate('since', args.since);
if (args.day) calendarDate('day', args.day);

/**
 * Every sighting of a tracked species with a position, on the days since `since`
 * (a calendar date), read from `from` (a URL or a directory), or from the cache
 * unless `refresh`.
 */
export async function loadRows(since: string, {from = DEFAULT_FROM, refresh = false} = {}): Promise<Row[]> {
  const remote = /^https?:\/\//.test(from);
  const base = remote ? from.replace(/\/+$/, '') : path.resolve(from.replace(/^~(?=\/)/, os.homedir()));

  /**
   * A published file, parsed. A file the export says exists (`required`) must be
   * there: a missing one would quietly drop a day or an animal's names from every
   * measure. Otherwise a missing file is null, as for a month with no sightings.
   */
  async function read<T>(file: string, {required = true} = {}): Promise<T | null> {
    const missing = () => {
      if (required) throw new Error(`${base}/${file} is missing, but the export says it exists`);
      return null;
    };
    if (!remote) {
      try { return JSON.parse(await fs.promises.readFile(path.join(base, file), 'utf8')); }
      catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return missing(); throw err; }
    }
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${base}/${file}`);
      if (response.status === 404) return missing();
      if (response.ok) return await response.json() as T;
      if (attempt === 3 || response.status < 500) throw new Error(`${base}/${file}: HTTP ${response.status}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  /** `f` over `items`, a few at a time, in order. */
  async function pooled<T, U>(items: readonly T[], f: (item: T) => Promise<U>): Promise<U[]> {
    const out: U[] = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; out[i] = await f(items[i]!); } };
    await Promise.all(Array.from({length: remote ? 8 : 32}, worker));
    return out;
  }

  function months(since: string): string[] {
    const out: string[] = [];
    const last = Temporal.Now.plainDateISO('America/Los_Angeles').toPlainYearMonth();
    for (let m = Temporal.PlainYearMonth.from(since.slice(0, 7)); Temporal.PlainYearMonth.compare(m, last) <= 0; m = m.add({months: 1}))
      out.push(m.toString());
    return out;
  }

  const source = createHash('sha256').update(base).digest('hex').slice(0, 12);
  const cache = path.join(os.tmpdir(), 'salishsea-segments', `${source}-${since}.json`);
  if (!refresh && fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));

  // Which days have any sightings at all: the calendar's "everywhere" counts.
  const calendars = await pooled(months(since), m => read<{everywhere?: Record<string, number>}>(`calendar/${m}.json`, {required: false}));
  const dayKeys = calendars.flatMap(c => Object.keys(c?.everywhere ?? {})).filter(d => d >= since).sort();

  // Each individual's sightings, inverted: which animals a sighting names. The
  // individual's 7-digit register number (its page's address) stands for it.
  const redirects = (await read<{individuals: Record<string, string>}>('redirects.json'))!;
  const individuals = [...new Set(Object.values(redirects.individuals).map(p => p.split('/')[2]!))];
  const named = new Map<string, Set<number>>();
  await pooled(individuals, async id => {
    for (const link of (await read<Link[]>(`profiles/individuals/${id}.links.json`))!) {
      if (!link.is_present) continue;
      named.set(link.occurrence_id, (named.get(link.occurrence_id) ?? new Set()).add(Number(id)));
    }
  });

  const rows: Row[] = [];
  const days = await pooled(dayKeys, d => read<Occurrence[]>(`days/${d}.json`));
  for (const occurrences of days) for (const o of occurrences!) {
    if (!o.location || o.location.lat === null || o.location.lon === null) continue;
    const name = o.taxon.scientific_name;
    if (name === null || !TRACKED.test(name)) continue;
    const at = Temporal.Instant.from(o.observed_at);
    rows.push({
      id: o.id,
      observed_at_ms: at.epochMilliseconds,
      day: pacificDay(o.observed_at),
      time: at.toZonedDateTimeISO('America/Los_Angeles').toPlainTime().toString({smallestUnit: 'minute'}),
      location: {lat: o.location.lat, lon: o.location.lon},
      taxon: {species_id: o.taxon.species_id, scientific_name: name},
      identifiers: o.identifiers ?? [],
      animals: [...named.get(o.id) ?? []],
    });
  }
  fs.mkdirSync(path.dirname(cache), {recursive: true});
  fs.writeFileSync(cache, JSON.stringify(rows));
  return rows;
}
