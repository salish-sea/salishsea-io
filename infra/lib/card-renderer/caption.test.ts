import { animalsInFocus, placeInFocus, segmentHeads, travelLines } from './caption';
import type { Occurrence } from './data';

let n = 0;
const report = (fields: Partial<Occurrence> = {}): Occurrence => ({
  id: `r${n++}`, location: { lon: -122.5, lat: 47.9 }, observedAt: '2026-11-10T17:00:00Z',
  species: 'Southern Resident killer whale', speciesId: 41521, count: null, ...fields,
});
const times = (k: number, fields: Partial<Occurrence>) => Array.from({ length: k }, () => report(fields));

describe('placeInFocus', () => {
  it('names the region that holds more than half the sightings', () => {
    expect(placeInFocus([...times(11, { place: 'Puget Sound' }), ...times(8, { place: 'Possession Sound' })]))
      .toBe('Puget Sound');
  });

  it('names two regions when together they hold more than half', () => {
    expect(placeInFocus([
      ...times(4, { place: 'Puget Sound' }), ...times(3, { place: 'Possession Sound' }), ...times(2, { place: 'Haro Strait' }),
    ])).toBe('Puget Sound and Possession Sound');
  });

  it('names none when the sightings are spread wider than two regions', () => {
    expect(placeInFocus([
      ...times(2, { place: 'Puget Sound' }), ...times(2, { place: 'Haro Strait' }),
      ...times(2, { place: 'Rosario Strait' }), ...times(2, { place: null }),
    ])).toBeNull();
  });

  it('names none for an empty frame', () => {
    expect(placeInFocus([])).toBeNull();
  });
});

describe('animalsInFocus', () => {
  it('lets the narrower name stand for a species reported under two, with the pods named', () => {
    // 2026-11-10: the reports said SRKWs, a bout tagged "J pod" and "K pod?", and a humpback was about.
    expect(animalsInFocus([
      ...times(3, { species: 'Southern Resident killer whale' }),
      report({ species: 'Killer whale', identifiers: ['J pod', 'K pod?', 'Southern Resident'] }),
      report({ species: 'Humpback whale', speciesId: 41566 }),
    ])).toBe('Southern Resident killer whales (J pod) · Humpback whales');
  });

  it('falls back to the general name when a species is reported under two narrower ones', () => {
    expect(animalsInFocus([
      report({ species: "Bigg's killer whale", identifiers: ['T65As'] }),
      report({ species: 'Southern Resident killer whale', pods: ['K', 'J'] }),
      report({ species: 'Killer whale' }),
    ])).toBe('Killer whales (J and K pods, T65As)');
  });

  it('names one animal once, however a report pads its code', () => {
    expect(animalsInFocus([report({ identifiers: ['T046Bs'] }), report({ identifiers: ['T46Bs'] })]))
      .toBe('Southern Resident killer whales (T46Bs)');
  });

  it('makes one item of two species under one name', () => {
    expect(animalsInFocus([
      report({ species: 'Steller sea lion', speciesId: 1 }), report({ species: 'Steller sea lion', speciesId: 2 }),
    ])).toBe('Steller sea lions');
  });

  it('leaves off whole items that would not fit, and says so', () => {
    const line = animalsInFocus([
      ...times(3, { species: 'Humpback whale', speciesId: 41566, identifiers: ['BCX2183', 'BCX2499'] }),
      ...times(2, { species: 'Harbour seal', speciesId: 3 }),
      report({ species: 'Steller sea lion', speciesId: 4 }),
      report({ species: 'California sea lion', speciesId: 5 }),
    ], 61);
    expect(line).toBe('Humpback whales (BCX2183, BCX2499) · Harbour seals · and more');
  });

  it('is null for an empty frame', () => {
    expect(animalsInFocus([])).toBeNull();
  });
});

describe('travelLines', () => {
  it('joins each segment oldest first, along the route by sea the build wrote', () => {
    const a = report({ id: 'a', segment: 'a', observedAt: '2026-11-10T16:00:00Z', location: { lon: 0, lat: 0 } });
    const b = report({
      id: 'b', segment: 'a', observedAt: '2026-11-10T17:00:00Z', location: { lon: 2, lat: 0 },
      leg: [[0, 0], [1, 1], [2, 0]],
    });
    const alone = report({ id: 'c', segment: 'c', location: { lon: 5, lat: 5 } });
    // The day's file lists the newest first.
    expect(travelLines([b, alone, a])).toEqual([[{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }, { lon: 2, lat: 0 }]]);
    expect(segmentHeads([b, alone, a])).toEqual(new Set(['b', 'c']));
  });

  it('draws a leg straight when it starts somewhere other than the report before', () => {
    const a = report({ segment: 'a', observedAt: '2026-11-10T16:00:00Z', location: { lon: 0, lat: 0 } });
    const b = report({ segment: 'a', location: { lon: 2, lat: 0 }, leg: [[9, 9], [1, 1], [2, 0]] });
    expect(travelLines([a, b])).toEqual([[{ lon: 0, lat: 0 }, { lon: 2, lat: 0 }]]);
  });
});
