// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import View from 'ol/View.js';
import { transformExtent } from 'ol/proj.js';
import { ObsMap, framingZoom } from './obs-map.ts';
import { REGIONS } from './constants.ts';

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

describe('framingZoom', () => {
  // A desktop window and a phone's, where the default view is a zoom or two apart.
  it.each([[[1280, 800]], [[390, 700]]])('is where fitting each region lands, in a %j window', size => {
    for (const region of REGIONS) {
      const view = new View({projection: 'EPSG:3857', zoom: 9});
      view.fit(transformExtent([...region.zoomExtent], 'EPSG:4326', 'EPSG:3857'), {size});
      const zoom = framingZoom(view, region.zoomExtent, size);
      // the default view is at it, so the mask is hidden there…
      expect(view.getZoom()!).toBeLessThanOrEqual(zoom);
      // …and a nudge inward shows it
      expect(view.getZoom()! + 0.01).toBeGreaterThan(zoom);
    }
  });
});
