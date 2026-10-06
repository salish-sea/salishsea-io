import { describe, expect, test } from 'vitest';

import { overlayOwn, ownOccurrence, parseWriteSource, sightingBody, type OwnSighting } from './write-api.ts';
import type { UpsertObservationArgs } from './types.ts';

const sighting = (over: Partial<OwnSighting> = {}): OwnSighting => ({
  id: '01977c2a-b313-77a9-8433-ffccbd56bf57', observed_at: '2026-10-05T17:00:00.000000Z',
  location: {lon: -123.1, lat: 48.5}, observed_from: null, body: 'J35 and J47 heading north', count: 3,
  direction: 'north', url: null, entity_id: 'SSA:0000002', photos: [{src: 'https://salishsea.io/media/7/x/a.jpg', license: 'cc-by'}],
  contributor_id: 7, updated_at: '2026-10-05T17:01:00.000000Z', ...over,
});

describe('the write source', () => {
  test('supabase unless the build says api; anything else is a mistake', () => {
    expect([parseWriteSource(undefined, 'static'), parseWriteSource('', 'static'), parseWriteSource('supabase', 'supabase'),
      parseWriteSource('api', 'static')]).toEqual(['supabase', 'supabase', 'supabase', 'api']);
    expect(() => parseWriteSource('API', 'static')).toThrow(/VITE_WRITE_SOURCE/);
    // the overlay lays own sightings over the published files, which Supabase's reads don't use
    expect(() => parseWriteSource('api', 'supabase')).toThrow(/VITE_READ_SOURCE=static/);
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

describe('a save, as the API is sent it', () => {
  test("a photo goes as its URL and license, never the form's thumbnail, so a save stays small", () => {
    const thumb = `data:image/jpeg;base64,${'A'.repeat(500_000)}`;
    const args = {
      id: 'x', body: 'b', count: 1, direction: null, observed_at: '2026-10-05T17:00:00Z', observed_from: null,
      location: {lon: -123, lat: 48.5}, accuracy: null, entity_id: 'SSA:0000900', url: '',
      photos: [{src: 'https://salishsea.io/media/7/x/a.jpg', license: 'cc-by', thumb, attribution: null, mimetype: null}],
    } as unknown as UpsertObservationArgs;
    const sent = sightingBody(args);
    expect(sent.photos).toEqual([{src: 'https://salishsea.io/media/7/x/a.jpg', license: 'cc-by'}]);
    expect(JSON.stringify(sent).length).toBeLessThan(1000);
  });
});
