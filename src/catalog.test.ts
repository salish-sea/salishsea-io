import { expect, test } from 'vitest';
import {
  dedupeOccurrenceLinks, displayName, populationPath, groupChain, individualPath, matrilineDesignation, matrilinePath, monthlyPresence,
  podPath, slugify,
  type IndividualOccurrence, type OccurrenceLink, type SocialGroup,
  distanceKm, hauloutPath, mediumPhotoUrl,
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

const T065AS = { entity_id: 'SSA:0002163', designation: 'T065A' };

// The slug is the group's written form, not the matriarch's code (034's example).
test('composes a matriline path from its identifier, slugged as the group is written', () => {
  expect(matrilinePath(T065AS)).toBe('/matrilines/0002163/T065As');
});

test('reads a typed matriline designation as the folded matriarch code the catalogue keys on', () => {
  expect(matrilineDesignation('T065A')).toBe('t65a');
  expect(matrilineDesignation('T65As')).toBe('t65a');
  expect(matrilineDesignation('t073s')).toBe('t73');
});

test('addresses a matriline with no identifier by its designation', () => {
  expect(matrilinePath({ entity_id: null, designation: 'T065A' })).toBe('/matrilines/T065A');
});

const BIGGS = { entity_id: 'SSA:0000002', designation: 'Biggs' };

test('a pod is addressed by its name, J pod, though its designation is the letter', () => {
  expect(podPath({ entity_id: 'SSA:0000020', designation: 'J' })).toBe('/pods/0000020/J-pod');
});

test('composes population paths the same way', () => {
  expect(populationPath(BIGGS)).toBe('/populations/0000002/Biggs');
  expect(populationPath({ entity_id: 'SSA:0000002', designation: "Bigg's" })).toBe('/populations/0000002/Biggs');
});

const link = (over: Partial<IndividualOccurrence>): IndividualOccurrence => ({
  individual_id: 1,
  occurrence_id: 'maplify:1',
  observed_at: '2026-06-14T17:36:00+00:00',
  location: { lon: -123.07, lat: 48.6 },
  certainty: null,
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

// Two groups linking one sighting arrive in no stated order; the page must not say
// "as T068C" on one load and "as T068" on the next (decision 057).
test('between two via-group claims, the alphabetically first group, whatever the row order', () => {
  const rows = [link({ occurrence_id: 'a', via_group: 'T068C' }), link({ occurrence_id: 'a', via_group: 'T068' })];
  expect(dedupeOccurrenceLinks(rows)[0]?.via_group).toBe('T068');
  expect(dedupeOccurrenceLinks([...rows].reverse())[0]?.via_group).toBe('T068');
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
  id, designation, designation_folded: null, parent_group_id: parent, kind: 'matriline', anchor_individual_id: null, entity_id: null,
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

// Decision 040: a haul-out site keys on its own integer id; the slug is the
// site's name, composed by us and ignored on read.
test('composes the haul-out path from id and name', () => {
  expect(hauloutPath({ id: 340, name: 'Shilshole Bay Area' })).toBe('/haulouts/340/Shilshole-Bay-Area');
  expect(hauloutPath({ id: 12, name: "Smith Island (E. side)" })).toBe('/haulouts/12/Smith-Island-E-side');
});

test('measures the distance between two sites in kilometres', () => {
  // The two Shilshole rows in the atlas: the north floats and the south tip of the jetty.
  const km = distanceKm({ lon: -122.40633, lat: 47.68517 }, { lon: -122.41117, lat: 47.67817 });
  expect(km).toBeGreaterThan(0.8);
  expect(km).toBeLessThan(0.9);
});

test('upgrades a mirrored iNaturalist thumbnail to the medium size, and only on the known hosts', () => {
  expect(mediumPhotoUrl('https://inaturalist-open-data.s3.amazonaws.com/photos/565296662/square.jpg'))
    .toBe('https://inaturalist-open-data.s3.amazonaws.com/photos/565296662/medium.jpg');
  expect(mediumPhotoUrl('https://static.inaturalist.org/photos/1/square.jpeg')).toBe('https://static.inaturalist.org/photos/1/medium.jpeg');
  expect(mediumPhotoUrl('https://evil.example/photos/1/square.jpg')).toBe('https://evil.example/photos/1/square.jpg');
});
