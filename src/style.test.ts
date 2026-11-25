import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import basemapStyle from './basemap-style.json' with { type: 'json' };
import { setCatalogCodes } from './individual-links.ts';
import { PLACE_LISTS } from './places.ts';
import { IMAGE_TILES, IMAGE_TILES_MAX_ZOOM } from './profile-map.ts';
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

  it('adds no second ? to a name that already ends in one, and leaves out what the name says (decision 121)', () => {
    const killerWhale = (over: Partial<Occurrence>) => ({...humpback(over), taxon: {...humpback().taxon, scientific_name: 'Orcinus orca'}}) as Occurrence;
    expect(occurrenceProperties(killerWhale({isLast: true, certainty: 'possible', segmentIdentity: 'J pod?', segmentIdentifiers: ['J pod?', 'J27']})).label)
      .toBe('J pod? · J27');
    // the bout of 2026-11-20: tagged Southern Resident, titled "likely J pod"
    expect(occurrenceProperties(killerWhale({isLast: true, segmentIdentity: 'SRKW', segmentIdentifiers: ['Southern Resident']})).label).toBe('SRKW');
    expect(occurrenceProperties(killerWhale({isLast: true, segmentIdentity: 'J pod', segmentIdentifiers: ['J pod', 'Southern Resident', 'J27']})).label)
      .toBe('J pod · J27');
    expect(occurrenceProperties(killerWhale({isLast: true, segmentIdentity: 'J pod?', segmentIdentifiers: ['J pod?', 'Southern Resident']})).label)
      .toBe('J pod? · Southern Resident');
  });

  describe('identifiers after the name (decision 029, 2026-11-25)', () => {
    const killerWhale = (over: Partial<Occurrence>) => ({...humpback(over), taxon: {...humpback().taxon, scientific_name: 'Orcinus orca'}}) as Occurrence;
    const biggs = ['T100s', 'T101s', 'T37Bs', 'T46B', 'T46B1s', 'T46B2', 'T46B8', 'T49A', 'T49A7'];
    const label = (identifiers: string[]) =>
      occurrenceProperties(killerWhale({isLast: true, segmentIdentity: 'Biggs', segmentIdentifiers: identifiers})).label;
    const individual = (id: number, designation: string) => ({entity_id: `SSA:${id}`, primary_designation: designation});

    it('before the catalogue loads, lists nothing rolled up, and counts a long list', () => {
      expect(label(['T46B8', 'T49A7'])).toBe('Biggs · T46B8, T49A7');
      expect(label(biggs)).toBe('Biggs · 9 identified');
    });

    it('once it has loaded, rolls identifiers up to their topmost matrilines', () => {
      setCatalogCodes({
        designations: [
          {code: 'T46B8', individual: individual(1, 'T046B8'), matriline: 'T046'},
          {code: 'T49A7', individual: individual(2, 'T049A7'), matriline: 'T049'},
          {code: 'T65A', individual: individual(3, 'T065A'), matriline: 'T065'},
          {code: 'T46', individual: individual(4, 'T046'), matriline: 'T046'},
        ],
        groups: [
          {kind: 'matriline', designation: 'T046B2', entity_id: 'SSA:10', matriline: 'T046'},
          {kind: 'matriline', designation: 'T049A', entity_id: 'SSA:11', matriline: 'T049'},
          {kind: 'matriline', designation: 'T065', entity_id: 'SSA:12', matriline: 'T065'},
        ],
      });
      expect(label(['T46B8', 'T46B2s', 'T46'])).toBe('Biggs · T46s');
      expect(label(['T49A7', 'T49As', 'T65A?'])).toBe('Biggs · T49s, T65s?');
      expect(label(['T46B8', 'T49A7', 'T65A?'])).toBe('Biggs · 3 matrilines');
      expect(label(['T46B8', 'T49A7', 'BCX1358'])).toBe('Biggs · 3 identified');
      // the second line is as it was
      expect(occurrenceProperties(killerWhale({isLast: true, segmentIdentity: 'Biggs', segmentIdentifiers: ['T46B8'], segmentLength: 3, segmentSpanHours: 7})).label)
        .toBe('Biggs · T46s\nSeen 3× over 7h');
    });
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
    const card = readFileSync(new URL('../infra/lib/card-renderer/basemap.ts', import.meta.url), 'utf8');
    expect(card).toContain(`export const IMAGE_TILES = '${named}';`);
    expect(card).toContain(`export const IMAGE_TILES_MAX_ZOOM = ${IMAGE_TILES_MAX_ZOOM};`);
  });

  // The search finds the places the version labels; scripts/update-basemap.ts writes their lists' URLs.
  it('has the search read the place lists of the same version', () => {
    const named = (basemapStyle.metadata as Record<string, unknown>)['salishsea:places'] as Record<string, string>;
    // A version also names its water regions' list there (from 2026.10.21), and may name its shore
    // parks' (decision 119): neither is for search, which reads these two by name.
    expect(PLACE_LISTS).toEqual([named['gazetteers'], named['osm']]);
  });
});
