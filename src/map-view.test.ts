import { describe, expect, it } from 'vitest';
import { fromLonLat, mapZoom, permalinkZoom, toLonLat } from './map-view.ts';

describe('permalink coordinates', () => {
  it('match what OpenLayers wrote for the same place', () => {
    // ol/proj fromLonLat([-123, 48.5]), as a permalink from before decision 076 holds it.
    const [x, y] = fromLonLat([-123, 48.5]);
    expect(x).toBeCloseTo(-13692297.37, 1);
    expect(y).toBeCloseTo(6190443.81, 1);
  });

  it('round-trip', () => {
    const [lon, lat] = toLonLat(fromLonLat([-122.4, 47.6]));
    expect(lon).toBeCloseTo(-122.4, 9);
    expect(lat).toBeCloseTo(47.6, 9);
  });
});

describe('permalink zoom', () => {
  it('is one higher than MapLibre zoom, both ways', () => {
    expect(mapZoom(9)).toBe(8);
    expect(permalinkZoom(mapZoom(12))).toBe(12);
  });
});
