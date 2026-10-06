import { describe, expect, test } from 'vitest';

import { overlayOwn, ownOccurrence, parseWriteSource, type OwnSighting } from './write-api.ts';

const sighting = (over: Partial<OwnSighting> = {}): OwnSighting => ({
  id: '01977c2a-b313-77a9-8433-ffccbd56bf57', observed_at: '2026-10-05T17:00:00.000000Z',
  location: {lon: -123.1, lat: 48.5}, observed_from: null, body: 'J35 and J47 heading north', count: 3,
  direction: 'north', url: null, entity_id: 'SSA:0000002', photos: [{src: 'https://salishsea.io/media/7/x/a.jpg', license: 'cc-by'}],
  contributor_id: 7, updated_at: '2026-10-05T17:01:00.000000Z', ...over,
});

describe('the write source', () => {
  test('supabase unless the build says api; anything else is a mistake', () => {
    expect([parseWriteSource(undefined), parseWriteSource(''), parseWriteSource('supabase'), parseWriteSource('api')])
      .toEqual(['supabase', 'supabase', 'supabase', 'api']);
    expect(() => parseWriteSource('API')).toThrow(/VITE_WRITE_SOURCE/);
  });
});

describe("a contributor's own sighting, before a build has it", () => {
  test("shaped as the map's occurrence: names from the published names, identifiers as the form finds them", () => {
    const names = new Map([['SSA:0000002', {common_name: null, taxon_common_name: 'Killer whale', inaturalist_scientific_name: 'Orcinus orca ater'}]]);
    const o = ownOccurrence(sighting(), {name: 'Ann'}, names);
    expect(o).toMatchObject({
      id: sighting().id, attribution: 'Ann on SalishSea.io', observer: 'Ann', contributor_id: 7,
      observed_at_ms: Date.parse('2026-10-05T17:00:00Z'),
      taxon: {entity_id: 'SSA:0000002', scientific_name: 'Orcinus orca ater', vernacular_name: 'Killer whale'},
      photos: [{src: 'https://salishsea.io/media/7/x/a.jpg', license: 'cc-by', thumb: null}],
    });
    expect(o.identifiers).toEqual(expect.arrayContaining(['J35', 'J47']));
    expect(ownOccurrence(sighting(), {name: 'Ann'}, undefined).taxon).toMatchObject({scientific_name: null, entity_id: 'SSA:0000002'});
  });

  test("the overlay replaces every file row of theirs, keeps everyone else's, newest first", () => {
    const row = (id: string, contributor_id: number | null, observed_at: string) => ({id, contributor_id, observed_at});
    const file = [row('mine-old', 7, '2026-10-05T18:00:00Z'), row('theirs', 8, '2026-10-05T17:30:00Z'), row('inat', null, '2026-10-05T16:00:00Z')];
    const own = [row('mine-new', 7, '2026-10-05T17:45:00Z')];
    expect(overlayOwn(file, own, 7).map(r => r.id)).toEqual(['mine-new', 'theirs', 'inat']);
  });
});
