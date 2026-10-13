// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ObsMap } from './obs-map.ts';
import { MASK_MAX_ZOOM } from './style.ts';
import { mapZoom } from './map-view.ts';

describe('ObsMap', () => {
  it('constructs without throwing', () => {
    expect(() => document.createElement('obs-map')).not.toThrow();
  });

  it('accepts empty occurrences', () => {
    const el = document.createElement('obs-map') as ObsMap;
    expect(() => el.setOccurrences([])).not.toThrow();
  });
});

describe('the out-of-region mask', () => {
  it('shows at zoom 9 and further out, and not zoomed in past it', () => {
    // Zooms as permalinks number them. MapLibre draws a layer below its maxzoom.
    const shownAt = (zoom: number) => mapZoom(zoom) < MASK_MAX_ZOOM;
    expect([7, 8.14, 9].map(shownAt)).toEqual([true, true, true]);
    expect([9.01, 12].map(shownAt)).toEqual([false, false]);
  });
});
