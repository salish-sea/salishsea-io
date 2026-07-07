import { expect, test } from 'vitest';
import {
  dedupeOccurrenceLinks, displayName, groupChain, individualPath, monthlyPresence,
  normalizeDesignation, parseIndividualPath,
  type IndividualOccurrence, type OccurrenceLink, type SocialGroup,
} from './catalog.ts';

test('parses /individuals/<designation> paths', () => {
  expect(parseIndividualPath('/individuals/T065A')).toBe('T065A');
  expect(parseIndividualPath('/individuals/T065A/')).toBe('T065A');
  expect(parseIndividualPath('/individuals/T065A5')).toBe('T065A5');
  expect(parseIndividualPath('/individuals/')).toBeNull();
  expect(parseIndividualPath('/individuals/T065A/photos')).toBeNull();
  expect(parseIndividualPath('/')).toBeNull();
  expect(parseIndividualPath('/about.html')).toBeNull();
});

test('individualPath round-trips through parseIndividualPath', () => {
  for (const designation of ['T065A', 'CA20', 'AM25 X']) {
    expect(parseIndividualPath(individualPath(designation))).toBe(designation);
  }
});

// Mirrors public.normalize_designation (20260707220211_identifications.sql)
test('normalizes sighting codes to padded catalog keys', () => {
  expect(normalizeDesignation('T65A5')).toBe('T065A5');
  expect(normalizeDesignation('t65a5')).toBe('T065A5');
  expect(normalizeDesignation('T65')).toBe('T065');
  expect(normalizeDesignation('T065A')).toBe('T065A');
  expect(normalizeDesignation('T2B')).toBe('T002B');
  expect(normalizeDesignation(' T137 ')).toBe('T137');
  expect(normalizeDesignation('CRC56')).toBe('CRC56');
  expect(normalizeDesignation('J26')).toBe('J26');
  expect(normalizeDesignation('CA20')).toBe('CA20');
});

const link = (over: Partial<IndividualOccurrence>): IndividualOccurrence => ({
  individual_id: 1,
  occurrence_id: 'maplify:1',
  observed_at: '2026-06-14T17:36:00+00:00',
  is_present: true,
  status: 'candidate',
  evidence: 'text_mention',
  code: 'T65A',
  via_group: null,
  ...over,
});

test('dedupes occurrence links, preferring direct claims over via-group', () => {
  const rows = [
    link({ occurrence_id: 'a', via_group: 'T065s' }),
    link({ occurrence_id: 'a', via_group: null }),
    link({ occurrence_id: 'b', via_group: 'T065s' }),
  ];
  const deduped = dedupeOccurrenceLinks(rows);
  expect(deduped).toHaveLength(2);
  expect(deduped.find(l => l.occurrence_id === 'a')?.via_group).toBeNull();
  expect(deduped.find(l => l.occurrence_id === 'b')?.via_group).toBe('T065s');
});

test('drops absence claims and rejected identifications', () => {
  const rows = [
    link({ occurrence_id: 'a', is_present: false }),
    link({ occurrence_id: 'b', status: 'rejected' }),
    link({ occurrence_id: 'c' }),
  ];
  expect(dedupeOccurrenceLinks(rows).map(l => l.occurrence_id)).toEqual(['c']);
});

test('sorts deduped links newest first', () => {
  const rows = [
    link({ occurrence_id: 'old', observed_at: '2024-01-01T00:00:00+00:00' }),
    link({ occurrence_id: 'new', observed_at: '2026-06-01T00:00:00+00:00' }),
  ];
  expect(dedupeOccurrenceLinks(rows).map(l => l.occurrence_id)).toEqual(['new', 'old']);
});

test('aggregates presence by PST8PDT calendar month', () => {
  const links: OccurrenceLink[] = [
    // 2026-01-01T02:00Z is still 2025-12-31 in PST8PDT
    { occurrence_id: 'a', observed_at: '2026-01-01T02:00:00+00:00', is_present: true, status: 'candidate', via_group: null },
    { occurrence_id: 'b', observed_at: '2026-06-14T17:36:00+00:00', is_present: true, status: 'candidate', via_group: null },
    { occurrence_id: 'c', observed_at: '2026-06-20T17:36:00+00:00', is_present: true, status: 'candidate', via_group: null },
    { occurrence_id: 'd', observed_at: '2020-06-20T17:36:00+00:00', is_present: true, status: 'candidate', via_group: null },
  ];
  const grid = monthlyPresence(links, 2, 2026);
  expect(grid).toHaveLength(2);
  expect(grid[0]).toEqual({ year: 2026, months: [0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0] });
  expect(grid[1]!.year).toBe(2025);
  expect(grid[1]!.months[11]).toBe(1); // the UTC-January row lands in December
});

const group = (id: number, designation: string, parent: number | null): SocialGroup => ({
  id, designation, parent_group_id: parent, kind: 'matriline', anchor_individual_id: null, notes: null,
});

test('walks the group chain to the root and survives cycles', () => {
  const groups = new Map([
    [1, group(1, 'T065A', 2)],
    [2, group(2, 'T065', 3)],
    [3, { ...group(3, 'Biggs', null), kind: 'ecotype' as const }],
  ]);
  expect(groupChain(1, groups).map(g => g.designation)).toEqual(['T065A', 'T065', 'Biggs']);

  const cyclic = new Map([[1, group(1, 'A', 2)], [2, group(2, 'B', 1)]]);
  expect(groupChain(1, cyclic).map(g => g.designation)).toEqual(['A', 'B']);
});

test('picks the display name by nickname status', () => {
  expect(displayName([
    { name: 'Old', status: 'deprecated' },
    { name: 'Whidbey', status: 'official' },
  ])).toBe('Whidbey');
  expect(displayName([{ name: 'Proposed', status: 'proposed' }])).toBe('Proposed');
  expect(displayName([{ name: 'Old', status: 'deprecated' }])).toBeNull();
  expect(displayName([])).toBeNull();
});
