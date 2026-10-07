import { describe, expect, test } from 'vitest';

import { smallMapDots, SMALL_MAP_EXTENT } from './small-multiples.ts';

const at = (lon: number, lat: number) => ({ occurrence_id: `${lon},${lat}`, observed_at: '2026-01-01T00:00:00Z', location: { lon, lat } });
const circles = (dots: { svg: string }) => dots.svg.match(/<circle [^>]*>/g) ?? [];

describe('smallMapDots', () => {
  test('reports at one spot are one circle, as dark as they would be overlapping', () => {
    const one = circles(smallMapDots([at(-122.5, 47.6)]));
    const two = circles(smallMapDots([at(-122.5, 47.6), at(-122.5, 47.6)]));
    expect(one).toHaveLength(1);
    expect(one[0]).toContain('fill-opacity="0.50"');
    expect(two).toHaveLength(1);
    expect(two[0]).toContain('fill-opacity="0.75"');
  });

  test('a very busy map draws each report fainter, so it does not go solid', () => {
    const busy = Array.from({ length: 6000 }, (_, i) => at(-123 + (i % 60) * 0.01, 48 + Math.floor(i / 60) * 0.005));
    const opacities = circles(smallMapDots(busy)).map(c => Number(c.match(/fill-opacity="([\d.]+)"/)![1]));
    expect(Math.min(...opacities)).toBe(0.25);
  });

  test('reports apart are apart', () => {
    expect(circles(smallMapDots([at(-122.5, 47.6), at(-123, 48.5)]))).toHaveLength(2);
  });

  test('an unlocated report, or one outside the extent, is not drawn', () => {
    const { west, north } = SMALL_MAP_EXTENT;
    expect(smallMapDots([
      { occurrence_id: 'x', observed_at: '2026-01-01T00:00:00Z', location: null },
      at(west - 0.1, 48), at(-123, north + 0.1), at(-122.5, 47.6),
    ])).toEqual({ svg: expect.stringMatching(/^<circle [^>]*><\/circle>$/), shown: 1 });
  });

  test('the corners are on the map', () => {
    const { west, east, south, north } = SMALL_MAP_EXTENT;
    expect(circles(smallMapDots([at(west, north), at(east, south)]))).toHaveLength(2);
  });

  test('the same reports in any order draw the same map', () => {
    const reports = [at(-122.5, 47.6), at(-123, 48.5), at(-122.9, 48.1)];
    expect(smallMapDots([...reports].reverse())).toEqual(smallMapDots(reports));
  });
});
