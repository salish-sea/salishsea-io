import { describe, expect, test } from 'vitest';
import {
  DEFAULT_REGION_SLUG,
  isExtent,
  pugetSoundExtent,
  REGIONS,
  regionBySlug,
  salishSeaExtent,
  salishSRKWExtent,
  sanJuansExtent,
  srkwExtent,
} from './constants.ts';

test('validates a reasonable extent', () => {
  for (const extent of [pugetSoundExtent, srkwExtent, salishSeaExtent, salishSRKWExtent, sanJuansExtent]) {
    expect(isExtent(extent)).toBe(true);
  }
});

describe('regions', () => {
  test('every region extent is a valid extent', () => {
    for (const region of REGIONS) {
      if (region.extent)
        expect(isExtent(region.extent), region.slug).toBe(true);
      expect(isExtent(region.zoomExtent), `${region.slug} zoom`).toBe(true);
    }
  });

  test('slugs are unique', () => {
    const slugs = REGIONS.map(r => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('the default slug names a real region', () => {
    expect(REGIONS.some(r => r.slug === DEFAULT_REGION_SLUG)).toBe(true);
  });

  test('exactly one region is unfiltered, and it is not the default', () => {
    const unfiltered = REGIONS.filter(r => r.extent === null);
    expect(unfiltered.map(r => r.slug)).toEqual(['everywhere']);
    // A default that shows everything would make the mask meaningless on first
    // load, which is the opposite of what GH #16 asked for.
    expect(DEFAULT_REGION_SLUG).not.toBe('everywhere');
  });

  test('an unknown or missing slug falls back to the default', () => {
    // A stale or hand-edited ?r= should still render a map.
    for (const input of ['nonsense', '', null, undefined]) {
      expect(regionBySlug(input).slug).toBe(DEFAULT_REGION_SLUG);
    }
  });

  test('a known slug round-trips', () => {
    for (const region of REGIONS) {
      expect(regionBySlug(region.slug)).toBe(region);
    }
  });

  test('Salish Sea filters on the wide extent, not the SRKW-clipped one', () => {
    // Regression guard for design decision 5. The clipped extent frames the
    // water sightings are usually in — right for a viewport, wrong for a
    // filter, because as the default it silently drops the Strait of Georgia
    // north of 49.5 and the western Strait of Juan de Fuca.
    const salishSea = regionBySlug('salish-sea');
    expect(salishSea.extent).toEqual(salishSeaExtent);
    expect(salishSea.extent).not.toEqual(salishSRKWExtent);
  });

  test('framing never reaches outside the filter', () => {
    // The two may differ, but only in one direction: the viewport must sit
    // inside the region, never outside it.
    //
    // Framing tighter than the filter just means you start well within what is
    // being shown, and pan outward through clear water before meeting the mask.
    // Framing WIDER would land you looking at shaded area on load — the map
    // reading as mostly disabled before you have touched anything, which is
    // what fitting Salish Sea to its own filter bounds actually did.
    for (const region of REGIONS) {
      if (!region.extent) continue;
      const [fx0, fy0, fx1, fy1] = region.extent;
      const [zx0, zy0, zx1, zy1] = region.zoomExtent;
      expect(zx0 >= fx0 && zy0 >= fy0 && zx1 <= fx1 && zy1 <= fy1, region.slug).toBe(true);
    }
  });

  test('each sub-region is contained by the Salish Sea or SRKW range', () => {
    // Sanity check that the bubbles nest the way their labels imply.
    const salishSea = regionBySlug('salish-sea').extent!;
    const srkw = regionBySlug('srkw-range').extent!;
    const contains = (outer: readonly number[], inner: readonly number[]) =>
      inner[0]! >= outer[0]! && inner[1]! >= outer[1]! &&
      inner[2]! <= outer[2]! && inner[3]! <= outer[3]!;

    for (const slug of ['puget-sound', 'san-juans'] as const) {
      const inner = regionBySlug(slug).extent!;
      expect(contains(salishSea, inner) || contains(srkw, inner), slug).toBe(true);
    }
  });
});
