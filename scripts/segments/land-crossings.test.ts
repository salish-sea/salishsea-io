import {describe, expect, it} from 'vitest';
import {nearestIsland, testLeg} from './land-crossings.ts';

// A leg due east along 48.5°N, 0.1° of longitude (about 7.4 km) long, with the sea's
// regions on either side of a stretch of land between -123.00 and -122.97.
const a = {lon: -123.05, lat: 48.5};
const b = {lon: -122.95, lat: 48.5};
const land = (from: number, to: number) => (lon: number, _lat: number) =>
  lon > from && lon < to ? null : lon < from ? 'West Channel' : 'East Channel';

describe('testLeg', () => {
  it('finds the land between two waters, its length and the waters either side', () => {
    const {testable, crossings, lengthM} = testLeg(a, b, land(-123.0003, -122.9703));
    expect(testable).toBe(true);
    expect(lengthM).toBeGreaterThan(7000);
    expect(crossings).toHaveLength(1);
    const [c] = crossings;
    expect(c!.from).toBe('West Channel');
    expect(c!.to).toBe('East Channel');
    expect(c!.crossedM).toBeGreaterThan(2000);
    expect(c!.crossedM).toBeLessThan(2800);
    expect(c!.midpoint.lon).toBeGreaterThan(-122.99);
    expect(c!.midpoint.lon).toBeLessThan(-122.98);
  });

  it('finds nothing in open water', () => {
    expect(testLeg(a, b, () => 'West Channel').crossings).toEqual([]);
  });

  it('does not count a leg that starts or ends on land', () => {
    expect(testLeg(a, b, lon => lon < -123.0003 ? null : 'East Channel' as never).crossings).toEqual([]);
    expect(testLeg(a, b, (lon: number) => lon > -122.9703 ? null : 'West Channel').crossings).toEqual([]);
  });

  it('finds each of two islands in one leg', () => {
    const twice = (lon: number) => (lon > -123.02 && lon < -123.01) || (lon > -122.99 && lon < -122.98) ? null : 'Strait';
    expect(testLeg(a, b, twice).crossings).toHaveLength(2);
  });

  it('cannot test a leg that leaves the range of the regions', () => {
    expect(testLeg({lon: -123, lat: 41.9}, {lon: -123, lat: 42.5}, () => 'X').testable).toBe(false);
    expect(testLeg({lon: -128.9, lat: 48}, {lon: -129.1, lat: 48}, () => 'X').testable).toBe(false);
    expect(testLeg({lon: -123, lat: 51}, {lon: -123, lat: 51.6}, () => 'X').testable).toBe(false);
  });

  it('tests a leg between two reports at the same place', () => {
    expect(testLeg(a, a, () => 'X')).toMatchObject({testable: true, crossings: []});
  });
});

describe('nearestIsland', () => {
  const place = (name: string, lon: number, lat: number) => ({name, kind: 'island', lon, lat, zoom: 10, otherNames: []});
  it('names the closest island', () => {
    const islands = [place('Far', -124, 48), place('Near', -122.99, 48.5)];
    expect(nearestIsland(islands, {lon: -122.98, lat: 48.5})!.name).toBe('Near');
    expect(nearestIsland([], a)).toBeNull();
  });
});
