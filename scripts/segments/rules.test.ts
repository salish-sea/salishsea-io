import {describe, expect, test} from 'vitest';
import {RULES, ecotypesOf, identityPreferred, type Sighting, type Track} from './rules.ts';

const orca = 'Orcinus orca';
const sighting = (id: string, utc: string, lon: number, lat: number, extra: Partial<Sighting> = {}): Sighting => ({
  id,
  observed_at_ms: Date.parse(utc),
  location: {lon, lat},
  taxon: {species_id: 41521, scientific_name: orca},
  identifiers: [],
  animals: new Set(),
  ...extra,
});
const ids = (tracks: Track[]) => tracks.map(t => t.map(s => s.id));

// 3 September 2026 west of San Juan Island, as reported in #445. Two morning
// reports, then Scott Veirs's afternoon encounter with the T49As. His first
// point is 20.4 km from the 08:33 report; his second is 19.8 km.
const biggs = {taxon: {species_id: 41521, scientific_name: 'Orcinus orca rectipinnus'}};
const sept3 = [
  sighting('hydrophone-0715', '2026-09-03T14:15:03Z', -123.17517, 48.55),
  sighting('report-0833', '2026-09-03T15:33:01Z', -123.1545, 48.51483),
  sighting('scott-1456', '2026-09-03T21:56:00Z', -123.0247, 48.6774, biggs),
  sighting('scott-1502', '2026-09-03T22:02:00Z', -123.0367, 48.6746, biggs),
  sighting('scott-1513', '2026-09-03T22:13:00Z', -123.056, 48.6779, biggs),
  sighting('scott-1550', '2026-09-03T22:50:00Z', -123.1017, 48.6729, biggs),
  sighting('scott-1605', '2026-09-03T23:05:00Z', -123.0952, 48.6504, {...biggs, identifiers: ['T49As']}),
];

describe('Scott\'s first sighting on 3 September (#445)', () => {
  test('the map\'s rule leaves it alone and carries the morning track into his encounter', () => {
    expect(ids(RULES.current(sept3))).toEqual([
      ['hydrophone-0715', 'report-0833', 'scott-1502', 'scott-1513', 'scott-1550', 'scott-1605'],
      ['scott-1456'],
    ]);
  });

  test.each(['nearest', 'spaceTime', 'nearestEcotype', 'spaceTimeEcotype', 'identity'] as const)(
    '%s starts his track with it and leaves the morning reports to themselves', name => {
      expect(ids(RULES[name](sept3))).toEqual([
        ['hydrophone-0715', 'report-0833'],
        ['scott-1456', 'scott-1502', 'scott-1513', 'scott-1550', 'scott-1605'],
      ]);
    });
});

test('the ecotype check keeps a Bigg\'s report off a Southern Resident track', () => {
  const day = [
    sighting('residents', '2026-01-23T17:44:00Z', -123.264, 48.492, {identifiers: ['J pod']}),
    sighting('biggs', '2026-01-23T17:50:00Z', -123.25, 48.495, {identifiers: ['T99s']}),
  ];
  expect(ids(RULES.nearest(day))).toEqual([['residents', 'biggs']]);
  expect(ids(RULES.nearestEcotype(day))).toEqual([['residents'], ['biggs']]);
});

test('identity-preferred follows a named animal past a nearer anonymous track', () => {
  const day = [
    sighting('named', '2026-06-24T18:00:00Z', -122.95, 47.10, {animals: new Set([1, 2])}),
    sighting('anonymous', '2026-06-24T18:05:00Z', -122.90, 47.17),
    sighting('named-again', '2026-06-24T19:00:00Z', -122.91, 47.15, {animals: new Set([2, 3])}),
  ];
  expect(ids(RULES.nearest(day))).toEqual([['named'], ['anonymous', 'named-again']]);
  expect(ids(RULES.identity(day))).toEqual([['named', 'named-again'], ['anonymous']]);
  // Shown nobody's names, it falls back to nearest.
  expect(ids(identityPreferred(() => false)(day))).toEqual([['named'], ['anonymous', 'named-again']]);
});

test('ecotypesOf reads the taxon and named pods and IDs', () => {
  expect([...ecotypesOf(sighting('a', '2026-01-01T00:00:00Z', 0, 0, {identifiers: ['K pod']}))]).toEqual(['srkw']);
  expect([...ecotypesOf(sighting('b', '2026-01-01T00:00:00Z', 0, 0, {identifiers: ['T049A1']}))]).toEqual(['biggs']);
  expect([...ecotypesOf(sighting('c', '2026-01-01T00:00:00Z', 0, 0, biggs))]).toEqual(['biggs']);
  expect(ecotypesOf(sighting('d', '2026-01-01T00:00:00Z', 0, 0)).size).toBe(0);
});
