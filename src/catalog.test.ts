import { expect, test } from 'vitest';
import {
  dedupeOccurrenceLinks, displayName, ecotypePath, groupChain, individualPath, keyLabel, matrilinePath, monthlyPresence,
  normalizeDesignation, parseEcotypePath, parseIndividualPath, parseMatrilinePath, slugify,
  type IndividualOccurrence, type OccurrenceLink, type SocialGroup,
} from './catalog.ts';

// Decision 034: the URL keys on the register identifier's seven-digit local
// part; the designation is a slug, composed by us and ignored on read.
const T065A = { entity_id: 'SSA:0010193', primary_designation: 'T065A' };

test('composes the canonical individual path from identifier and designation', () => {
  expect(individualPath(T065A)).toBe('/individuals/0010193/T065A');
  // Conventional casing survives; nothing is lower-cased.
  expect(individualPath({ entity_id: 'SSA:0010194', primary_designation: 'T065A2' })).toBe('/individuals/0010194/T065A2');
  // A row that has no identifier yet is addressed as before.
  expect(individualPath({ entity_id: null, primary_designation: 'AM25 X' })).toBe('/individuals/AM25%20X');
});

test('slugs drop apostrophes and collapse other punctuation', () => {
  expect(slugify("Bigg's")).toBe('Biggs');
  expect(slugify('Bigg’s')).toBe('Biggs');
  expect(slugify('AM25 X')).toBe('AM25-X');
  expect(slugify('T090 matriline')).toBe('T090-matriline');
  expect(slugify(' / ')).toBe('');
});

test('reads the identifier from a keyed path and ignores the slug', () => {
  const key = { kind: 'entity', entityId: 'SSA:0010193', slug: 'T065A' };
  expect(parseIndividualPath('/individuals/0010193/T065A')).toEqual(key);
  expect(parseIndividualPath('/individuals/0010193/T065A/')).toEqual(key);
  expect(parseIndividualPath('/individuals/0010193/anything-at-all')).toEqual({ ...key, slug: 'anything-at-all' });
  expect(parseIndividualPath('/individuals/0010193')).toEqual({ ...key, slug: null });
  expect(parseIndividualPath('/individuals/0010193/')).toEqual({ ...key, slug: null });
});

test('reads a designation from a legacy or typed path', () => {
  expect(parseIndividualPath('/individuals/T065A')).toEqual({ kind: 'designation', designation: 'T065A' });
  expect(parseIndividualPath('/individuals/T065A/')).toEqual({ kind: 'designation', designation: 'T065A' });
  expect(parseIndividualPath('/individuals/t65a')).toEqual({ kind: 'designation', designation: 't65a' });
  expect(parseIndividualPath('/individuals/AM25%20X')).toEqual({ kind: 'designation', designation: 'AM25 X' });
  // Six or eight digits are not an identifier; they are a (nonexistent) designation.
  expect(parseIndividualPath('/individuals/001019')).toEqual({ kind: 'designation', designation: '001019' });
});

test('rejects paths that are not a profile', () => {
  expect(parseIndividualPath('/individuals/')).toBeNull();
  expect(parseIndividualPath('/individuals/T065A/photos')).toBeNull();
  expect(parseIndividualPath('/individuals/0010193/T065A/photos')).toBeNull();
  expect(parseIndividualPath('/individuals/%E0%A4%A')).toBeNull(); // malformed escape
  expect(parseIndividualPath('/')).toBeNull();
  expect(parseIndividualPath('/about.html')).toBeNull();
  expect(parseIndividualPath('/matrilines/T065A')).toBeNull();
});

test('individualPath round-trips through parseIndividualPath', () => {
  expect(parseIndividualPath(individualPath(T065A))).toEqual({ kind: 'entity', entityId: 'SSA:0010193', slug: 'T065A' });
  for (const designation of ['T065A', 'CA20', 'AM25 X']) {
    expect(parseIndividualPath(individualPath({ entity_id: null, primary_designation: designation })))
      .toEqual({ kind: 'designation', designation });
  }
});

test('labels a key for the placeholder and not-found copy', () => {
  expect(keyLabel({ kind: 'entity', entityId: 'SSA:0010193', slug: 'T065A' })).toBe('SSA:0010193');
  expect(keyLabel({ kind: 'designation', designation: 'T065A' })).toBe('T065A');
});

// Matrilines are not keyed yet (salish-ox2.6): the designation path is canonical.
test('parses /matrilines/<designation> paths', () => {
  expect(parseMatrilinePath('/matrilines/T065A')).toBe('T065A');
  expect(parseMatrilinePath('/matrilines/T065A/')).toBe('T065A');
  expect(parseMatrilinePath('/matrilines/')).toBeNull();
  expect(parseMatrilinePath('/matrilines/T065A/photos')).toBeNull();
  expect(parseMatrilinePath('/matrilines/0002039/T073s')).toBeNull();
  expect(parseMatrilinePath('/individuals/T065A')).toBeNull();
  expect(parseIndividualPath('/matrilines/T065A')).toBeNull();
});

test('matrilinePath round-trips through parseMatrilinePath', () => {
  for (const designation of ['T065A', 'T046B', 'AM25 X']) {
    expect(parseMatrilinePath(matrilinePath(designation))).toBe(designation);
  }
});

const BIGGS = { entity_id: 'SSA:0000002', designation: 'Biggs' };

test('composes and parses ecotype paths the same way', () => {
  expect(ecotypePath(BIGGS)).toBe('/ecotypes/0000002/Biggs');
  expect(ecotypePath({ entity_id: 'SSA:0000002', designation: "Bigg's" })).toBe('/ecotypes/0000002/Biggs');
  expect(parseEcotypePath('/ecotypes/0000002/Biggs')).toEqual({ kind: 'entity', entityId: 'SSA:0000002', slug: 'Biggs' });
  expect(parseEcotypePath('/ecotypes/Biggs')).toEqual({ kind: 'designation', designation: 'Biggs' });
  expect(parseEcotypePath('/ecotypes/Biggs/')).toEqual({ kind: 'designation', designation: 'Biggs' });
  expect(parseEcotypePath('/ecotypes/')).toBeNull();
  expect(parseEcotypePath('/ecotypes/Biggs/members')).toBeNull();
  expect(parseEcotypePath('/matrilines/Biggs')).toBeNull();
  expect(parseMatrilinePath('/ecotypes/Biggs')).toBeNull();
});

test('ecotypePath round-trips through parseEcotypePath', () => {
  expect(parseEcotypePath(ecotypePath(BIGGS))).toEqual({ kind: 'entity', entityId: 'SSA:0000002', slug: 'Biggs' });
  for (const designation of ['Biggs', 'Southern Residents']) {
    expect(parseEcotypePath(ecotypePath({ entity_id: null, designation }))).toEqual({ kind: 'designation', designation });
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
  location: { lon: -123.07, lat: 48.6 },
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

test('dedupes group_occurrences-shaped rows, which carry no via_group', () => {
  const { via_group: _elide, ...groupRow } = link({ occurrence_id: 'a' });
  const deduped = dedupeOccurrenceLinks([groupRow, { ...groupRow, occurrence_id: 'b' }]);
  expect(deduped).toHaveLength(2);
  expect(deduped.every(l => l.via_group === null)).toBe(true);
});

test('sorts deduped links newest first', () => {
  const rows = [
    link({ occurrence_id: 'old', observed_at: '2024-01-01T00:00:00+00:00' }),
    link({ occurrence_id: 'new', observed_at: '2026-06-01T00:00:00+00:00' }),
  ];
  expect(dedupeOccurrenceLinks(rows).map(l => l.occurrence_id)).toEqual(['new', 'old']);
});

test('aggregates presence by PST8PDT calendar month', () => {
  const at = (occurrence_id: string, observed_at: string): OccurrenceLink =>
    ({ occurrence_id, observed_at, location: null, is_present: true, status: 'candidate', via_group: null });
  const links: OccurrenceLink[] = [
    // 2026-01-01T02:00Z is still 2025-12-31 in PST8PDT
    at('a', '2026-01-01T02:00:00+00:00'),
    at('b', '2026-06-14T17:36:00+00:00'),
    at('c', '2026-06-20T17:36:00+00:00'),
    at('d', '2020-06-20T17:36:00+00:00'),
  ];
  const grid = monthlyPresence(links, 2, 2026);
  expect(grid).toHaveLength(2);
  expect(grid[0]).toEqual({ year: 2026, months: [0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0] });
  expect(grid[1]!.year).toBe(2025);
  expect(grid[1]!.months[11]).toBe(1); // the UTC-January row lands in December
});

const group = (id: number, designation: string, parent: number | null): SocialGroup => ({
  id, designation, parent_group_id: parent, kind: 'matriline', anchor_individual_id: null, notes: null, entity_id: null,
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
