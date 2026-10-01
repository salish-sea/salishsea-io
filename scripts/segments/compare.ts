/**
 * Compare the travel-segment rules in `rules.ts` over real days from production
 * (#445, decision 062).
 *
 *   pnpm exec tsx scripts/segments/compare.ts                 # measures since 2022
 *   pnpm exec tsx scripts/segments/compare.ts --since 2025-01-01
 *   pnpm exec tsx scripts/segments/compare.ts --day 2026-09-03 --rules current,nearestEcotype
 *   pnpm exec tsx scripts/segments/compare.ts --refresh       # re-read production
 *
 * It reads production through `supabase db query --linked`, which needs no
 * database password, only `supabase login`. It reads, never writes, and caches
 * what it read under the system temp directory, so later runs are offline.
 *
 * Days are Pacific calendar days, as the map draws them, with no region filter.
 *
 * WHAT THE MEASURES MEAN
 *
 * There is no ground truth, so every measure is a proxy. Where they disagree,
 * look at the days with `--day`.
 * - stranded: a sighting drawn alone although a same-species sighting within
 *   3 km and an hour of it is on a track. The #445 failure.
 * - mixed: tracks containing both a Southern Resident and a Bigg's report.
 *   Most reports name neither, so this is a floor.
 * - held-out disagree: links between two sightings that both name registered
 *   animals but share none, counted only between sightings in the half that
 *   the identity rule is never shown (the identityHalfNames row).
 *   Groups join and split, so some of these links are right.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {travelSpeedFor} from '../../src/constants.ts';
import {RULES, ecotypesOf, identityPreferred, km, type Rule, type Sighting, type Track} from './rules.ts';

const hour = 60 * 60 * 1000;
const TRACKED = '^(Orcinus orca|Megaptera novaeangliae|Eschrichtius robustus|Balaenoptera acutorostrata)';

type Row = Omit<Sighting, 'animals'> & {day: string; time: string; animals: number[]};

const {values: args} = parseArgs({options: {
  since: {type: 'string', default: '2022-01-01'},
  day: {type: 'string'},
  rules: {type: 'string'},
  refresh: {type: 'boolean', default: false},
}});

/** Run read-only SQL against production. The CLI prints JSON, sometimes after a status line. */
function query(sql: string): Record<string, unknown>[] {
  let out: string;
  try {
    out = execFileSync('pnpm', ['-s', 'exec', 'supabase', 'db', 'query', '--linked', sql],
      {encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore']});
  } catch (err) {
    const stdout = String((err as {stdout?: unknown}).stdout ?? '');
    if (stdout.includes('LegacyProjectNotLinkedError'))
      throw new Error('This checkout is not linked to the Supabase project. Run `pnpm exec supabase link` once here.', {cause: err});
    throw err;
  }
  const parsed = JSON.parse(out.slice(out.search(/^[[{]/m)));
  if (parsed._tag === 'Error') throw new Error(parsed.error?.message ?? out);
  return Array.isArray(parsed) ? parsed : parsed.rows;
}

function load(since: string): Row[] {
  const cache = path.join(os.tmpdir(), 'salishsea-segments', `${since}.json`);
  if (!args.refresh && fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));

  const named = new Map(query(`
    select oi.occurrence_id id,
      array_agg(distinct coalesce(oi.individual_id, mm.individual_id))
        filter (where coalesce(oi.individual_id, mm.individual_id) is not null) animals
    from public.occurrence_identifications oi
    join public.occurrences o on o.id = oi.occurrence_id
    left join public.social_groups sg on sg.id = oi.social_group_id
    left join public.matriline_members mm on mm.group_id = oi.social_group_id and sg.kind = 'matriline'
    where o.observed_at >= '${since}' and oi.is_present and (sg.kind is null or sg.kind = 'matriline')
    group by 1`).map(r => [r.id as string, (r.animals as number[] | null) ?? []]));

  const rows: Row[] = [];
  // A year at a time keeps each response well under the CLI's limits.
  for (let year = Number(since.slice(0, 4)); year <= new Date().getFullYear(); year++) {
    const from = year === Number(since.slice(0, 4)) ? since : `${year}-01-01`;
    for (const r of query(`
      select id, (extract(epoch from observed_at) * 1000)::bigint ms,
        to_char(observed_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD') d,
        to_char(observed_at at time zone 'America/Los_Angeles', 'HH24:MI') t,
        (taxon).scientific_name sn, (taxon).species_id sp, (location).lat lat, (location).lon lon, identifiers
      from public.occurrences
      where observed_at >= '${from}' and observed_at < '${year + 1}-01-01'
        and (taxon).scientific_name ~ '${TRACKED}'`)) {
      rows.push({
        id: r.id as string,
        observed_at_ms: Number(r.ms),
        day: r.d as string,
        time: r.t as string,
        location: {lat: Number(r.lat), lon: Number(r.lon)},
        taxon: {species_id: r.sp === null ? null : Number(r.sp), scientific_name: r.sn as string},
        identifiers: (r.identifiers as string[] | null) ?? [],
        animals: named.get(r.id as string) ?? [],
      });
    }
  }
  fs.mkdirSync(path.dirname(cache), {recursive: true});
  fs.writeFileSync(cache, JSON.stringify(rows));
  return rows;
}

const rows = load(args.since);
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
  return e.has('srkw') && e.has('biggs');
};
const membership = (tracks: Track[]) =>
  new Map(tracks.flatMap(t => { const key = t.map(s => s.id).sort().join('|'); return t.map(s => [s.id, key] as const); }));

const table: Record<string, Record<string, number | string>> = {};
for (const name of selected) {
  const m = {stranded: 0, mixed: 0, 'links >6h': 0, 'links >10km': 0, tracks: 0, alone: 0, 'held-out agree': 0, 'held-out disagree': 0, 'days changed': 0};
  for (const day of days.values()) {
    const tracks = rules[name]!(day);
    m.stranded += stranded(tracks);
    const before = membership(RULES.current(day)), after = membership(tracks);
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
