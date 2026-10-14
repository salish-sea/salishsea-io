import { describe, expect, it } from 'vitest';
import { BASEMAP_VERSION, baseStyle, occurrenceProperties, SOURCES } from './style.ts';
import { GROUPS } from './symbology.ts';
import type { Occurrence } from './types.ts';

const humpback = (extra: Partial<Occurrence> = {}) => ({
  id: 'a',
  body: null,
  certainty: null,
  direction: null,
  identifiers: [],
  taxon: {scientific_name: 'Megaptera novaeangliae', vernacular_name: 'Humpback whale', species_id: 1, entity_id: null},
  ...extra,
}) as unknown as Occurrence;

describe('occurrenceProperties', () => {
  it('colours a dot by its taxon group', () => {
    expect(occurrenceProperties(humpback()).color).toBe(GROUPS.baleen.color);
  });

  it('labels only the head of a segment', () => {
    expect(occurrenceProperties(humpback()).label).toBeUndefined();
    expect(occurrenceProperties(humpback({isLast: true})).label).toBeDefined();
  });

  it('puts the track summary on a second line', () => {
    const {label} = occurrenceProperties(humpback({isLast: true, segmentIdentity: 'Humpback', segmentLength: 3, segmentSpanHours: 2}));
    expect(label?.split('\n')).toHaveLength(2);
    expect(label?.startsWith('Humpback\n')).toBe(true);
  });

  it('marks a possible species with a question mark (decision 054) and names the identifiers', () => {
    const {label} = occurrenceProperties(humpback({isLast: true, certainty: 'possible', segmentIdentity: 'Humpback', segmentIdentifiers: ['BCY0409']}));
    expect(label).toBe('Humpback? · BCY0409');
  });

  it('turns a direction of travel into degrees clockwise from east', () => {
    expect(occurrenceProperties(humpback({direction: 'south'})).directionDeg).toBeCloseTo(90);
    expect(occurrenceProperties(humpback()).directionDeg).toBeUndefined();
  });
});

describe('baseStyle', () => {
  const style = baseStyle();

  it('draws the basemap first and our layers on top of it', () => {
    const ours = style.layers.findIndex(layer => 'source' in layer && (SOURCES as readonly string[]).includes(layer.source));
    const basemapLayers = style.layers.filter(layer => 'source' in layer && !(SOURCES as readonly string[]).includes(layer.source));
    expect(ours).toBeGreaterThan(0);
    expect(basemapLayers.length).toBeGreaterThan(0);
    expect(style.layers.indexOf(basemapLayers.at(-1)!)).toBeLessThan(ours);
  });

  it('fetches nothing from any host but tiles.salishsea.io, which index.html allows', () => {
    const urls = [
      style.glyphs, style.sprite,
      ...Object.values(style.sources).map(source => 'url' in source ? source.url : undefined),
    ].filter((url): url is string => typeof url === 'string');
    expect(urls.length).toBeGreaterThan(2);
    for (const url of urls) expect(url.replace(/^pmtiles:\/\//, '')).toMatch(/^https:\/\/tiles\.salishsea\.io\//);
  });

  it('names the basemap version it was copied from', () => {
    expect(BASEMAP_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });
});
