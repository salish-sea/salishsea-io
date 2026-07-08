import { expect, test } from 'vitest';
import { injectIndividualLinks } from './individual-links.ts';

const codes = new Map([
  ['T065A5', 'T065A5'],
  ['T065A', 'T065A'],
  ['T122', 'T122'],   // renamed from T46A; both codes resolve to T122
  ['T046A', 'T122'],
]);

const matrilines = new Map([
  ['T065A', 'T065A'],
  ['T046B', 'T046B'],
]);

test('links resolvable codes to individual pages', () => {
  expect(injectIndividualLinks('Likely T65A5 slowly northbound', codes))
    .toBe('Likely [T65A5](/individuals/T065A5) slowly northbound');
});

test('links superseded codes to the current designation', () => {
  expect(injectIndividualLinks('T46A heading south', codes))
    .toBe('[T46A](/individuals/T122) heading south');
});

test('links matriline codes to matriline pages', () => {
  expect(injectIndividualLinks('the T65As northbound', codes, matrilines))
    .toBe('the [T65As](/matrilines/T065A) northbound');
  // Case and separators normalize the same way as individual codes
  expect(injectIndividualLinks('t-46bs milling', codes, matrilines))
    .toBe('[t-46bs](/matrilines/T046B) milling');
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
    .toBe('[t-65a5](/individuals/T065A5) with [T 65A](/individuals/T065A)');
});

test('links ecotype names in prose to the ecotype page', () => {
  expect(injectIndividualLinks('Biggs T46Bs southbound', codes, matrilines))
    .toBe('[Biggs](/ecotypes/Biggs) [T46Bs](/matrilines/T046B) southbound');
  // apostrophe variants and "transient(s)" all resolve to the same ecotype
  expect(injectIndividualLinks("Bigg's transients milling", codes))
    .toBe("[Bigg's](/ecotypes/Biggs) [transients](/ecotypes/Biggs) milling");
  // curly apostrophe
  expect(injectIndividualLinks('Bigg’s northbound', codes))
    .toBe('[Bigg’s](/ecotypes/Biggs) northbound');
});

test('does not link ecotype names inside existing markdown links', () => {
  const linked = 'see [Biggs report](https://example.com/biggs) for details';
  expect(injectIndividualLinks(linked, codes)).toBe(linked);
});
