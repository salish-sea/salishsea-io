/**
 * Discovery suite (salish-us33): properties of occurrences2segments (decision 063) over
 * small generated days, where times, places and species collide often enough that
 * segments actually join. The limits are checked here with an independent haversine,
 * not turf.
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import { ecotypesOf, occurrences2segments, type Segment } from './segments.ts';
import type { Occurrence } from './types.ts';

const T0 = Date.parse('2026-07-01T12:00:00Z');
const HOUR = 3_600_000;

const TAXA = [
  {scientific_name: 'Orcinus orca', species_id: 1},
  {scientific_name: 'Orcinus orca ater', species_id: 1},
  {scientific_name: 'Orcinus orca rectipinnus', species_id: 1},
  {scientific_name: 'Megaptera novaeangliae', species_id: 2},
  {scientific_name: 'Phoca vitulina', species_id: 3},  // no travel speed
  {scientific_name: null, species_id: null},
] as const;

const IDENTIFIERS = ['J', 'J27', 'K pod', 'L', 'T065A', 'T137As', "Bigg's", 'Southern Resident', 'BCY0324'];

type Shape = {minutes: number, x: number, y: number, taxon: number, identifiers: string[], vitality: Occurrence['vitality']};

const shape: fc.Arbitrary<Shape> = fc.record({
  // Half-hour steps over 15 h, so ties and the 12-hour limit both come up.
  minutes: fc.integer({min: 0, max: 30}).map(n => n * 30),
  // ~3.7 km by ~5.6 km steps: the 3 km allowance, the speed limit and 20 km all come up.
  x: fc.integer({min: 0, max: 6}),
  y: fc.integer({min: 0, max: 4}),
  taxon: fc.constantFrom(0, 0, 0, 1, 2, 3, 4, 5),
  identifiers: fc.subarray(IDENTIFIERS, {maxLength: 2}),
  vitality: fc.constantFrom(null, null, null, 'alive', 'dead', 'undetermined'),
});

function occurrence(s: Shape, i: number): Occurrence {
  const t = T0 + s.minutes * 60_000;
  const taxon = TAXA[s.taxon]!;
  return {
    id: `o${i}`, url: null, attribution: null, body: null, accuracy: null, certainty: null, collection: null,
    confirmation: 'unconfirmed', disagreements: null, vitality: s.vitality, contributor_id: null, count: null,
    direction: null, identifiers: s.identifiers.length ? s.identifiers : null,
    location: {lon: -123 + s.x * 0.05, lat: 48.5 + s.y * 0.05},
    observed_at: new Date(t).toISOString(), observed_from: null, observed_until: null, observer: null,
    organization: null, organization_url: null, photos: [], provider: null, provider_slug: null, source_url: null,
    taxon: {...taxon, vernacular_name: null, entity_id: null},
    observed_at_ms: t,
  };
}

const day = fc.array(shape, {maxLength: 14}).map(shapes => shapes.map(occurrence));

/** Great-circle metres, written out rather than borrowed from turf. */
function metres(a: Occurrence, b: Occurrence): number {
  const R = 6_371_008.8, rad = Math.PI / 180;
  const dLat = (b.location.lat - a.location.lat) * rad, dLon = (b.location.lon - a.location.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.location.lat * rad) * Math.cos(b.location.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const speeds: Record<string, number> = {'Orcinus orca': 6.8, 'Orcinus orca ater': 6.6, 'Orcinus orca rectipinnus': 6.8, 'Megaptera novaeangliae': 5};

const grouping = (segments: Segment[]) => segments.map(s => s.occurrences.map(o => o.id));
const canonical = (groups: string[][]) => groups.map(g => [...g].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));

describe('occurrences2segments', () => {
  test('every occurrence lands in exactly one segment, and each segment keeps the rules', () => {
    let joined = 0, cases = 0;
    fc.assert(fc.property(day, occurrences => {
      cases++;
      const segments = occurrences2segments(occurrences);
      expect(segments.flatMap(s => s.occurrences.map(o => o.id)).sort()).toEqual(occurrences.map(o => o.id).sort());
      for (const {occurrences: members, expectedTravelSpeedKmph, taxon, lastOccurrenceAt} of segments) {
        expect(taxon).toBe(members.at(-1)!.taxon);
        expect(lastOccurrenceAt.getTime()).toBe(members.at(-1)!.observed_at_ms);
        if (members.length > 1) joined++;
        const first = members[0]!;
        // A segment with no speed (a dead animal, a seal, no name) takes nothing.
        if (members.length > 1) {
          expect(expectedTravelSpeedKmph).toBeTruthy();
          expect(first.vitality).not.toBe('dead');
        }
        if (first.vitality === 'dead') expect(members).toHaveLength(1);
        for (let i = 1; i < members.length; i++) {
          const prev = members[i - 1]!, o = members[i]!;
          expect(o.vitality).not.toBe('dead');
          expect(o.taxon.species_id).toBe(first.taxon.species_id);
          expect(o.taxon.species_id).not.toBeNull();
          const hours = (o.observed_at_ms - prev.observed_at_ms) / HOUR;
          expect(hours).toBeGreaterThanOrEqual(0);
          expect(hours).toBeLessThanOrEqual(12);
          const m = metres(prev, o);
          expect(m).toBeLessThanOrEqual(20_000 + 1);
          if (m > 3000 + 1) expect((m - 3000) / hours).toBeLessThanOrEqual(3 * speeds[first.taxon.scientific_name!]! * 1000 * 1.001);
          // The ecotype rule, against the members it joined.
          const mine = ecotypesOf(o);
          const theirs = new Set(members.slice(0, i).flatMap(p => [...ecotypesOf(p)]));
          if (mine.size && theirs.size) expect([...mine].some(e => theirs.has(e))).toBe(true);
        }
        expect(expectedTravelSpeedKmph).toBe(first.vitality === 'dead' ? null : speeds[first.taxon.scientific_name ?? ''] ?? null);
      }
    }), {numRuns: 2000});
    // The generator has to make joins for the checks above to mean anything.
    expect(joined / cases).toBeGreaterThan(0.3);
  });

  // Completeness as well as soundness: the comment's greedy rule, written out again, joins
  // exactly what the implementation joins (a mutant that refuses admissible joins passes the
  // checks above).
  test('groups as the greedy rule in the comment does', () => {
    const named = (o: Occurrence) => {
      const out = new Set<string>();
      const sub = o.taxon.scientific_name?.split(' ')[2];
      if (sub === 'ater') out.add('resident');
      if (sub === 'rectipinnus') out.add('biggs');
      for (const id of o.identifiers ?? []) {
        if (/^[JKL](\d|\s*pod|$)/i.test(id) || /resident/i.test(id)) out.add('resident');
        else if (/^T\d/.test(id) || /bigg/i.test(id)) out.add('biggs');
      }
      return out;
    };
    const model = (occurrences: Occurrence[]) => {
      const tracks: {speed: number | null, members: Occurrence[]}[] = [];
      for (const o of occurrences.toSorted((a, b) => a.observed_at_ms - b.observed_at_ms)) {
        let best: (typeof tracks)[number] | null = null, bestScore = Infinity;
        if (o.vitality !== 'dead') for (const track of tracks) {
          const first = track.members[0]!, last = track.members.at(-1)!;
          if (!track.speed || first.taxon.species_id === null || first.taxon.species_id !== o.taxon.species_id) continue;
          const hours = (o.observed_at_ms - last.observed_at_ms) / HOUR;
          const m = metres(last, o);
          if (hours > 12 || m > 20_000) continue;
          if (Math.max(0, m - 3000) / hours > 3 * track.speed * 1000) continue;
          const mine = named(o), theirs = new Set(track.members.flatMap(p => [...named(p)]));
          if (mine.size && theirs.size && ![...mine].some(e => theirs.has(e))) continue;
          const score = m / 1000 + track.speed * hours;
          if (score < bestScore) { best = track; bestScore = score; }
        }
        if (best) best.members.push(o);
        else tracks.push({speed: o.vitality === 'dead' ? null : speeds[o.taxon.scientific_name ?? ''] ?? null, members: [o]});
      }
      return tracks.map(t => t.members.map(o => o.id));
    };
    fc.assert(fc.property(day, occurrences => {
      expect(grouping(occurrences2segments(occurrences))).toEqual(model(occurrences));
    }), {numRuns: 3000});
  });

  test('the order of the input does not matter when no two reports share an instant', () => {
    const distinct = fc.uniqueArray(shape, {selector: s => s.minutes, maxLength: 14}).map(s => s.map(occurrence));
    fc.assert(fc.property(distinct, fc.infiniteStream(fc.nat()), (occurrences, randoms) => {
      const shuffled = occurrences.map(o => [randoms.next().value, o] as const).sort((a, b) => a[0] - b[0]).map(([, o]) => o);
      expect(grouping(occurrences2segments(shuffled))).toEqual(grouping(occurrences2segments(occurrences)));
    }), {numRuns: 1000});
  });

  test('a report of an unrelated species changes nobody else\'s segment', () => {
    fc.assert(fc.property(day, shape, fc.nat(), (occurrences, s, at) => {
      const intruder = {...occurrence({...s, taxon: 3}, 999), taxon: {scientific_name: 'Eschrichtius robustus', species_id: 99, vernacular_name: null, entity_id: null}};
      const withIt = occurrences.toSpliced(at % (occurrences.length + 1), 0, intruder);
      const others = canonical(grouping(occurrences2segments(withIt)).map(g => g.filter(id => id !== 'o999')).filter(g => g.length));
      expect(others).toEqual(canonical(grouping(occurrences2segments(occurrences))));
    }), {numRuns: 1000});
  });

  test('removing a dead animal changes nobody else\'s segment', () => {
    fc.assert(fc.property(day, occurrences => {
      const alive = occurrences.filter(o => o.vitality !== 'dead');
      const without = canonical(grouping(occurrences2segments(alive)));
      const withDead = canonical(grouping(occurrences2segments(occurrences)).map(g => g.filter(id => alive.some(o => o.id === id))).filter(g => g.length));
      expect(withDead).toEqual(without);
    }), {numRuns: 1000});
  });

  // Not a promise of the contract, measured: with ties, does the grouping depend on input order?
  (process.env['MEASURE'] ? test : test.skip)('(measurement) ties in observed_at make the grouping depend on input order', () => {
    let differs = 0;
    fc.assert(fc.property(day, fc.infiniteStream(fc.nat()), (occurrences, randoms) => {
      const shuffled = occurrences.map(o => [randoms.next().value, o] as const).sort((a, b) => a[0] - b[0]).map(([, o]) => o);
      if (JSON.stringify(canonical(grouping(occurrences2segments(shuffled)))) !== JSON.stringify(canonical(grouping(occurrences2segments(occurrences))))) differs++;
    }), {numRuns: 2000});
    process.stderr.write(`MEASURE order-dependent groupings with ties: ${differs} / 2000\n`);
    const witness = fc.check(fc.property(day, occurrences => {
      const reversed = occurrences.toReversed();
      return JSON.stringify(canonical(grouping(occurrences2segments(reversed)))) === JSON.stringify(canonical(grouping(occurrences2segments(occurrences))));
    }), {numRuns: 5000});
    if (witness.failed) process.stderr.write(`MEASURE witness ${JSON.stringify(witness.counterexample![0]!.map(o => [o.id, o.observed_at.slice(11, 16), o.location, o.taxon.scientific_name, o.identifiers]))}\n`);
  });

  (process.env['MEASURE'] ? test : test.skip)('(measurement) segments holding both a resident-only and a Bigg\'s-only report', () => {
    let mixed = 0;
    fc.assert(fc.property(day, occurrences => {
      for (const {occurrences: m} of occurrences2segments(occurrences)) {
        const sets = m.map(o => ecotypesOf(o));
        if (sets.some(s => s.size === 1 && s.has('resident')) && sets.some(s => s.size === 1 && s.has('biggs'))) { mixed++; break; }
      }
    }), {numRuns: 2000});
    process.stderr.write(`MEASURE days with a mixed segment: ${mixed} / 2000\n`);
    const witness = fc.check(fc.property(day, occurrences => occurrences2segments(occurrences).every(({occurrences: m}) => {
      const sets = m.map(o => ecotypesOf(o));
      return !(sets.some(s => s.size === 1 && s.has('resident')) && sets.some(s => s.size === 1 && s.has('biggs')));
    })), {numRuns: 5000});
    if (witness.failed) process.stderr.write(`MEASURE witness ${JSON.stringify(witness.counterexample![0]!.map(o => [o.id, o.observed_at.slice(11, 16), o.location, o.taxon.scientific_name, o.identifiers]))}\n`);
  });
});
