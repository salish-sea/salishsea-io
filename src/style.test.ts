import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import basemapStyle from './basemap-style.json' with { type: 'json' };
import { PLACE_LISTS } from './places.ts';
import { IMAGE_TILES } from './profile-map.ts';
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

  it('draws an unconfirmed or disputed sighting as a white dot edged in its colour (decision 080)', () => {
    for (const confirmation of ['unconfirmed', 'disputed'] as const)
      for (const isLast of [undefined, true] as const)
        expect(occurrenceProperties(humpback({confirmation, isLast}))).toMatchObject(
          {unconfirmed: true, fill: '#ffffff', ring: GROUPS.baleen.color});
    const confirmed = occurrenceProperties(humpback({confirmation: 'confirmed'}));
    expect(confirmed.unconfirmed).toBe(false);
    expect(confirmed.fill).not.toBe('#ffffff');
  });

  it('marks a dead animal, and says so in its label (salish-1y8)', () => {
    expect(occurrenceProperties(humpback({vitality: 'dead'})).dead).toBe(true);
    expect(occurrenceProperties(humpback({vitality: 'alive'})).dead).toBe(false);
    expect(occurrenceProperties(humpback()).dead).toBe(false);
    expect(occurrenceProperties(humpback({vitality: 'dead', isLast: true, segmentIdentity: 'Humpback'})).label).toBe('Humpback · dead');
  });

  it('draws a dead animal as a bone, never as a dot as well', () => {
    const layers = baseStyle().layers;
    const dot = layers.find(l => l.id === 'occurrence-dot') as {filter: unknown};
    const bone = layers.find(l => l.id === 'occurrence-bone') as {filter: unknown, layout: Record<string, unknown>};
    expect(dot.filter).toEqual(['!', ['boolean', ['get', 'dead'], false]]);
    expect(bone.filter).toEqual(['boolean', ['get', 'dead'], false]);
    expect(JSON.stringify(bone.layout['icon-image'])).toContain('bone-outline-');
    // a selected carcass keeps its bone, drawn over the selection's circle
    const ids = layers.map(l => l.id);
    expect(ids.indexOf('selected-bone')).toBeGreaterThan(ids.indexOf('selected-dot'));
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
    // A style may name one sprite or several; since 2026.10.8 the basemap's landmarks have their own.
    const sprites = Array.isArray(style.sprite) ? style.sprite.map(sprite => sprite.url) : [style.sprite];
    const urls = [
      style.glyphs, ...sprites,
      ...Object.values(style.sources).map(source => 'url' in source ? source.url : undefined),
    ].filter((url): url is string => typeof url === 'string');
    expect(urls.length).toBeGreaterThan(2);
    for (const url of urls) expect(url.replace(/^pmtiles:\/\//, '')).toMatch(/^https:\/\/tiles\.salishsea\.io\//);
  });

  it('names the basemap version it was copied from', () => {
    expect(BASEMAP_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });

  // The profile maps, the small maps and the preview cards stitch the version's image
  // tiles; scripts/update-basemap.ts writes their URL into both places.
  it('has the pictures stitch the image tiles of the same version', () => {
    const named = (basemapStyle.metadata as Record<string, unknown>)['salishsea:images'];
    expect(named).toMatch(/^https:\/\/tiles\.salishsea\.io\/images\/[0-9a-f]{16}\/\{z\}\/\{x\}\/\{y\}\.webp$/);
    expect(IMAGE_TILES).toBe(named);
    expect(readFileSync(new URL('../infra/lib/card-renderer/basemap.ts', import.meta.url), 'utf8')).toContain(`export const IMAGE_TILES = '${named}';`);
  });

  // The search finds the places the version labels; scripts/update-basemap.ts writes their lists' URLs.
  it('has the search read the place lists of the same version', () => {
    const named = (basemapStyle.metadata as Record<string, unknown>)['salishsea:places'] as Record<string, string>;
    // The version also names its water regions' list there, which isn't for search.
    expect(Object.keys(named).sort()).toEqual(['gazetteers', 'osm', 'regions']);
    expect(PLACE_LISTS).toEqual([named['gazetteers'], named['osm']]);
  });
});
