/**
 * Candidate rules for joining a day's sightings into travel segments, for
 * comparison against the map's own rule (#445, decision 062).
 *
 * None of these is used by the map. They exist so `compare.ts` can measure them
 * against `src/segments.ts` over real days, and so the cases that motivated them
 * stay pinned in `rules.test.ts`.
 *
 * Every rule admits a sighting to a track with the same test as `segments.ts`:
 * same species, within 12 hours and 20 km of the track's latest point, and no
 * faster than three times the species' speed after a 3 km allowance. They differ
 * in which track gets a sighting when more than one could take it.
 */
import {distance} from '@turf/distance';
import {travelSpeedFor} from '../../src/constants.ts';
import {occurrences2segments} from '../../src/segments.ts';
import type {Occurrence} from '../../src/types.ts';

const hour = 60 * 60 * 1000;

export type Sighting = {
  id: string;
  observed_at_ms: number;
  location: {lat: number; lon: number};
  taxon: {species_id: number | null; scientific_name: string};
  identifiers: string[];
  /** Registered animals the sighting names, with matrilines expanded to their members. */
  animals: Set<number>;
};
export type Track = Sighting[];
export type Rule = (sightings: Sighting[]) => Track[];

export const km = (a: Sighting, b: Sighting) =>
  distance([a.location.lon, a.location.lat], [b.location.lon, b.location.lat], {units: 'kilometers'});

/** The map's rule, unchanged. It reads only a sighting's id, time, place and taxon. */
export const current: Rule = sightings =>
  occurrences2segments(sightings as unknown as Occurrence[]).map(s => s.occurrences as unknown as Track);

/** The admission test of `segments.ts`, applied to one track's latest point. */
export function admits(start: Sighting, tail: Sighting, candidate: Sighting): boolean {
  const speed = travelSpeedFor(start.taxon.scientific_name);
  if (!start.taxon.species_id || !speed) return false;
  if (start.taxon.species_id !== candidate.taxon.species_id) return false;
  const dt = candidate.observed_at_ms - tail.observed_at_ms;
  if (dt < 0 || dt > 12 * hour) return false;
  const meters = km(tail, candidate) * 1000;
  if (meters > 20000) return false;
  // As in segments.ts, two sightings at the same instant give 0/0, which is NaN
  // and so never exceeds the limit: they join.
  const metersPerHour = Math.max(0, meters - 3000) / (dt / hour);
  return !(metersPerHour > 3.0 * speed * 1000);
}

/**
 * What a report says the animals were: Southern Residents or Bigg's, from the
 * taxon or from a named pod or ID (J, K, L or T). Empty when it says neither.
 */
export function ecotypesOf(s: Sighting): Set<'srkw' | 'biggs'> {
  const out = new Set<'srkw' | 'biggs'>();
  const sub = s.taxon.scientific_name.split(' ')[2];
  if (sub === 'ater') out.add('srkw');
  if (sub === 'rectipinnus') out.add('biggs');
  for (const id of s.identifiers) {
    if (/^[JKL](\d|\s*pod|$)/i.test(id) || /southern resident/i.test(id)) out.add('srkw');
    else if (/^T\d/.test(id) || /bigg/i.test(id)) out.add('biggs');
  }
  return out;
}

/** True when the sighting and the track each name an ecotype and they share none. */
function ecotypesDisagree(s: Sighting, track: Track): boolean {
  const mine = ecotypesOf(s);
  if (mine.size === 0) return false;
  const theirs = new Set(track.flatMap(t => [...ecotypesOf(t)]));
  return theirs.size > 0 && ![...mine].some(e => theirs.has(e));
}

/**
 * Build every track at once, oldest sighting first. Each sighting goes to the
 * admitting track whose latest point scores lowest, or starts a new track if
 * none admits it. Unlike the map's rule, a sighting passed over by one track is
 * still considered by the others.
 */
function bestFit(sightings: Sighting[], score: (tail: Sighting, s: Sighting) => number, checkEcotype: boolean): Track[] {
  const tracks: Track[] = [];
  for (const s of sightings.toSorted((a, b) => a.observed_at_ms - b.observed_at_ms)) {
    let best: Track | null = null;
    let bestScore = Infinity;
    for (const track of tracks) {
      const tail = track[track.length - 1]!;
      if (!admits(track[0]!, tail, s)) continue;
      if (checkEcotype && ecotypesDisagree(s, track)) continue;
      const value = score(tail, s);
      if (value < bestScore) {
        best = track;
        bestScore = value;
      }
    }
    if (best) best.push(s);
    else tracks.push([s]);
  }
  return tracks;
}

/** The track whose latest point is nearest. */
const byDistance = (tail: Sighting, s: Sighting) => km(tail, s);

/**
 * Nearest in space and time: each hour since the track's latest point counts as
 * the distance the species usually travels in an hour.
 */
const bySpaceTime = (tail: Sighting, s: Sighting) =>
  km(tail, s) + (travelSpeedFor(tail.taxon.scientific_name) ?? 0) * (s.observed_at_ms - tail.observed_at_ms) / hour;

export const nearest: Rule = s => bestFit(s, byDistance, false);
export const spaceTime: Rule = s => bestFit(s, bySpaceTime, false);
export const nearestEcotype: Rule = s => bestFit(s, byDistance, true);
export const spaceTimeEcotype: Rule = s => bestFit(s, bySpaceTime, true);

/**
 * Identity-preferred, with the ecotype check. Among the tracks that admit a
 * sighting, prefer one whose last six hours name an animal the sighting names;
 * then one naming nobody in that window; then one naming others. Nearest within
 * each tier. Named animals never forbid a join, because groups join and split
 * and observers name different members of the same group.
 *
 * `sees` says whose names the rule may read, so it can be graded on names it
 * was never shown.
 */
export function identityPreferred(sees: (s: Sighting) => boolean = () => true): Rule {
  const animals = (s: Sighting) => (sees(s) ? s.animals : new Set<number>());
  return sightings => {
    const tracks: Track[] = [];
    for (const s of sightings.toSorted((a, b) => a.observed_at_ms - b.observed_at_ms)) {
      const mine = animals(s);
      let best: Track | null = null;
      let bestTier = Infinity, bestKm = Infinity;
      for (const track of tracks) {
        const tail = track[track.length - 1]!;
        if (!admits(track[0]!, tail, s) || ecotypesDisagree(s, track)) continue;
        const recent = new Set(track
          .filter(t => s.observed_at_ms - t.observed_at_ms <= 6 * hour)
          .flatMap(t => [...animals(t)]));
        const tier = mine.size === 0 || recent.size === 0 ? 1 : [...mine].some(a => recent.has(a)) ? 0 : 2;
        const d = km(tail, s);
        if (tier < bestTier || (tier === bestTier && d < bestKm)) {
          best = track;
          bestTier = tier;
          bestKm = d;
        }
      }
      if (best) best.push(s);
      else tracks.push([s]);
    }
    return tracks;
  };
}

export const RULES = {
  current,
  nearest,
  spaceTime,
  nearestEcotype,
  spaceTimeEcotype,
  identity: identityPreferred(),
} satisfies Record<string, Rule>;
export type RuleName = keyof typeof RULES;
