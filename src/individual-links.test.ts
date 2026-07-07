import { expect, test } from 'vitest';
import { injectIndividualLinks } from './individual-links.ts';

const codes = new Map([
  ['T065A5', 'T065A5'],
  ['T065A', 'T065A'],
  ['T122', 'T122'],   // renamed from T46A; both codes resolve to T122
  ['T046A', 'T122'],
]);

test('links resolvable codes to individual pages', () => {
  expect(injectIndividualLinks('Likely T65A5 slowly northbound', codes))
    .toBe('Likely [T65A5](/individuals/T065A5) slowly northbound');
});

test('links superseded codes to the current designation', () => {
  expect(injectIndividualLinks('T46A heading south', codes))
    .toBe('[T46A](/individuals/T122) heading south');
});

test('leaves matriline, unresolvable, and already-linked codes alone', () => {
  // Matriline codes name a group, not an individual — no page for them yet
  expect(injectIndividualLinks('the T65As northbound', codes))
    .toBe('the T65As northbound');
  // SRKW / CRC codes aren't in the catalog
  expect(injectIndividualLinks('J26 and CRC56 nearby', codes))
    .toBe('J26 and CRC56 nearby');
  // Codes inside existing markdown links are untouched
  const linked = 'see [T65A5](https://example.com/t65a5) for details';
  expect(injectIndividualLinks(linked, codes)).toBe(linked);
});

test('normalizes case and separators', () => {
  expect(injectIndividualLinks('t-65a5 with T 65A', codes))
    .toBe('[t-65a5](/individuals/T065A5) with [T 65A](/individuals/T065A)');
});
