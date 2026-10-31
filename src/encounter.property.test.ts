/**
 * Discovery suite (salish-us33): dayEncounters (decision 098) against a summary written
 * out from Encounter's field comments, over small generated days.
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import { channelOf, dayEncounters, type DayOccurrence, type SubjectReport } from './encounter.ts';
import { occurrences2segments } from './segments.ts';
import type { Occurrence } from './types.ts';

const T0 = Date.parse('2026-07-01T12:00:00Z');
const SUBJECTS = ['individuals/0010197.json', 'individuals/0010193.json', 'matrilines/0002163.json'];

const report = fc.record({
  minutes: fc.integer({min: 0, max: 12}).map(n => n * 30),
  x: fc.integer({min: 0, max: 3}),
  orca: fc.boolean(),
  provider: fc.constantFrom(['direct', null, 'SalishSea.io Direct'], ['maplify', 'Orca Network', 'Maplify'], ['maplify', null, 'Maplify'], ['inaturalist', null, null]),
  identifiers: fc.constantFrom(null, [], ['T065A'], ['T065As', 'T065A5']),
  photos: fc.integer({min: 0, max: 2}),
  place: fc.constantFrom(undefined, null, 'Haro Strait', 'Boundary Pass'),
  subjects: fc.subarray(SUBJECTS.map((subject, i) => ({subject, via_group: i === 0 ? null : 'T065As'})), {maxLength: 2})
    .chain(rs => fc.tuple(...rs.map(r => fc.constantFrom(r, {...r, via_group: null})))),
});

const dayRows = fc.array(report, {maxLength: 12}).map(rs => rs.map((r, i) => {
  const t = T0 + r.minutes * 60_000;
  const [provider_slug, collection, provider] = r.provider;
  const row: DayOccurrence = {
    id: `o${i}`, url: i % 2 ? `https://example.org/${i}` : null, attribution: null, body: null, accuracy: null,
    certainty: null, collection, confirmation: 'unconfirmed', disagreements: null, vitality: null, contributor_id: null,
    count: null, direction: null, identifiers: r.identifiers, location: {lon: -123 + r.x * 0.03, lat: 48.5},
    observed_at: new Date(t).toISOString(), observed_from: null, observed_until: null, observer: null,
    organization: null, organization_url: null,
    photos: Array.from({length: r.photos}, (_, k) => ({src: `p${i}-${k}.jpg`, thumb: null, attribution: null, mimetype: null, license: null})),
    provider, provider_slug, source_url: null,
    taxon: r.orca ? {scientific_name: 'Orcinus orca', species_id: 1, vernacular_name: null, entity_id: null}
      : {scientific_name: 'Megaptera novaeangliae', species_id: 2, vernacular_name: null, entity_id: null},
    ...(r.place === undefined ? {} : {place: r.place}),
  };
  return {row, subjects: r.subjects as SubjectReport<string>[]};
}));

describe('dayEncounters', () => {
  test('each subject\'s reports fall in exactly one encounter, summarized as its fields say', () => {
    let multi = 0;
    fc.assert(fc.property(dayRows, day => {
      const rows = day.map(d => d.row);
      const reportsOf = new Map(day.map(d => [d.row.id, d.subjects]));
      const encounters = dayEncounters('2026-07-01', rows, id => reportsOf.get(id) ?? []);
      const segments = occurrences2segments(rows.map(r => ({...r, observed_at_ms: Date.parse(r.observed_at)}) as Occurrence));
      const segmentOf = (id: string) => segments.find(s => s.occurrences.some(o => o.id === id))!.occurrences;

      for (const subject of SUBJECTS) {
        const mine = encounters.filter(([s]) => s === subject).map(([, e]) => e);
        const reported = day.filter(d => d.subjects.some(r => r.subject === subject)).map(d => d.row.id);
        expect(mine.flatMap(e => e.ids).sort()).toEqual([...reported].sort());
        for (const e of mine) {
          if (e.reports > 1) multi++;
          const segment = segmentOf(e.ids[0]!);
          for (const id of e.ids) expect(segmentOf(id)).toBe(segment);
          expect(e.reports).toBe(segment.length);
          expect(e.start).toBe(segment[0]!.observed_at);
          expect(e.end).toBe(segment.at(-1)!.observed_at);
          expect(Date.parse(e.start)).toBeLessThanOrEqual(Date.parse(e.end));
          // Oldest first.
          const at = e.ids.map(id => Date.parse(rows.find(r => r.id === id)!.observed_at));
          expect(at).toEqual([...at].sort((a, b) => a - b));
          expect(e.as_self).toBe(e.ids.filter(id => reportsOf.get(id)!.some(r => r.subject === subject && !r.via_group)).length);
          expect(e.identifiers).toEqual(segment.filter(o => o.identifiers?.length).map(o => o.identifiers));
          expect(e.photos.map(p => p.src)).toEqual(segment.flatMap(o => o.photos.map(p => p.src)));
          for (const p of e.photos) expect(p.href).toBe(segment.find(o => o.photos.some(q => q.src === p.src))!.url ?? p.src);
          const counts = new Map<string, number>();
          for (const o of segment) counts.set(channelOf(o), (counts.get(channelOf(o)) ?? 0) + 1);
          expect(Object.fromEntries(e.channels)).toEqual(Object.fromEntries(counts));
          for (let i = 1; i < e.channels.length; i++) expect(e.channels[i - 1]![1]).toBeGreaterThanOrEqual(e.channels[i]![1]);
          expect(e.location).toEqual(segment[Math.floor(segment.length / 2)]!.location);
          // The place most of its reports were in, the earliest of a tie.
          const places = segment.map(o => o.place).filter(Boolean) as string[];
          const best = Math.max(0, ...places.map(p => places.filter(q => q === p).length));
          expect(e.place).toBe(places.find(p => places.filter(q => q === p).length === best) ?? null);
        }
      }
    }), {numRuns: 2000});
    expect(multi).toBeGreaterThan(200);
  });
});
