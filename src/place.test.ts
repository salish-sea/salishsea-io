import { describe, expect, it } from 'vitest';

import { mainPlace, placeSpan } from './place.ts';

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
