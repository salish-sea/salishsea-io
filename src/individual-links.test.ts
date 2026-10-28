import { expect, test } from 'vitest';
import { ecotypeCodes, injectIndividualLinks, matrilineCodes, namedAnimals, pooledAnimals, setCatalogCodes } from './individual-links.ts';

// Links carry the register identifier and the designation as its slug (034).
const T065A5 = { entity_id: 'SSA:0010197', primary_designation: 'T065A5' };
const T065A = { entity_id: 'SSA:0010193', primary_designation: 'T065A' };
const T122 = { entity_id: 'SSA:0010368', primary_designation: 'T122' };

// Keyed by the register's fold, as loadCatalogCodes builds them.
const codes = new Map([
  ['t65a5', T065A5],
  ['t65a', T065A],
  ['t122', T122],   // renamed from T46A; both codes resolve to T122
  ['t46a', T122],
]);

const matrilines = new Map([
  ['t65as', { entity_id: 'SSA:0002163', designation: 'T065A' }],
  ['t46bs', { entity_id: 'SSA:0002149', designation: 'T046B' }],
]);

const ecotypes = new Map([
  ['Biggs', { entity_id: 'SSA:0000002', designation: 'Biggs' }],
]);

test('links resolvable codes to individual pages', () => {
  expect(injectIndividualLinks('Likely T65A5 slowly northbound', codes))
    .toBe('Likely [T65A5](/individuals/0010197/T065A5) slowly northbound');
});

test('links superseded codes to the individual that now carries them', () => {
  expect(injectIndividualLinks('T46A heading south', codes))
    .toBe('[T46A](/individuals/0010368/T122) heading south');
});

test('addresses an individual with no identifier yet by designation', () => {
  const unkeyed = new Map([['t999', { entity_id: null, primary_designation: 'T999' }]]);
  expect(injectIndividualLinks('T999 offshore', unkeyed)).toBe('[T999](/individuals/T999) offshore');
});

test('links matriline codes to matriline pages', () => {
  expect(injectIndividualLinks('the T65As northbound', codes, matrilines))
    .toBe('the [T65As](/matrilines/0002163/T065As) northbound');
  // Case and separators normalize the same way as individual codes
  expect(injectIndividualLinks('t-46bs milling', codes, matrilines))
    .toBe('[t-46bs](/matrilines/0002149/T046Bs) milling');
});

test('leaves unresolvable and already-linked codes alone', () => {
  // Matriline codes with no cataloged group stay plain text
  expect(injectIndividualLinks('the T99s northbound', codes, matrilines))
    .toBe('the T99s northbound');
  // Without a matriline map (older call sites), matriline codes stay plain text
  expect(injectIndividualLinks('the T65As northbound', codes))
    .toBe('the T65As northbound');
  // SRKW / CRC codes aren't in the catalog
  expect(injectIndividualLinks('J26 and CRC56 nearby', codes, matrilines))
    .toBe('J26 and CRC56 nearby');
  // Codes inside existing markdown links are untouched
  const linked = 'see [T65A5](https://example.com/t65a5) and [T65As](https://example.com/t65as) for details';
  expect(injectIndividualLinks(linked, codes, matrilines)).toBe(linked);
});

test('normalizes case and separators', () => {
  expect(injectIndividualLinks('t-65a5 with T 65A', codes))
    .toBe('[t-65a5](/individuals/0010197/T065A5) with [T 65A](/individuals/0010193/T065A)');
});

test('links ecotype names in prose to the ecotype page', () => {
  expect(injectIndividualLinks('Biggs T46Bs southbound', codes, matrilines, ecotypes))
    .toBe('[Biggs](/populations/0000002/Biggs) [T46Bs](/matrilines/0002149/T046Bs) southbound');
  // apostrophe variants and "transient(s)" all resolve to the same ecotype
  expect(injectIndividualLinks("Bigg's transients milling", codes, matrilines, ecotypes))
    .toBe("[Bigg's](/populations/0000002/Biggs) [transients](/populations/0000002/Biggs) milling");
  // curly apostrophe
  expect(injectIndividualLinks('Bigg’s northbound', codes, matrilines, ecotypes))
    .toBe('[Bigg’s](/populations/0000002/Biggs) northbound');
});

test('leaves ecotype names alone when the catalog has no ecotype for them', () => {
  // Same rule as codes: a term that resolves to nothing is plain text.
  expect(injectIndividualLinks('Biggs northbound', codes, matrilines)).toBe('Biggs northbound');
});

test('does not link ecotype names inside existing markdown links', () => {
  const linked = 'see [Biggs report](https://example.com/biggs) for details';
  expect(injectIndividualLinks(linked, codes, matrilines, ecotypes)).toBe(linked);
});

// The read-path build writes the same rows the Supabase query returns (decision 056),
// so links built from its file are the links built from the database.
test('rows from either source build the lookup the links are made from', () => {
  const byCode = setCatalogCodes({
    designations: [
      { code: 'T065A', individual: T065A },
      { code: 'T46A', individual: T122 },
      { code: 'X9', individual: null },
    ],
    groups: [
      { kind: 'matriline', designation: 'T065A', entity_id: 'SSA:0002163' },
      { kind: 'ecotype', designation: 'Biggs', entity_id: 'SSA:0000002' },
    ],
  });
  expect([...byCode.keys()]).toEqual(['t65a', 't46a']);
  expect(injectIndividualLinks('T65A and the T65As, with T046A, among transients; X9 too',
    byCode, matrilineCodes()!, ecotypeCodes()!)).toBe(
    '[T65A](/individuals/0010193/T065A) and the [T65As](/matrilines/0002163/T065As), with [T046A](/individuals/0010368/T122), among [transients](/populations/0000002/Biggs); X9 too');
});

test('a sighting\'s named animals become chips, each once, in the order its text names them', () => {
  // As the build extracts them from a real report: a code can repeat, and the
  // same animal can be written two ways.
  expect(namedAnimals(['T65A5', 'T65As', 'T065A5', 'T65A5'], codes, matrilines)).toEqual([
    { label: 'T65A5', href: '/individuals/0010197/T065A5', possibly: false },
    { label: 'T65As', href: '/matrilines/0002163/T065As', possibly: false },
  ]);
});

test('a chip links a superseded code to the individual that now carries it', () => {
  expect(namedAnimals(['T46A'], codes, matrilines)).toEqual([{ label: 'T46A', href: '/individuals/0010368/T122', possibly: false }]);
});

test('a code the catalogue does not know stays as a chip without a link', () => {
  // Still what the observer wrote; linking is a navigation aid, not an identification.
  expect(namedAnimals(['CRC338', 'T46Bs', 'T999s'], codes, matrilines)).toEqual([
    { label: 'CRC338', href: null, possibly: false },
    { label: 'T46Bs', href: '/matrilines/0002149/T046Bs', possibly: false },
    { label: 'T999s', href: null, possibly: false },
  ]);
});

test('a sighting that names no animal has no chips', () => {
  expect(namedAnimals(null, codes, matrilines)).toEqual([]);
  expect(namedAnimals([], codes, matrilines)).toEqual([]);
});

test("an Orcasound bout's tags become chips too: a tag only possibly heard says so, a population links by name, a pod by its label", () => {
  // Bout identifiers are the register's labels, not codes read from text (decision 054).
  const populations = new Map([
    ['biggs', { entity_id: 'SSA:0000002', designation: 'Biggs' }],
    ['southern resident', { entity_id: 'SSA:0000010', designation: 'Southern Resident' }],
  ]);
  const pods = new Map([['j pod', { entity_id: 'SSA:0000020', designation: 'J' }]]);
  expect(namedAnimals(['T65A5?', "Bigg's", 'Southern Resident', 'J pod', 'Q pod'], codes, matrilines, populations, pods)).toEqual([
    { label: 'T65A5', href: '/individuals/0010197/T065A5', possibly: true },
    { label: "Bigg's", href: '/populations/0000002/Biggs', possibly: false },
    { label: 'Southern Resident', href: '/populations/0000010/Southern-Resident', possibly: false },
    { label: 'J pod', href: '/pods/0000020/J-pod', possibly: false },
    // A pod the register doesn't have stays what was written.
    { label: 'Q pod', href: null, possibly: false },
  ]);
});

test('names for one animal are one chip, under the first name written; heard outranks possibly heard', () => {
  // T46A was renamed T122: the same individual, one page.
  expect(namedAnimals(['T46A', 'T122'], codes, matrilines)).toEqual([
    { label: 'T46A', href: '/individuals/0010368/T122', possibly: false },
  ]);
  // Two moderators, one sure and one hedging (decision 054).
  expect(namedAnimals(['T65A5?', 'T65A5'], codes, matrilines)).toEqual([
    { label: 'T65A5', href: '/individuals/0010197/T065A5', possibly: false },
  ]);
  expect(namedAnimals(['CRC338?', 'CRC338?'], codes, matrilines)).toEqual([
    { label: 'CRC338', href: null, possibly: true },
  ]);
});

test("a segment's reports pool into one set of chips, each saying how many reports name it (salish-fwyt.5)", () => {
  const pods = new Map([['j pod', { entity_id: 'SSA:0000020', designation: 'J' }]]);
  const reports = [['J pod'], null, [], ['T65A5?'], ['T65A5', 'T46A'], ['T122']];
  expect(pooledAnimals(reports, codes, matrilines, new Map(), pods)).toEqual([
    { label: 'J pod', href: '/pods/0000020/J-pod', possibly: false, support: 1 },
    // Possibly heard once, heard once: heard, by two reports.
    { label: 'T65A5', href: '/individuals/0010197/T065A5', possibly: false, support: 2 },
    // T46A and T122 are one animal, under the first name written.
    { label: 'T46A', href: '/individuals/0010368/T122', possibly: false, support: 2 },
  ]);
});

test('a chip only ever possibly heard stays possibly', () => {
  expect(pooledAnimals([['T65A5?'], ['T65A5?']], codes)).toEqual([
    { label: 'T65A5', href: '/individuals/0010197/T065A5', possibly: true, support: 2 },
  ]);
});
