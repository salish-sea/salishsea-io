import { expect, test } from 'vitest';
import { dayEncounters, type DayOccurrence } from './encounter.ts';

const report = (id: string, observed_at: string, lon: number, lat: number, identifiers: string[]) => ({
  id, observed_at, url: null, body: null, count: null, identifiers, vitality: null, location: {lon, lat}, photos: [],
  provider: 'Maplify', provider_slug: 'maplify', collection: 'Orca Network', direction: null, confirmation: 'confirmed',
  taxon: {scientific_name: 'Orcinus orca rectipinnus', vernacular_name: "Bigg's killer whale", species_id: 1, entity_id: null},
}) as unknown as DayOccurrence;

test("a calf first named on a track marks the encounter of each subject that wants it, its matriline's too (salish-fwyt.4.2)", () => {
  // newest first, as a day's file holds them: one track, the group named first, the calf later
  const rows = [report('b', '2026-10-01T17:30:00+00:00', -122.51, 47.34, ['T065A6']),
                report('a', '2026-10-01T17:00:00+00:00', -122.50, 47.33, ['T65As'])];
  const reportsOf = (id: string) => id === 'a' ? [{subject: 'T065As', via_group: null}, {subject: 'T065A6', via_group: 'T065A'}]
    : [{subject: 'T065A6', via_group: null}];
  const firstsOf = (id: string) => id === 'b' ? [{label: 'T065A6', born: 2026, subjects: ['T065A6', 'T065As']}] : [];
  const encounters = new Map(dayEncounters('2026-10-01', rows, reportsOf, firstsOf));
  expect(encounters.get('T065As')!.firsts).toEqual([{label: 'T065A6', born: 2026}]);
  expect(encounters.get('T065A6')!.firsts).toEqual([{label: 'T065A6', born: 2026}]);
  // and none without one
  expect(new Map(dayEncounters('2026-10-01', rows, reportsOf)).get('T065As')).not.toHaveProperty('firsts');
});
