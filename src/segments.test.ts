import { test, expect, describe } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ecotypesOf, occurrences2segments, segment2features, segment2travelLine } from './segments.ts';
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
    observed_until: null,
    certainty: null,
    taxon: {scientific_name: 'Orcinus orca ater', vernacular_name: 'Resident Killer Whale', species_id: 41521, entity_id: null},
    identifiers: [],
    contributor_id: 7,
    observer: 'Scott Veirs',
    collection: 'SalishSea.io Direct',
    source_url: null,
    organization: null,
    organization_url: null,
    provider: 'SalishSea.io Direct',
    provider_slug: 'direct',
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

describe('segment2features head metadata', () => {
  // Decision 029 puts one label on each segment head and lets it speak for the
  // whole track, so the head has to carry what the track knows.
  const multiPoint = segments.find(s => s.occurrences.length > 1)!;

  test('the head is the last point, not the first', () => {
    const features = segment2features(multiPoint);
    expect(features[features.length - 1]!.get('isLast')).toBe(true);
    expect(features[0]!.get('isFirst')).toBe(true);
    expect(features[0]!.get('isLast')).toBeUndefined();
  });

  test('the head knows the size and span of its track', () => {
    const features = segment2features(multiPoint);
    const head = features[features.length - 1]!;
    const occurrences = multiPoint.occurrences;
    expect(head.get('segmentLength')).toBe(occurrences.length);
    expect(head.get('segmentSpanHours')).toBeCloseTo(
      (occurrences[occurrences.length - 1]!.observed_at_ms - occurrences[0]!.observed_at_ms) / 3600000,
    );
  });

  test('identifiers are pooled over the track, deduplicated and sorted', () => {
    // A pod reported on one sighting of an encounter and not the next still
    // names the whole track.
    const features = segment2features(multiPoint);
    const pooled = features[features.length - 1]!.get('segmentIdentifiers') as string[];
    const expected = [...new Set(multiPoint.occurrences.flatMap(o => o.identifiers ?? []))].sort();
    expect(pooled).toEqual(expected);
  });

  test('the head carries an identity pooled from the whole track', () => {
    const features = segment2features(multiPoint);
    const head = features[features.length - 1]!;
    expect(typeof head.get('segmentIdentity')).toBe('string');
    expect((head.get('segmentIdentity') as string).length).toBeGreaterThan(0);
  });

  test('a singleton is a segment of one, and is its own head', () => {
    const singleton = segments.find(s => s.occurrences.length === 1)!;
    const [only] = segment2features(singleton);
    expect(only!.get('isFirst')).toBe(true);
    expect(only!.get('isLast')).toBe(true);
    expect(only!.get('segmentLength')).toBe(1);
    expect(only!.get('segmentSpanHours')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Decision 063: every segment stays open at once; a sighting joins the one
// nearest in space and time, and never one that names another ecotype. The
// six cases below are the ones that decided it, read from production into
// test/segment-days.json (every tracked-species sighting on those five days).
// ---------------------------------------------------------------------------
type DaySighting = Pick<Occurrence, 'id' | 'observed_at_ms' | 'location' | 'identifiers'> & {
  day: string; time: string; taxon: Pick<Occurrence['taxon'], 'species_id' | 'scientific_name'>;
};
const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'test/segment-days.json'), 'utf-8')) as DaySighting[];
const asOccurrence = (s: DaySighting): Occurrence => ({
  ...makeOrca(s.id, new Date(s.observed_at_ms).toISOString(), s.location.lon, s.location.lat),
  taxon: {...s.taxon, vernacular_name: null, entity_id: null},
  identifiers: s.identifiers,
});

/** One day's segments, and a way to ask what a sighting follows. */
function day(date: string) {
  const sightings = fixture.filter(s => s.day === date);
  const segments = occurrences2segments(sightings.map(asOccurrence));
  /** The sighting reported at `time`, narrowed by what it said when two share a minute. */
  const at = (time: string, said?: string) => {
    const matches = sightings.filter(s => s.time === time &&
      (said === undefined || (s.identifiers ?? []).includes(said) || s.taxon.scientific_name.endsWith(said)));
    if (matches.length !== 1) throw new Error(`${matches.length} sightings at ${date} ${time} ${said ?? ''}`);
    return matches[0]!.id;
  };
  /** The time of the sighting this one follows on its segment, or null if it starts one. */
  const follows = (time: string, said?: string) => {
    const id = at(time, said);
    const segment = segments.find(seg => seg.occurrences.some(o => o.id === id))!;
    const i = segment.occurrences.findIndex(o => o.id === id);
    return i === 0 ? null : fixture.find(s => s.id === segment.occurrences[i - 1]!.id)!.time;
  };
  return {segments, follows};
}

describe('decision 063 cases', () => {
  test('3 Sep 2026: Scott\'s first T49As sighting starts his track, and the morning reports keep to themselves (#445)', () => {
    const {follows} = day('2026-09-03');
    expect(follows('14:56')).toBeNull();
    expect(follows('15:02')).toBe('14:56');
  });

  test('3 Sep 2026: K pod and the T123s/T100s/T46Bs each keep their own track up Admiralty Inlet', () => {
    const {follows} = day('2026-09-03');
    expect(follows('12:35')).toBe('12:23');
    expect(follows('12:50', 'T123s')).toBe('11:30');
    // A Southern Resident report never joins the Bigg's track.
    expect(follows('19:30')).toBeNull();
  });

  test('19 Sep 2026: T137A east of Whidbey is not joined to the T36s/T49A1 west of it', () => {
    const {follows} = day('2026-09-19');
    expect(follows('12:19')).toBe('10:58');
    expect(follows('11:34')).toBe('11:19');
  });

  test('11 Sep 2023: the T18s near Victoria keep their track while J pod passes', () => {
    const {follows} = day('2023-09-11');
    expect(follows('17:17')).toBe('12:32');
    expect(follows('17:50')).toBe('15:54');
  });

  test('29 Mar 2026: the T99s are not carried into J pod\'s afternoon', () => {
    const {follows} = day('2026-03-29');
    expect(follows('14:55')).toBe('11:58');
    expect(follows('17:32')).toBe('16:00');
  });

  test('23 Jan 2026: a Bigg\'s report a minute after J pod\'s is drawn alone, and J pod\'s track begins with J pod', () => {
    const {follows} = day('2026-01-23');
    expect(follows('09:45')).toBeNull();
    expect(follows('11:54')).toBe('09:44');
  });

  test.each(['2026-09-03', '2026-09-19', '2023-09-11', '2026-03-29', '2026-01-23'])(
    '%s: no segment holds both a resident and a Bigg\'s report', date => {
      for (const {occurrences} of day(date).segments) {
        const named = new Set(occurrences.flatMap(o => [...ecotypesOf(o)]));
        expect(named.size).toBeLessThan(2);
      }
    });
});

describe('ecotypesOf', () => {
  const orca = (scientific_name: string, identifiers: string[] = []) =>
    ({taxon: {scientific_name}, identifiers});
  test('reads the subspecies', () => {
    expect([...ecotypesOf(orca('Orcinus orca ater'))]).toEqual(['resident']);
    expect([...ecotypesOf(orca('Orcinus orca rectipinnus'))]).toEqual(['biggs']);
    expect(ecotypesOf(orca('Orcinus orca')).size).toBe(0);
  });
  test('reads named pods, IDs and ecotypes', () => {
    for (const id of ['J pod', 'K', 'L87', 'J47', 'Southern Resident'])
      expect([...ecotypesOf(orca('Orcinus orca', [id]))]).toEqual(['resident']);
    for (const id of ['T49As', 'T049A1', "Bigg's"])
      expect([...ecotypesOf(orca('Orcinus orca', [id]))]).toEqual(['biggs']);
  });
  test('a report that contradicts itself names both', () => {
    expect(ecotypesOf(orca('Orcinus orca ater', ['T65As'])).size).toBe(2);
  });
});
