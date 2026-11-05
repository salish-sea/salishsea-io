/**
 * Compare the travel-segment rules in `rules.ts` over real days from the
 * published read-path files (#445, decision 062).
 *
 *   pnpm exec tsx scripts/segments/compare.ts                 # measures since 2022
 *   pnpm exec tsx scripts/segments/compare.ts --since 2025-01-01
 *   pnpm exec tsx scripts/segments/compare.ts --day 2026-09-03 --rules current,nearestEcotype
 *   WATER_MASK=/path/to/water-mask pnpm exec tsx scripts/segments/compare.ts --rules current,seaDistance
 *   pnpm exec tsx scripts/segments/compare.ts --refresh       # re-read the files
 *   pnpm exec tsx scripts/segments/compare.ts --from ~/salishsea-export   # a local build
 *
 * It reads what the map reads (decision 056) through `published.ts`: the calendar's month files for
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
 * - seaDistance is `current` with the distance by sea (it needs WATER_MASK); to see
 *   which days differ from `current`, run with `--changed`.
 */
import {parseArgs} from 'node:util';
import {travelSpeedFor} from '../../src/constants.ts';
import {calendarDate, DEFAULT_FROM, loadRows} from './published.ts';
import {RULES, ecotypesOf, identityPreferred, km, seaDistanceRule, type Rule, type Sighting, type Track} from './rules.ts';

const hour = 60 * 60 * 1000;

const {values: args} = parseArgs({options: {
  since: {type: 'string', default: '2022-01-01'},
  day: {type: 'string'},
  rules: {type: 'string'},
  refresh: {type: 'boolean', default: false},
  changed: {type: 'boolean', default: false},
  from: {type: 'string', default: DEFAULT_FROM},
}});
calendarDate('since', args.since);
if (args.day) calendarDate('day', args.day);

const rows = await loadRows(args.since, {from: args.from, refresh: args.refresh});
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
// `seaDistance` needs the basemap's water mask: WATER_MASK=<path without .png/.json>.
if (process.env['WATER_MASK']) rules['seaDistance'] = seaDistanceRule(process.env['WATER_MASK']);
else console.log('seaDistance skipped: set WATER_MASK=<path to water-mask, without .png or .json> to measure by sea');
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

// The days whose tracks differ between the first selected rule and the second (--changed).
if (args.changed && selected.length >= 2) {
  const [a, b] = [selected[0]!, selected[1]!];
  console.log(`\ndays whose tracks differ between ${a} and ${b}: day, segments (${a} -> ${b}), reports moved`);
  let changed = 0;
  for (const [day, sightings] of [...days].toSorted(([x], [y]) => x < y ? -1 : 1)) {
    const before = rules[a]!(sightings), after = rules[b]!(sightings);
    const was = membership(before), now = membership(after);
    const moved = sightings.filter(s => was.get(s.id) !== now.get(s.id)).length;
    if (!moved) continue;
    changed++;
    console.log(`${day}  ${before.length} -> ${after.length}  ${moved}`);
  }
  console.log(`${changed} days differ`);
}
