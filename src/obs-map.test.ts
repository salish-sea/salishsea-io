// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { ObsMap } from './obs-map.ts';

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

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
    const el = document.createElement('obs-map') as ObsMap;
    // the mask is the one layer between the basemap and the data
    const mask = el.map.getLayers().getArray().find(l => l.getZIndex() === 1)!;
    // OpenLayers draws a layer above its minZoom and at or below its maxZoom
    const shownAt = (zoom: number) => zoom > mask.getMinZoom() && zoom <= mask.getMaxZoom();
    expect([7, 8.14, 9].map(shownAt)).toEqual([true, true, true]);
    expect([9.01, 12].map(shownAt)).toEqual([false, false]);
  });
});
