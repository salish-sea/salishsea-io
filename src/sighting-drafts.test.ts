import { describe, it, expect } from 'vitest';
import { distanceLabel, roundRadius, SightingDrafts, suggestedAccuracy, type DraftPoints, type LonLat } from './sighting-drafts.ts';

// Lime Kiln, and two points due west of it: about 2 km, and about 40 m.
const shore: LonLat = [-123.1517, 48.5157];
const twoKm: LonLat = [-123.1789, 48.5157];
const close: LonLat = [-123.1522, 48.5157];

describe('suggestedAccuracy', () => {
  it('is a quarter of the distance, rounded to two figures', () => {
    expect(suggestedAccuracy(shore, twoKm)).toBe(500);
  });
  it('is never under 20 m', () => {
    expect(suggestedAccuracy(shore, close)).toBe(20);
  });
  it('is nothing without both points', () => {
    expect(suggestedAccuracy(null, twoKm)).toBeNull();
    expect(suggestedAccuracy(shore, null)).toBeNull();
  });
});

describe('roundRadius', () => {
  it('keeps two significant figures', () => {
    expect(roundRadius(1187)).toBe(1200);
    expect(roundRadius(47)).toBe(47);
  });
});

describe('distanceLabel', () => {
  it('says metres under a kilometre and kilometres above', () => {
    expect(distanceLabel(452)).toBe('450 m');
    expect(distanceLabel(2012)).toBe('2.0 km');
  });
});

describe('a draft that suggests its accuracy', () => {
  function draft(initial: Partial<DraftPoints>) {
    const heard: DraftPoints[] = [];
    const d = new SightingDrafts().create('s', points => heard.push(points), initial);
    return {d, heard};
  }

  it('follows the points until the author sets a radius', () => {
    const {d, heard} = draft({observer: shore, suggested: true});
    expect(d.accuracy).toBeNull();
    d.set('subject', twoKm);
    expect(heard.at(-1)).toMatchObject({accuracy: 500, suggested: true});
    d.setAccuracy(500);
    expect(d.suggested).toBe(true);
    d.setAccuracy(300);
    expect(heard.at(-1)).toMatchObject({accuracy: 300, suggested: false});
    d.set('subject', close);
    expect(d.accuracy).toBe(300);
  });

  it('stays cleared once the author clears it', () => {
    const {d} = draft({observer: shore, subject: twoKm, suggested: true});
    expect(d.accuracy).toBe(500);
    d.setAccuracy(null);
    d.set('subject', close);
    expect(d.accuracy).toBeNull();
  });

  it("doesn't suggest for a sighting that isn't new", () => {
    const {d} = draft({observer: shore, subject: twoKm, accuracy: null});
    d.set('subject', close);
    expect(d.accuracy).toBeNull();
  });
});
