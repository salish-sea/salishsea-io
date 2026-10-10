/**
 * Compare the travel-segment rules in `rules.ts` over real days from the
 * published read-path files (#445, decision 062).
 *
 *   pnpm exec tsx scripts/segments/compare.ts                 # measures since 2022
 *   pnpm exec tsx scripts/segments/compare.ts --since 2025-01-01
 *   pnpm exec tsx scripts/segments/compare.ts --day 2026-09-03 --rules current,nearestEcotype
 *   pnpm exec tsx scripts/segments/compare.ts --refresh       # re-read the files
 *   pnpm exec tsx scripts/segments/compare.ts --from ~/salishsea-export   # a local build
 *
 * It reads what the map reads (decision 056): the calendar's month files for
 * which days have sightings, each such day's file for the sightings, and every
 * individual's links file (the profile page's map of its sightings) for which
 * registered animals a sighting names. `--from` is salishsea.io's read-path
 * directory by default, or a build's export directory on disk. It caches what it
 * read under the system temp directory, so later runs are offline; the first
 * run against salishsea.io makes a few thousand requests.
 *
 * Days are Pacific calendar days, as the map draws them, with no region filter.
 * A sighting names an animal when the animal's page links to it: a code on the
 * sighting or an identification of the animal, or of a matriline it is a living
 * member of (profile-links.sql's individual_occurrences).
 *
 * WHAT THE MEASURES MEAN
 *
 * There is no ground truth, so every measure is a proxy. Where they disagree,
 * look at the days with `--day`.
 * - stranded: a sighting drawn alone although a same-species sighting within
 *   3 km and an hour of it is on a track. The #445 failure.
 * - mixed: tracks containing both a resident and a Bigg's report.
 *   Most reports name neither, so this is a floor.
 * - held-out disagree: links between two sightings that both name registered
 *   animals but share none, counted only between sightings in the half that
 *   the identity rule is never shown (the identityHalfNames row).
 *   Groups join and split, so some of these links are right.
 * - days changed: days whose tracks differ from `previous`, the map's rule
 *   before decision 063.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {Temporal} from 'temporal-polyfill';
import {travelSpeedFor} from '../../src/constants.ts';
import {pacificDay} from '../../src/read-path.ts';
import type {Occurrence} from '../../src/types.ts';
import {RULES, ecotypesOf, identityPreferred, km, type Rule, type Sighting, type Track} from './rules.ts';

const hour = 60 * 60 * 1000;
const TRACKED = /^(Orcinus orca|Megaptera novaeangliae|Eschrichtius robustus|Balaenoptera acutorostrata)/;

type Row = Omit<Sighting, 'animals'> & {day: string; time: string; animals: number[]};
type Link = {occurrence_id: string; is_present: boolean};

const {values: args} = parseArgs({options: {
  since: {type: 'string', default: '2022-01-01'},
  day: {type: 'string'},
  rules: {type: 'string'},
  refresh: {type: 'boolean', default: false},
  from: {type: 'string', default: 'https://salishsea.io/read-path'},
}});

/** A real calendar date, YYYY-MM-DD. It goes into a cache file name, so nothing else is let through. */
function calendarDate(flag: string, value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)) return value;
  throw new Error(`--${flag} must be a calendar date like 2026-09-03, not "${value}"`);
}
calendarDate('since', args.since);
if (args.day) calendarDate('day', args.day);

const remote = /^https?:\/\//.test(args.from);
const base = remote ? args.from.replace(/\/+$/, '') : path.resolve(args.from.replace(/^~(?=\/)/, os.homedir()));

/** A published file, parsed; null when there is no such file (a month or day with no sightings). */
async function read<T>(file: string): Promise<T | null> {
  if (!remote) {
    try { return JSON.parse(await fs.promises.readFile(path.join(base, file), 'utf8')); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
  }
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${base}/${file}`);
    if (response.status === 404) return null;
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
  const last = Temporal.Now.plainDateISO('PST8PDT').toPlainYearMonth();
  for (let m = Temporal.PlainYearMonth.from(since.slice(0, 7)); Temporal.PlainYearMonth.compare(m, last) <= 0; m = m.add({months: 1}))
    out.push(m.toString());
  return out;
}

async function load(since: string): Promise<Row[]> {
  const source = (remote ? base.replace(/^https?:\/\//, '') : base).replace(/[^A-Za-z0-9.-]+/g, '_');
  const cache = path.join(os.tmpdir(), 'salishsea-segments', `${source}-${since}.json`);
  if (!args.refresh && fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));

  // Which days have any sightings at all: the calendar's "everywhere" counts.
  const calendars = await pooled(months(since), m => read<{everywhere?: Record<string, number>}>(`calendar/${m}.json`));
  const dayKeys = calendars.flatMap(c => Object.keys(c?.everywhere ?? {})).filter(d => d >= since).sort();

  // Each individual's sightings, inverted: which animals a sighting names. The
  // individual's 7-digit register number (its page's address) stands for it.
  const redirects = await read<{individuals: Record<string, string>}>('redirects.json');
  if (!redirects) throw new Error(`${base}/redirects.json is missing: is --from a read-path export?`);
  const individuals = [...new Set(Object.values(redirects.individuals).map(p => p.split('/')[2]!))];
  const named = new Map<string, Set<number>>();
  await pooled(individuals, async id => {
    for (const link of await read<Link[]>(`profiles/individuals/${id}.links.json`) ?? []) {
      if (!link.is_present) continue;
      named.set(link.occurrence_id, (named.get(link.occurrence_id) ?? new Set()).add(Number(id)));
    }
  });

  const rows: Row[] = [];
  const days = await pooled(dayKeys, d => read<Occurrence[]>(`days/${d}.json`));
  for (const occurrences of days) for (const o of occurrences ?? []) {
    if (!o.location || o.location.lat === null || o.location.lon === null) continue;
    if (!TRACKED.test(o.taxon.scientific_name)) continue;
    const at = Temporal.Instant.from(o.observed_at);
    rows.push({
      id: o.id,
      observed_at_ms: at.epochMilliseconds,
      day: pacificDay(o.observed_at),
      time: at.toZonedDateTimeISO('PST8PDT').toPlainTime().toString({smallestUnit: 'minute'}),
      location: {lat: o.location.lat, lon: o.location.lon},
      taxon: {species_id: o.taxon.species_id, scientific_name: o.taxon.scientific_name},
      identifiers: o.identifiers ?? [],
      animals: [...named.get(o.id) ?? []],
    });
  }
  fs.mkdirSync(path.dirname(cache), {recursive: true});
  fs.writeFileSync(cache, JSON.stringify(rows));
  return rows;
}

const rows = await load(args.since);
const meta = new Map(rows.map(r => [r.id, r]));
const days = new Map<string, Sighting[]>();
for (const r of rows) {
  const s: Sighting = {...r, animals: new Set(r.animals)};
  days.set(r.day, [...(days.get(r.day) ?? []), s]);
}

/** Half the sightings, chosen by a hash of the id, so the split is the same on every run. */
const shown = (s: Sighting) => {
  let h = 0;
  for (const c of s.id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h & 1) === 0;
};

const rules: Record<string, Rule> = {...RULES, identityHalfNames: identityPreferred(shown)};
const selected = args.rules?.split(',') ?? Object.keys(rules);
for (const name of selected) if (!(name in rules)) throw new Error(`No rule "${name}". Rules: ${Object.keys(rules).join(', ')}`);

if (args.day) {
  const day = days.get(args.day);
  if (!day) throw new Error(`No sightings of tracked species on ${args.day}`);
  const label = (s: Sighting) => {
    const {time} = meta.get(s.id)!;
    const said = s.identifiers.length ? s.identifiers.join(',') : (s.taxon.scientific_name.split(' ')[2] ?? '·');
    return `${time} ${said} (${s.location.lon.toFixed(3)},${s.location.lat.toFixed(3)})`;
  };
  for (const name of selected) {
    console.log(`\n${name}`);
    for (const track of rules[name]!(day).toSorted((a, b) => a[0]!.observed_at_ms - b[0]!.observed_at_ms))
      console.log(`  ${track.map(label).join(' → ')}`);
  }
  process.exit(0);
}

function stranded(tracks: Track[]) {
  const onTracks = tracks.filter(t => t.length > 1).flat();
  return tracks.filter(t => t.length === 1).map(t => t[0]!).filter(s =>
    s.taxon.species_id && travelSpeedFor(s.taxon.scientific_name) &&
    onTracks.some(o => o.taxon.species_id === s.taxon.species_id &&
      Math.abs(o.observed_at_ms - s.observed_at_ms) <= hour && km(o, s) <= 3)).length;
}
const mixed = (t: Track) => {
  const e = new Set(t.flatMap(s => [...ecotypesOf(s)]));
  return e.has('resident') && e.has('biggs');
};
const membership = (tracks: Track[]) =>
  new Map(tracks.flatMap(t => { const key = t.map(s => s.id).sort().join('|'); return t.map(s => [s.id, key] as const); }));

const table: Record<string, Record<string, number | string>> = {};
for (const name of selected) {
  const m = {stranded: 0, mixed: 0, 'links >6h': 0, 'links >10km': 0, tracks: 0, alone: 0, 'held-out agree': 0, 'held-out disagree': 0, 'days changed': 0};
  for (const day of days.values()) {
    const tracks = rules[name]!(day);
    m.stranded += stranded(tracks);
    const before = membership(RULES.previous(day)), after = membership(tracks);
    if (day.some(s => before.get(s.id) !== after.get(s.id))) m['days changed']++;
    for (const t of tracks) {
      if (t.length === 1) {
        if (travelSpeedFor(t[0]!.taxon.scientific_name)) m.alone++;
        continue;
      }
      m.tracks++;
      if (mixed(t)) m.mixed++;
      for (let i = 1; i < t.length; i++) {
        const a = t[i - 1]!, b = t[i]!;
        if (b.observed_at_ms - a.observed_at_ms > 6 * hour) m['links >6h']++;
        if (km(a, b) > 10) m['links >10km']++;
        if (!shown(a) && !shown(b) && a.animals.size && b.animals.size)
          m[[...a.animals].some(x => b.animals.has(x)) ? 'held-out agree' : 'held-out disagree']++;
      }
    }
  }
  table[name] = m;
}
console.log(`${rows.length.toLocaleString()} sightings over ${days.size.toLocaleString()} days since ${args.since}`);
console.table(table);
