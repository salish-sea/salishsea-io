import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYERS, layersParam, parseLayersParam } from './reference-layers.ts';

describe('parseLayersParam', () => {
  it('reads an absent parameter as the default set', () => {
    expect(parseLayersParam(null)).toEqual(new Set(DEFAULT_LAYERS));
  });

  it('keeps haul-outs off by default', () => {
    expect(DEFAULT_LAYERS.has('haulouts')).toBe(false);
    expect(DEFAULT_LAYERS.has('viewpoints')).toBe(true);
  });

  it('reads an empty parameter as every layer off', () => {
    expect(parseLayersParam('')).toEqual(new Set());
  });

  it('drops a name it does not know and keeps the rest', () => {
    expect(parseLayersParam('herring haulouts')).toEqual(new Set(['haulouts']));
  });

  it('reads the + a URL spells a space with, and a typed comma', () => {
    expect(parseLayersParam(new URLSearchParams('l=viewpoints+haulouts').get('l'))).toEqual(new Set(['viewpoints', 'haulouts']));
    expect(parseLayersParam('viewpoints,haulouts')).toEqual(new Set(['viewpoints', 'haulouts']));
  });
});

describe('layersParam', () => {
  it('omits the parameter for the default set, in whatever order it was built', () => {
    expect(layersParam(new Set([...DEFAULT_LAYERS].reverse()))).toBeNull();
  });

  it('writes the visible layers in a fixed order', () => {
    expect(layersParam(new Set(['haulouts', 'viewpoints']))).toBe('viewpoints haulouts');
  });

  it('writes an empty value when every layer is off', () => {
    expect(layersParam(new Set())).toBe('');
  });

  it('reads as + in a URL, not an escaped comma', () => {
    const params = new URLSearchParams({l: layersParam(new Set(['viewpoints', 'haulouts']))!});
    expect(params.toString()).toBe('l=viewpoints+haulouts');
  });

  it('round-trips through the parser', () => {
    const visible = new Set(['hydrophones', 'haulouts'] as const);
    expect(parseLayersParam(layersParam(visible))).toEqual(visible);
  });
});
