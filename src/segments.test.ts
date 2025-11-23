import { test, expect, describe } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { occurrences2segments, segment2features, segment2travelLine } from './segments.ts';
import type { Occurrence } from './supabase.ts';

function loadOccurrences(): Occurrence[] {
  const filePath = path.resolve(process.cwd(), 'test/occurrences.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Omit<Occurrence, 'observed_at_ms'>[];
  return raw.map(o => ({...o, observed_at_ms: Date.parse(o.observed_at)}));
}

const occurrences = loadOccurrences();
const segments = occurrences2segments(occurrences);

// Captured baseline grouping from current implementation (see segments.baseline.test.ts output)
const expectedGrouping: string[][] = [
  ["inaturalist:327709844"],
  ["inaturalist:327576383"],
  ["inaturalist:327526185"],
  ["inaturalist:327576420"],
  ["inaturalist:327805540"],
  ["inaturalist:327793396"],
  ["inaturalist:327565072"],
  ["inaturalist:327591811","inaturalist:327592171"],
  ["maplify:239280"],
  ["inaturalist:327543285"],
  ["inaturalist:327622338"],
  ["inaturalist:327567122"],
  ["inaturalist:327601957"],
  ["inaturalist:327745916"],
  ["inaturalist:327691713"],
  ["maplify:239278"],
  ["inaturalist:327614570"],
  ["inaturalist:327618968"],
  ["inaturalist:327724008"],
  ["inaturalist:327768744"],
];

describe('occurrences2segments grouping', () => {
  test('produces expected grouping of occurrence IDs', () => {
    const actualGrouping = segments.map(s => s.occurrences.map(o => o.id));
    expect(actualGrouping).toEqual(expectedGrouping);
  });

  test('each segment occurrences are strictly increasing in time', () => {
    for (const seg of segments) {
      for (let i = 1; i < seg.occurrences.length; i++) {
        expect(seg.occurrences[i]!.observed_at_ms).toBeGreaterThan(seg.occurrences[i-1]!.observed_at_ms);
      }
    }
  });

  test('all occurrences are placed exactly once', () => {
    const allIds = segments.flatMap(s => s.occurrences.map(o => o.id));
    expect(new Set(allIds).size).toBe(occurrences.length);
  });
});

describe('segment2features', () => {
  test('flags first and last features', () => {
    for (const seg of segments) {
      const features = segment2features(seg);
      expect(features[0]?.get('isFirst')).toBe(true);
      expect(features[features.length - 1]?.get('isLast')).toBe(true);
    }
  });
});

describe('segment2travelLine', () => {
  test('returns null for single-occurrence segments and a feature otherwise', () => {
    for (const seg of segments) {
      const line = segment2travelLine(seg);
      if (seg.occurrences.length < 2) {
        expect(line).toBeNull();
      } else {
        expect(line).not.toBeNull();
        expect(line!.getId()).toBe(`line-from-${seg.occurrences[0]!.id}`);
      }
    }
  });
});
