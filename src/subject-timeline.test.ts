// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Encounter } from './encounter.ts';
import { setCatalogCodes } from './individual-links.ts';
import { reportsLine, scopeStart, summarizeSpan, type SubjectTimeline } from './subject-timeline.ts';

setCatalogCodes({
  designations: [
    {code: 'T065A5', individual: {entity_id: 'SSA:0010197', primary_designation: 'T065A5'}},
    {code: 'T037', individual: {entity_id: 'SSA:0010082', primary_designation: 'T037'}},
  ],
  groups: [
    {kind: 'matriline', designation: 'T065A', entity_id: 'SSA:0002163'},
    {kind: 'matriline', designation: 'T137', entity_id: 'SSA:0002078'},
    {kind: 'ecotype', designation: "Bigg's", entity_id: 'SSA:0000020'},
  ],
});

const OWN = ['/individuals/0010197/T065A5', '/matrilines/0002163/T065As'];
const CODES = (await import('./individual-links.ts'));
const codes = [CODES.catalogCodes()!, CODES.matrilineCodes()!, CODES.populationCodes()!, CODES.podCodes()!] as const;

const encounter = (day: string, more: Partial<Encounter> = {}): Encounter => ({
  day, start: `${day}T18:00:00+00:00`, end: `${day}T20:00:00+00:00`, reports: 3, ids: [`${day}-a`, `${day}-b`], as_self: 2,
  identifiers: [], location: {lon: -122.5, lat: 47.3}, photos: [], channels: [['Orca Network', 3]], ...more,
});

describe('the past 12 months', () => {
  test('begin on the first of the month eleven months before this one, on the Pacific clock', () => {
    expect(scopeStart(Date.parse('2026-10-28T12:00:00Z'))).toBe('2025-11-01');
    // Still 31 October in Seattle.
    expect(scopeStart(Date.parse('2026-11-01T06:00:00Z'))).toBe('2025-11-01');
    expect(scopeStart(Date.parse('2026-11-01T08:00:00Z'))).toBe('2025-12-01');
  });
});

describe("a span's summary", () => {
  const list = [
    encounter('2026-10-25', {identifiers: [['T65A5', 'T37', 'T137s'], ['T65As', 'T37'], ["Bigg's"]], location: {lon: -122.66, lat: 47.35}}),
    encounter('2026-10-24', {identifiers: [['T65A5', 'T137s?']], location: {lon: -122.5, lat: 48.15}, reports: 2, ids: ['x'], as_self: 0}),
    encounter('2026-10-24', {location: {lon: -122.51, lat: 48.16}, channels: [['SalishSea.io', 1], ['Orca Network', 1]]}),
  ];
  const placeOf = (e: Encounter) => e.location!.lat > 48 ? 'Saratoga Passage' : 'Henderson Bay';
  const s = summarizeSpan(list, {placeOf, ownPaths: OWN, codes: [...codes]});

  test('counts days, not encounters, at each place, and names the two farthest apart', () => {
    expect(s.days).toBe(2);
    expect(s.waters).toEqual([{name: 'Henderson Bay', days: 1}, {name: 'Saratoga Passage', days: 1}]);
    expect(s.farthest).toMatchObject({from: 'Henderson Bay', to: 'Saratoga Passage'});
    expect(s.farthest!.km).toBeGreaterThan(80);
  });

  test('names no range within one place, however far apart its encounters were', () => {
    const one = summarizeSpan(list, {placeOf: () => 'Puget Sound', ownPaths: OWN, codes: [...codes]});
    expect(one.farthest).toBeNull();
  });

  test("counts the encounters naming each other animal, leaving out the subject, its groups and its population", () => {
    expect(s.others.map(({label, encounters, possibly}) => [label, encounters, possibly])).toEqual([
      ['T137s', 2, false], ['T37', 1, false],
    ]);
  });

  test('adds up its reports and its channels', () => {
    expect([s.naming, s.asSelf, s.reports]).toEqual([5, 4, 8]);
    expect(s.channels).toEqual([['Orca Network', 7], ['SalishSea.io', 1]]);
  });
});

describe('the line on how the reports name it', () => {
  test.each([
    [{naming: 86, asSelf: 74, reports: 140}, '86 of 140 reports name T065A5, 12 of them through a group it is in'],
    [{naming: 30, asSelf: 30, reports: 30}, 'All 30 reports name T065A5'],
    [{naming: 10, asSelf: 0, reports: 10}, 'All 10 reports name T065A5, all through a group it is in'],
    [{naming: 1, asSelf: 1, reports: 1}, 'The one report names T065A5'],
    [{naming: 1, asSelf: 0, reports: 4}, '1 of 4 reports names T065A5, through a group it is in'],
  ])('%o', (counts, line) => expect(reportsLine('T065A5', counts)).toBe(line));
});

describe('the timeline', () => {
  afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

  async function mount(scope: 'year' | 'all') {
    // No day files or place lists: the cards say they couldn't load, the rows name no place.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {status: 500})));
    const timeline = document.createElement('subject-timeline') as SubjectTimeline;
    timeline.encounters = [
      encounter('2026-10-25'), encounter('2026-10-03'), encounter('2026-07-14'),
      encounter('2026-01-05'), encounter('2025-10-30'), encounter('2023-06-01'),
    ];
    timeline.designation = 'T065A5';
    timeline.ownPaths = OWN;
    timeline.scope = scope;
    timeline.now = Date.parse('2026-10-28T12:00:00Z');
    document.body.appendChild(timeline);
    await timeline.updateComplete;
    return timeline.shadowRoot!;
  }

  const titles = (root: ShadowRoot) => [...root.querySelectorAll('article.span > header h3')]
    .filter(h => !h.closest('details')).map(h => h.textContent);

  test('lists the past 12 months a card each, newest first and the newest open, with the gaps between', async () => {
    const root = await mount('year');
    expect(titles(root)).toEqual(['October 2026', 'July 2026', 'January 2026']);
    expect([...root.querySelectorAll('article.span > details')].map(d => (d as HTMLDetailsElement).open)).toEqual([true, false, false]);
    expect([...root.querySelectorAll('.gap')].map(g => g.textContent)).toEqual([
      'No reports in August 2026 to September 2026', 'No reports in February 2026 to June 2026',
    ]);
    expect(root.querySelector('.notable')?.textContent).toBe('First report in 81 days');
  });

  test('marks the first report of a year', async () => {
    const root = await mount('year');
    const january = [...root.querySelectorAll('article.span')].find(a => a.querySelector('h3')?.textContent === 'January 2026')!;
    expect(january.querySelector('.notable')?.textContent).toBe('First report of 2026: Mon, Jan 5, after 67 days without one');
  });

  test('adds a card per earlier year under All time', async () => {
    const root = await mount('all');
    expect(titles(root)).toEqual(['October 2026', 'July 2026', 'January 2026', '2025', '2023']);
  });

  test("opens an encounter's line to its card", async () => {
    const root = await mount('year');
    const line = root.querySelector<HTMLDetailsElement>('details.encounter')!;
    const card = line.querySelector('encounter-card')!;
    expect(card.lazy).toBe(true);
    line.open = true;
    line.dispatchEvent(new Event('toggle'));
    await card.updateComplete;
    expect(card.lazy).toBe(false);
  });
});
