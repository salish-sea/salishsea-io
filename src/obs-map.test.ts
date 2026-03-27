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
