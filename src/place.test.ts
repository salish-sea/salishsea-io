import { describe, expect, it } from 'vitest';

import { mainPlace, placeLine, placeSpan } from './place.ts';

const at = (...places: (string | null | undefined)[]) => places.map(place => ({place}));

describe('mainPlace', () => {
  it('names the place most of the reports were in', () => {
    expect(mainPlace(at('Haro Strait', 'Boundary Pass', 'Boundary Pass'))).toBe('Boundary Pass');
  });

  it('gives a tie to the place reported first', () => {
    expect(mainPlace(at('Haro Strait', 'Boundary Pass', 'Boundary Pass', 'Haro Strait'))).toBe('Haro Strait');
  });

  it('is null when no report has a place', () => {
    expect(mainPlace(at(null, undefined))).toBeNull();
    expect(mainPlace([])).toBeNull();
  });
});

describe('placeSpan', () => {
  it('says where reports began and ended', () => {
    expect(placeSpan(at('Haro Strait', null, 'Boundary Pass', 'Strait of Georgia'))).toBe('Haro Strait to Strait of Georgia');
  });

  it('names one place once', () => {
    expect(placeSpan(at('Haro Strait', 'Boundary Pass', 'Haro Strait'))).toBe('Haro Strait');
    expect(placeSpan(at(null, 'off Vancouver Island'))).toBe('off Vancouver Island');
  });

  it('is null when no report has a place', () => {
    expect(placeSpan(at(null))).toBeNull();
  });
});

describe('placeLine', () => {
  it('names the region, then the landmark in it', () => {
    expect(placeLine({place: 'Haro Strait', landmark: 'Lime Kiln'})).toBe('Haro Strait, off Lime Kiln');
    expect(placeLine({place: 'Mud Bay (Lopez Sound)', landmark: null})).toBe('Mud Bay (Lopez Sound)');
    expect(placeLine({place: 'off Oregon'})).toBe('off Oregon');
  });

  it('is null without a region', () => {
    expect(placeLine({place: null, landmark: null})).toBeNull();
    expect(placeLine({})).toBeNull();
  });
});
