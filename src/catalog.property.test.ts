/**
 * Discovery suite (salish-us33): src/catalog.ts's link deduplication, monthly presence,
 * group ancestry and path helpers, each against a model written from its comment.
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import {
  dedupeOccurrenceLinks, descendantMatrilines, groupChain, individualPath, matrilinePath, monthlyPresence, slugify,
  type SocialGroup,
} from './catalog.ts';

/** An instant as the build writes it (derive/shared.sql's pg_ts): UTC, fraction trimmed, '+00:00'. */
function pgTs(ms: number, micros: number): string {
  const whole = new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19);
  const fraction = micros ? '.' + String(micros).padStart(6, '0').replace(/0+$/, '') : '';
  return `${whole}${fraction}+00:00`;
}
const T0 = Date.parse('2026-07-01T12:00:00Z');
const instant = fc.record({s: fc.integer({min: 0, max: 5}), micros: fc.constantFrom(0, 0, 250_000, 500_000, 123_456)})
  .map(({s, micros}) => pgTs(T0 + s * 1000, micros));
const epochMicros = (ts: string) => {
  const m = /^(.{19})(?:\.(\d+))?\+00:00$/.exec(ts)!;
  return Date.parse(`${m[1]}Z`) * 1000 + Number((m[2] ?? '').padEnd(6, '0'));
};

// What an occurrence carries is the same on every row of it; only the claim differs.
const occurrenceFacts = fc.record({
  observed_at: instant,
  location: fc.constantFrom(null, {lon: -123, lat: 48.5}, {lon: null, lat: 48.5}),
  vitality: fc.constantFrom(undefined, 'dead', 'alive'),
});
const rows = (maxLength: number) => fc.tuple(fc.array(occurrenceFacts, {minLength: 4, maxLength: 4}), fc.array(fc.record({
  occurrence: fc.integer({min: 0, max: 3}),
  is_present: fc.constantFrom(true, true, false, null),
  status: fc.constantFrom('candidate', 'confirmed', 'rejected'),
  via_group: fc.constantFrom(null, null, undefined, 'T065As', 'T065A2s', 'J pod'),
}), {maxLength})).map(([facts, claims]) => claims.map(({occurrence, via_group, ...claim}) => {
  const {vitality, ...fact} = facts[occurrence]!;
  return {occurrence_id: 'abcd'[occurrence]!, ...fact, ...claim, ...(via_group === undefined ? {} : {via_group}), ...(vitality ? {vitality} : {})};
})) as unknown as fc.Arbitrary<Row[]>;
type Row = Parameters<typeof dedupeOccurrenceLinks>[0][number];

/** The comment's rule, written out: present and unrejected; a direct claim, else the first group A–Z. */
function modelDedupe(rows: Row[]) {
  const kept = rows.filter(r => r.occurrence_id && r.observed_at && r.status && r.is_present !== false && r.status !== 'rejected');
  const ids = [...new Set(kept.map(r => r.occurrence_id))];
  return ids.map(id => {
    const mine = kept.filter(r => r.occurrence_id === id);
    const chosen = mine.find(r => !r.via_group)
      ?? mine.reduce((best, r) => (r.via_group! < best.via_group! ? r : best));
    return {id, via_group: chosen.via_group ?? null, status: chosen.status, at: chosen.observed_at};
  });
}

describe('dedupeOccurrenceLinks', () => {
  test('keeps one link per occurrence, the one the comment says, newest first', () => {
    fc.assert(fc.property(rows(12), rows => {
      const links = dedupeOccurrenceLinks(rows);
      const model = modelDedupe(rows);
      expect(links.map(l => l.occurrence_id).sort()).toEqual(model.map(m => m.id).sort());
      for (const l of links) {
        const m = model.find(m => m.id === l.occurrence_id)!;
        expect(l.via_group).toBe(m.via_group);
        expect(l.status).toBe(m.status);
        expect(l.observed_at).toBe(m.at);
        expect(l.is_present).toBe(true);
      }
      // Newest first, by the instant the string names.
      for (let i = 1; i < links.length; i++)
        expect(epochMicros(links[i - 1]!.observed_at)).toBeGreaterThanOrEqual(epochMicros(links[i]!.observed_at));
    }), {numRuns: 3000});
  });

  test('is idempotent', () => {
    fc.assert(fc.property(rows(12), rows => {
      const once = dedupeOccurrenceLinks(rows);
      expect(dedupeOccurrenceLinks(once)).toEqual(once);
    }), {numRuns: 1000});
  });

  test('row order does not choose the link when no two claims share an occurrence and a group', () => {
    // One claim per (occurrence, group): two claims through the same group, or two direct
    // ones, are left to row order, which the comment doesn't rule out (see the measurement).
    const distinct = rows(12).map(rs => rs.filter((r, i) =>
      rs.findIndex(q => q.occurrence_id === r.occurrence_id && (q.via_group ?? null) === (r.via_group ?? null)) === i));
    fc.assert(fc.property(distinct, rs => {
      const key = (ls: ReturnType<typeof dedupeOccurrenceLinks>) => ls.map(l => JSON.stringify(l)).sort();
      expect(key(dedupeOccurrenceLinks(rs.toReversed()))).toEqual(key(dedupeOccurrenceLinks(rs)));
    }), {numRuns: 2000});
  });
});

describe('monthlyPresence', () => {
  // Instants near the Pacific month and year edges, both offsets.
  const edges = ['2024-01-01T08:00:00Z', '2025-01-01T08:00:00Z', '2026-01-01T08:00:00Z', '2026-03-01T08:00:00Z',
    '2026-03-08T10:00:00Z', '2026-11-01T07:00:00Z', '2026-12-01T08:00:00Z', '2027-01-01T08:00:00Z'].map(Date.parse);
  const at = fc.record({edge: fc.constantFrom(...edges), offset: fc.integer({min: -3, max: 3})})
    .map(({edge, offset}) => new Date(edge + offset * 1000).toISOString());
  const pacific = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric'});

  test('counts each link in its Pacific month, for the trailing years newest first', () => {
    fc.assert(fc.property(fc.array(at, {maxLength: 20}), fc.integer({min: 0, max: 4}), fc.constantFrom(2025, 2026, 2027),
      (instants, years, currentYear) => {
        const grid = monthlyPresence(instants.map(observed_at => ({observed_at})), years, currentYear);
        expect(grid.map(r => r.year)).toEqual(Array.from({length: years}, (_, i) => currentYear - i));
        for (const {year, months} of grid) {
          const expected = new Array(12).fill(0);
          for (const t of instants) {
            const parts = Object.fromEntries(pacific.formatToParts(new Date(t)).map(p => [p.type, p.value]));
            if (Number(parts['year']) === year) expected[Number(parts['month']) - 1]++;
          }
          expect(months).toEqual(expected);
        }
      }), {numRuns: 2000});
  });
});

describe('groupChain and descendantMatrilines', () => {
  // Small id space, parents anywhere (including missing ids, itself, and cycles).
  const groups = fc.array(fc.record({
    parent: fc.option(fc.integer({min: 1, max: 9}), {nil: null}),
    kind: fc.constantFrom('matriline', 'matriline', 'ecotype', 'pod', 'community'),
    designation: fc.constantFrom('T065A', 'T065A2', 'J', 'Biggs', 'T137', 't137', 'Ä'),
  }), {maxLength: 8}).map(gs => new Map(gs.map((g, i) => [i + 1, {
    id: i + 1, parent_group_id: g.parent, kind: g.kind, designation: g.designation,
  } as unknown as SocialGroup])));

  const modelChain = (id: number, byId: Map<number, SocialGroup>, seen: number[] = []): number[] =>
    seen.includes(id) || !byId.has(id) ? [] : [id, ...(byId.get(id)!.parent_group_id === null ? [] : modelChain(byId.get(id)!.parent_group_id!, byId, [...seen, id]))];

  test('groupChain walks parents from the group itself and stops at a cycle or a missing parent', () => {
    fc.assert(fc.property(groups, fc.integer({min: 1, max: 10}), (byId, id) => {
      expect(groupChain(id, byId).map(g => g.id)).toEqual(modelChain(id, byId));
    }), {numRuns: 2000});
  });

  test('descendantMatrilines is every matriline with the ecotype in its chain, A–Z', () => {
    fc.assert(fc.property(groups, fc.integer({min: 1, max: 9}), (byId, ecotype) => {
      const got = descendantMatrilines(ecotype, byId).map(g => g.id);
      const want = [...byId.values()].filter(g => g.kind === 'matriline' && modelChain(g.id, byId).includes(ecotype)).map(g => g.id);
      expect([...got].sort()).toEqual([...want].sort());
      const names = got.map(id => byId.get(id)!.designation);
      for (let i = 1; i < names.length; i++) expect(names[i - 1]!.localeCompare(names[i]!)).toBeLessThanOrEqual(0);
    }), {numRuns: 2000});
  });
});

describe('profile paths', () => {
  const designation = fc.string({unit: fc.constantFrom('T', '0', '6', 'A', 's', "'", '’', ' ', '-', '/', '?', '#', '%', 'é', '.', 'J'), maxLength: 10});
  test('slugify is idempotent, URL-safe, and keeps every ASCII letter and digit in order', () => {
    fc.assert(fc.property(fc.oneof(designation, fc.string()), d => {
      const slug = slugify(d);
      expect(slug).toMatch(/^([A-Za-z0-9]+(-[A-Za-z0-9]+)*)?$/);
      expect(slugify(slug)).toBe(slug);
      expect(slug.replace(/-/g, '')).toBe(d.replace(/[^A-Za-z0-9]/g, ''));
    }), {numRuns: 2000});
  });

  test('a path keys on the identifier, or round-trips the designation when there is none', () => {
    fc.assert(fc.property(fc.option(fc.integer({min: 1, max: 9_999_999}), {nil: null}), designation, (n, d) => {
      const entity_id = n === null ? null : `SSA:${String(n).padStart(7, '0')}`;
      for (const [path, prefix, written] of [
        [individualPath({entity_id, primary_designation: d}), 'individuals', d],
        [matrilinePath({entity_id, designation: d}), 'matrilines', d],
      ] as const) {
        const segments = path.split('/');
        expect(segments[1]).toBe(prefix);
        if (entity_id) {
          expect(segments[2]).toBe(entity_id.slice(4));
          expect(segments.length).toBeLessThanOrEqual(4);
        } else {
          expect(segments).toHaveLength(3);
          expect(decodeURIComponent(segments[2]!)).toBe(written);
        }
      }
    }), {numRuns: 2000});
  });
});
