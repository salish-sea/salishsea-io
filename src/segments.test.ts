import { test, expect, describe } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { occurrences2segments, segment2features, segment2travelLine } from './segments.ts';
import type { Occurrence } from './types.ts';

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

// ---------------------------------------------------------------------------
// Regression: a pod observation ~7.9 km away in 18 minutes was excluded from
// the track because the greedy algorithm rejected it before accepting a later
// observation that implied a slower speed.  The fix relaxes the speed
// multiplier from 1.5× to 3.0×, reflecting that orcas transit considerably
// faster than their mean travel speed during short windows.
//
// Data sourced from J-pod observations on 2026-03-29 (Scott Veirs).
// ---------------------------------------------------------------------------
function makeOrca(id: string, isoUtc: string, lon: number, lat: number): Occurrence {
  return {
    id,
    url: null,
    attribution: 'Scott Veirs on SalishSea.io',
    body: null,
    count: null,
    direction: null,
    location: {lon, lat},
    accuracy: null,
    photos: [],
    observed_at: isoUtc,
    observed_at_ms: Date.parse(isoUtc),
    observed_from: null,
    taxon: {scientific_name: 'Orcinus orca ater', vernacular_name: 'Resident Killer Whale', species_id: 41521},
    identifiers: [],
    contributor_id: 7,
  };
}

describe('orca short-window transit regression', () => {
  // Three consecutive J-pod observations on 2026-03-29:
  //   prev  019d3d0b  01:12 UTC  Andrews Bay hydrophones     (-123.2363, 48.6177)
  //   gap   019d3d1d  01:30 UTC  Lime Kiln / Land Bank       (-123.2285, 48.5466)  ← was excluded
  //   next  019d3d12  02:33 UTC  LK webcam                   (-123.2374, 48.5226)
  //
  // The "gap" point is 7.9 km south of "prev" reached in 18 minutes (~26 km/h
  // straight-line), which exceeds the old 1.5× mean-speed threshold (9.9 km/h)
  // but is well within the new 3.0× threshold (19.8 km/h effective).
  const prev = makeOrca('019d3d0b', '2026-03-30T01:12:00Z', -123.2363, 48.6177);
  const gap  = makeOrca('019d3d1d', '2026-03-30T01:30:00Z', -123.2285, 48.5466);
  const next = makeOrca('019d3d12', '2026-03-30T02:33:00Z', -123.2374, 48.5226);

  test('all three points form a single segment', () => {
    const segs = occurrences2segments([prev, gap, next]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.occurrences.map(o => o.id)).toEqual(['019d3d0b', '019d3d1d', '019d3d12']);
  });
});
