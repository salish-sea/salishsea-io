// What a day card says about the sightings in its frame, and the travel lines it draws
// under them. Everything here reads fields the read-path build already wrote into the
// day's file; nothing is worked out again.

import type { Occurrence } from './data.js';
import type { LonLat } from './mercator.js';

/**
 * The water region the sightings were in, as the build names each one ("Puget Sound",
 * "Haro Strait"): the fewest regions, at most two, that hold more than half of the
 * sightings, most first. Null when no region holds them, as when they are spread across
 * the coast, so that a card framed on the whole sea doesn't name one corner of it.
 */
export function placeInFocus(occurrences: readonly Occurrence[]): string | null {
  const counts = new Map<string, number>();
  for (const { place } of occurrences) if (place) counts.set(place, (counts.get(place) ?? 0) + 1);
  // A Map keeps the order names were first seen in, and sort is stable, so a tie goes to the first seen.
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  let held = 0;
  for (let i = 0; i < Math.min(ranked.length, 2); i++) {
    held += ranked[i]![1];
    if (held * 2 > occurrences.length) return ranked.slice(0, i + 1).map(([name]) => name).join(' and ');
  }
  return null;
}

/** A pod's tag as a bout writes it, or a code as the catalogue writes one ("T65A5", "J27s", "CRC56"). */
const NAMED = /^(?:[JKL] pod|[A-Z]{1,4}\d[A-Za-z0-9]*)$/;
const MAX_NAMES = 3;

/** How long the line of animals may run before the card would cut it off (chrome.ts). */
export const MAX_ANIMALS_CHARS = 60;

/**
 * The animals the sightings name, most named first: the pods their text names, then the
 * animals they name with certainty. A possible one ("K pod?") and a population's name
 * ("Southern Resident"), which the species already says, are left out.
 */
function namedAnimals(occurrences: readonly Occurrence[]): string {
  const pods = new Set<string>();
  const codes = new Map<string, number>();
  for (const o of occurrences) {
    for (const pod of o.pods ?? []) pods.add(pod);
    for (const id of o.identifiers ?? []) {
      if (!NAMED.test(id)) continue;
      const pod = id.match(/^([JKL]) pod$/);
      // Reporters pad some codes with a zero ("T046Bs" for T46Bs); one animal is named once.
      const code = id.replace(/^([A-Z]+)0+(?=\d)/, '$1');
      if (pod) pods.add(pod[1]!);
      else codes.set(code, (codes.get(code) ?? 0) + 1);
    }
  }
  const names: string[] = [];
  const letters = [...pods].sort();
  if (letters.length === 1) names.push(`${letters[0]} pod`);
  else if (letters.length > 1) names.push(`${list(letters)} pods`);
  names.push(...[...codes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code]) => code));
  return names.length > MAX_NAMES ? `${names.slice(0, MAX_NAMES).join(', ')}…` : names.join(', ');
}

/** "J", "J and K", "J, K and L". */
function list(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * The animals in the frame, a species to an item, most reported first, each with the
 * animals its reports name: "Southern Resident killer whales (J pod) · Humpback whales".
 * Where one species is reported under a general name and a narrower one ("Killer whale"
 * and "Southern Resident killer whale"), the narrower stands for both; where under two
 * narrower ones (Bigg's and Southern Residents), the general one does. Two species under
 * one name are one item. Items that would run past `maxChars` are left off whole, and
 * "and more" says so.
 */
export function animalsInFocus(occurrences: readonly Occurrence[], maxChars = MAX_ANIMALS_CHARS): string | null {
  const bySpecies = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const key = o.speciesId != null ? `id:${o.speciesId}` : `name:${o.species}`;
    bySpecies.set(key, [...bySpecies.get(key) ?? [], o]);
  }
  const byName = new Map<string, Occurrence[]>();
  for (const reports of bySpecies.values()) {
    const name = plural(speciesName(reports));
    byName.set(name, [...byName.get(name) ?? [], ...reports]);
  }
  const items = [...byName]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, reports]) => {
      const named = namedAnimals(reports);
      return named ? `${name} (${named})` : name;
    });
  if (!items.length) return null;
  let line = items[0]!;
  for (const [i, item] of items.slice(1).entries()) {
    const rest = i + 2 < items.length ? ' · and more' : '';
    // "and more" goes only where it fits: a first item that fills the line stands alone.
    if (`${line} · ${item}${rest}`.length > maxChars) return `${line} · and more`.length > maxChars ? line : `${line} · and more`;
    line = `${line} · ${item}`;
  }
  return line;
}

function speciesName(reports: readonly Occurrence[]): string {
  const counts = new Map<string, number>();
  for (const { species } of reports) counts.set(species, (counts.get(species) ?? 0) + 1);
  const names = [...counts.keys()];
  const general = names.filter(n => names.some(m => m !== n && m.toLowerCase().endsWith(` ${n.toLowerCase()}`)));
  const narrow = names.filter(n => !general.includes(n));
  if (narrow.length === 1) return narrow[0]!;
  if (general.length) return general.reduce((a, b) => (a.length <= b.length ? a : b));
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
}

/** The card's plural, as its occurrence caption has always made it ("3 Orcas"). */
const plural = (name: string) => (name.endsWith('s') ? name : `${name}s`);

/**
 * Each travel segment's line, oldest report first, as the map draws it (src/segments.ts,
 * segment2travelLine): report to report, along the route by sea where the build wrote
 * one. Only segments with two or more reports have a line.
 */
export function travelLines(occurrences: readonly Occurrence[]): LonLat[][] {
  const bySegment = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    if (o.segment === undefined || !o.location) continue;
    bySegment.set(o.segment, [...bySegment.get(o.segment) ?? [], o]);
  }
  const lines: LonLat[][] = [];
  for (const reports of bySegment.values()) {
    if (reports.length < 2) continue;
    reports.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const line: LonLat[] = [];
    for (const r of reports) {
      const previous = line.at(-1);
      // A leg runs from the report before this one; one that starts elsewhere is drawn straight.
      if (previous && r.leg && r.leg.length > 2 && near(r.leg[0]!, previous))
        line.push(...r.leg.slice(1, -1).map(([lon, lat]) => ({ lon, lat })));
      line.push(r.location!);
    }
    lines.push(line);
  }
  return lines;
}

const near = ([lon, lat]: [number, number], p: LonLat) => Math.abs(lon - p.lon) < 1e-6 && Math.abs(lat - p.lat) < 1e-6;

/** The newest report of each segment, which the map draws larger as the head of its track. */
export function segmentHeads(occurrences: readonly Occurrence[]): Set<string> {
  const heads = new Map<string, Occurrence>();
  for (const o of occurrences) {
    if (o.segment === undefined) continue;
    const head = heads.get(o.segment);
    if (!head || Date.parse(o.observedAt) > Date.parse(head.observedAt)) heads.set(o.segment, o);
  }
  return new Set([...heads.values()].map(o => o.id));
}
