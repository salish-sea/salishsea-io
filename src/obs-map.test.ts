// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// jsdom has no WebGL, so MapLibre can't make a map there. This one keeps its
// sources in a style that a lost WebGL context takes away, as MapLibre's does.
const {FakeMap, maps} = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class FakeMap {
    touchZoomRotate = {disableRotation() {}};
    keyboard = {disableRotation() {}};
    /** Each source's data, or no style at all while the context is lost. */
    style: Map<string, unknown> | null = new Map();
    #listeners = new Map<string, Listener[]>();
    #container: HTMLElement;
    constructor({container}: {container: HTMLElement}) {
      this.#container = container;
      maps.push(this);
    }
    on(type: string, listener: Listener) {
      this.#listeners.set(type, [...this.#listeners.get(type) ?? [], listener]);
    }
    once(type: string, listener: Listener) {
      const once = (...args: unknown[]) => {
        this.#listeners.set(type, this.#listeners.get(type)!.filter(l => l !== once));
        listener(...args);
      };
      this.on(type, once);
    }
    fire(type: string) {
      for (const listener of this.#listeners.get(type) ?? []) listener();
    }
    getSource(id: string) {
      const style = this.style;
      return style ? {setData: (data: unknown) => style.set(id, data)} : undefined;
    }
    addControl() {}
    addImage() {}
    setLayoutProperty() {}
    setFeatureState() {}
    getCenter() { return {lng: -123, lat: 48.5}; }
    getZoom() { return 8; }
    getCanvas() { return document.createElement('canvas'); }
    remove() {}
    getContainer() { return this.#container; }
  }
  const maps: FakeMap[] = [];
  return {FakeMap, maps};
});
vi.mock('maplibre-gl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('maplibre-gl')>()),
  Map: FakeMap,
}));

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

  it('keeps data set while the WebGL context is lost, and draws it once the style is back', async () => {
    const el = document.createElement('obs-map') as ObsMap;
    document.body.append(el);
    await el.updateComplete;
    const map = maps.at(-1)!;
    map.fire('load');

    // A phone takes the context back; MapLibre drops the style, sources and all.
    map.style = null;
    map.fire('webglcontextlost');
    expect(() => el.setOccurrences([])).not.toThrow();

    // Given the context back, MapLibre rebuilds the style and loads it a frame or more later.
    map.fire('webglcontextrestored');
    expect(() => el.setOccurrences([])).not.toThrow();
    map.style = new Map();
    map.fire('style.load');
    expect(map.style.get('occurrences')).toEqual({type: 'FeatureCollection', features: []});
    expect(map.style.get('travel-now')).toEqual({type: 'FeatureCollection', features: []});
    el.remove();
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
