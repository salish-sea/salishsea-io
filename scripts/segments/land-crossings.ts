/**
 * How many legs of the map's tracks cross land, and where (salish-20u7.1).
 *
 *   pnpm exec tsx scripts/segments/land-crossings.ts                 # every day since 2022
 *   pnpm exec tsx scripts/segments/land-crossings.ts --since 2025-01-01
 *   pnpm exec tsx scripts/segments/land-crossings.ts --day 2025-07-14
 *   pnpm exec tsx scripts/segments/land-crossings.ts --json crossings.json   # the crossings, one object each
 *   pnpm exec tsx scripts/segments/land-crossings.ts --regions regions.json --osm osm.json   # lists on disk
 *
 * The map joins sighting reports into a track by straight-line distance (decision 063),
 * so a leg, the line between two neighbouring reports of a track, can run over an
 * island. This builds each day's tracks with the map's rule (`RULES.current`) from the
 * published files (`published.ts`, the same reader compare.ts uses), and tests every
 * leg against the basemap's water regions (scripts/read-path/water-regions.ts). It
 * prints a report: how many legs cross land, how long the crossings are, and between
 * which waters and beside which island they happen.
 *
 * THE TEST. The leg's straight line is sampled about every 100 m, interpolating in
 * longitude and latitude, which is close enough at this scale. A run of samples that
 * are in no region, with a sample that is in a region on each side, is one crossing.
 * Its length is the run's length plus one step, so a single dry sample counts as 100 m.
 * A leg with a sample outside the regions' range (south of 42°N, north of 51.5°N or
 * east of 129°W) cannot be tested and is counted apart.
 *
 * THE COUNTS ARE A FLOOR. Each region reaches about 300 m onto the shore (basemap
 * decision 027), so a strip of land narrower than about 600 m is all "water" to this
 * test, and a leg that clips a point or crosses a narrow isthmus passes. A leg that
 * starts or ends on land, as a report at a shore viewpoint does, is not a crossing
 * unless water lies on both sides of the land it crosses.
 *
 * THE ISLAND is the nearest one in the basemap's OpenStreetMap place list to the
 * middle of the crossing's dry part. The list gives each island as a single point, not
 * an outline, so for a long island such as Saltspring the nearest point can belong to
 * a smaller island close by. Read the island as a hint, and the pair of waters as the
 * firmer answer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import distance from '@turf/distance';
import {readPlaces, type Place, type PlaceList} from '../../src/places.ts';
import {fetchPlaceList} from '../read-path/fetch-water-regions.ts';
import {waterRegions, type RegionList} from '../read-path/water-regions.ts';
import {calendarDate, DEFAULT_FROM, loadRows} from './published.ts';
import {RULES, type Sighting} from './rules.ts';

/** The spacing of the samples along a leg, in metres. */
export const STEP_M = 100;

type Point = {lon: number; lat: number};
export type Crossing = {
  /** The land crossed, in metres. */
  crossedM: number;
  /** The middle of the dry samples. */
  midpoint: Point;
  /** The water region at the last sample before the land, and at the first after it. */
  from: string;
  to: string;
};
export type LegResult = {testable: boolean; lengthM: number; crossings: Crossing[]};

const metres = (a: Point, b: Point) => distance([a.lon, a.lat], [b.lon, b.lat], {units: 'meters'});

/** Inside the span of latitudes and longitudes that the regions cover, so "no region" can mean land. */
export const inRange = ({lon, lat}: Point) => lat >= 42 && lat <= 51.5 && lon > -129;

/**
 * The land a straight leg crosses, by sampling it with `regionAt`. The samples include
 * both ends, and are the same distance apart, no more than STEP_M.
 */
export function testLeg(a: Point, b: Point, regionAt: (lon: number, lat: number) => string | null): LegResult {
  const lengthM = metres(a, b);
  const n = Math.max(1, Math.ceil(lengthM / STEP_M));
  const stepM = lengthM / n;
  const points = Array.from({length: n + 1}, (_, i): Point => ({
    lon: a.lon + (b.lon - a.lon) * i / n,
    lat: a.lat + (b.lat - a.lat) * i / n,
  }));
  if (!points.every(inRange)) return {testable: false, lengthM, crossings: []};
  const regions = points.map(p => regionAt(p.lon, p.lat));
  const crossings: Crossing[] = [];
  let before = -1; // the last sample in a region, once one has been seen
  for (let i = 0; i < regions.length; i++) {
    if (regions[i] === null) continue;
    if (before >= 0 && i - before > 1) {
      const dry = points.slice(before + 1, i);
      crossings.push({
        crossedM: Math.round((dry.length + 1) * stepM),
        midpoint: dry[Math.floor(dry.length / 2)]!,
        from: regions[before]!,
        to: regions[i]!,
      });
    }
    before = i;
  }
  return {testable: true, lengthM, crossings};
}

/** The island in the list nearest to the point, by straight line, and how far away it is in kilometres. */
export function nearestIsland(islands: readonly Place[], p: Point): {name: string; km: number} | null {
  let best: {name: string; km: number} | null = null;
  for (const island of islands) {
    const km = distance([p.lon, p.lat], [island.lon, island.lat], {units: 'kilometers'});
    if (!best || km < best.km) best = {name: island.name, km};
  }
  return best;
}

export type FoundCrossing = Crossing & {
  day: string;
  from_id: string;
  to_id: string;
  legM: number;
  island: string | null;
  islandKm: number | null;
};

/** `n` over `d` as a percentage with one decimal. */
const percent = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : '–';

export function report(o: {since: string; days: number; legs: number; testable: number; found: FoundCrossing[]; legsByYear: Map<string, {legs: number; testable: number; crossing: number}>}): string {
  const {found} = o;
  const crossingLegs = new Set(found.map(c => `${c.from_id}>${c.to_id}`)).size;
  const out: string[] = [];
  out.push(`Land crossings of track legs, ${o.days.toLocaleString()} days since ${o.since}`);
  out.push('');
  out.push(`legs:               ${o.legs.toLocaleString()}`);
  out.push(`could not be tested: ${(o.legs - o.testable).toLocaleString()} (a sample outside 42-51.5°N, east of 129°W)`);
  out.push(`testable:           ${o.testable.toLocaleString()}`);
  out.push(`crossing land:      ${crossingLegs.toLocaleString()} legs (${percent(crossingLegs, o.testable)} of the testable), ${found.length.toLocaleString()} crossings`);
  out.push('A FLOOR: regions reach about 300 m onto the shore, so land narrower than about 600 m is not seen.');
  out.push('');
  out.push('By year (Pacific): legs, testable, crossing');
  for (const [year, y] of [...o.legsByYear].sort()) out.push(`  ${year}  ${String(y.legs).padStart(6)} ${String(y.testable).padStart(6)} ${String(y.crossing).padStart(5)}  ${percent(y.crossing, y.testable)}`);
  out.push('');
  out.push('Land crossed, per crossing');
  for (const [label, lo, hi] of [['under 1 km', 0, 1000], ['1-3 km', 1000, 3000], ['3-10 km', 3000, 10000], ['over 10 km', 10000, Infinity]] as const)
    out.push(`  ${label.padEnd(11)} ${String(found.filter(c => c.crossedM >= lo && c.crossedM < hi).length).padStart(5)}`);
  out.push('');
  const groups = new Map<string, FoundCrossing[]>();
  for (const c of found) {
    const key = `${c.island ?? '?'}: ${c.from} -> ${c.to}`;
    groups.set(key, [...groups.get(key) ?? [], c]);
  }
  out.push('Top 15 places: nearest island (a hint), and the waters either side');
  for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 15)) {
    const median = list.map(c => c.crossedM).sort((a, b) => a - b)[Math.floor(list.length / 2)]!;
    out.push(`  ${String(list.length).padStart(4)}  ${key}  (median ${(median / 1000).toFixed(1)} km of land, ${new Set(list.map(c => c.day)).size} days)`);
  }
  out.push('');
  const perDay = new Map<string, FoundCrossing[]>();
  for (const c of found) perDay.set(c.day, [...perDay.get(c.day) ?? [], c]);
  const examples = [...perDay].sort((a, b) => b[1].length - a[1].length || b[1].reduce((s, c) => s + c.crossedM, 0) - a[1].reduce((s, c) => s + c.crossedM, 0)).slice(0, 5);
  out.push('Example days with the most crossings (the longest crossing of each is linked)');
  for (const [day, list] of examples) {
    const longest = list.toSorted((a, b) => b.crossedM - a.crossedM)[0]!;
    out.push(`  ${day}  ${list.length} crossings, ${(list.reduce((s, c) => s + c.crossedM, 0) / 1000).toFixed(1)} km of land in all`);
    out.push(`    longest: ${(longest.crossedM / 1000).toFixed(1)} km beside ${longest.island ?? '?'}, ${longest.from} -> ${longest.to}`);
    out.push(`    https://salishsea.io/?d=${day}&o=${longest.to_id}`);
  }
  out.push('');
  out.push('Longest single crossings');
  for (const c of found.toSorted((a, b) => b.crossedM - a.crossedM).slice(0, 5))
    out.push(`  ${(c.crossedM / 1000).toFixed(1)} km of a ${(c.legM / 1000).toFixed(1)} km leg, ${c.day}, beside ${c.island ?? '?'}, ${c.from} -> ${c.to}  https://salishsea.io/?d=${c.day}&o=${c.to_id}`);
  return out.join('\n');
}

/** A basemap list, from `file` when given, else from the URL the site's style names, kept in the temp directory. */
async function list<T>(key: 'regions' | 'osm', file: string | undefined): Promise<T> {
  let where = file;
  if (!where) {
    const style = path.resolve(import.meta.dirname, '../../src/basemap-style.json');
    where = path.join(os.tmpdir(), 'salishsea-segments', `places-${key}.json`);
    fs.mkdirSync(path.dirname(where), {recursive: true});
    await fetchPlaceList(style, key, where);
  }
  return JSON.parse(fs.readFileSync(where, 'utf8')) as T;
}

if (import.meta.main) {
  const {values: args} = parseArgs({options: {
    since: {type: 'string', default: '2022-01-01'},
    day: {type: 'string'},
    refresh: {type: 'boolean', default: false},
    from: {type: 'string', default: DEFAULT_FROM},
    regions: {type: 'string'},
    osm: {type: 'string'},
    json: {type: 'string'},
  }});
  calendarDate('since', args.since);
  if (args.day) calendarDate('day', args.day);
  const since = args.day ?? args.since;

  const {regionAt} = waterRegions(await list<RegionList>('regions', args.regions));
  const islands = readPlaces(await list<PlaceList>('osm', args.osm)).filter(p => p.kind === 'island');

  const rows = await loadRows(since, {from: args.from, refresh: args.refresh});
  const days = new Map<string, Sighting[]>();
  for (const r of rows) {
    if (args.day && r.day !== args.day) continue;
    days.set(r.day, [...days.get(r.day) ?? [], {...r, animals: new Set(r.animals)}]);
  }

  const found: FoundCrossing[] = [];
  const byYear = new Map<string, {legs: number; testable: number; crossing: number}>();
  let legs = 0, testable = 0;
  for (const [day, sightings] of days) {
    const year = byYear.get(day.slice(0, 4)) ?? byYear.set(day.slice(0, 4), {legs: 0, testable: 0, crossing: 0}).get(day.slice(0, 4))!;
    for (const track of RULES.current(sightings)) {
      const ordered = track.toSorted((a, b) => a.observed_at_ms - b.observed_at_ms);
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i - 1]!, b = ordered[i]!;
        legs++; year.legs++;
        const result = testLeg(a.location, b.location, regionAt);
        if (!result.testable) continue;
        testable++; year.testable++;
        if (result.crossings.length) year.crossing++;
        for (const c of result.crossings) {
          const island = nearestIsland(islands, c.midpoint);
          found.push({...c, day, from_id: a.id, to_id: b.id, legM: Math.round(result.lengthM), island: island?.name ?? null, islandKm: island ? Math.round(island.km * 10) / 10 : null});
        }
      }
    }
  }
  console.log(report({since, days: days.size, legs, testable, found, legsByYear: byYear}));
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(found, null, 1));
}
