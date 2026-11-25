import { expect, test } from 'vitest';
import { detectAbsent, detectIndividuals } from './identifiers.ts';

test('finds individual identifiers', () => {
  const table: [string, string[]][] = [
    ['[Orca Network] CRC 56 and CRC 356 are also here with CRC 2356 feeding (Bart Rulon)', ['CRC56', 'CRC356', 'CRC2356']],
    ['[Orca Network] Likely T65A5 slowly northbound (Gary Furuheim, Cynthia Macfarlan) Submitted by a Cascadia Trusted Observer Via Webmap', ['T65A5']],
  ];
  for (const [input, expected] of table){
    const actual = detectIndividuals(input);
    for (const id of expected) {
      expect(actual).toContain(id);
    }
    expect(actual.length).toBe(expected.length);
  }
});

test('names pods and populations among them, in the order the text gives them (decision 121)', () => {
  expect(detectIndividuals('J and K pods NB, J27 with them')).toEqual(['J pod', 'K pod', 'J27']);
  expect(detectIndividuals('T137A, then Biggs T65A')).toEqual(['T137A', "Bigg's", 'T65A']);
  expect(detectIndividuals('Faint SRKW calls, likely J pod')).toEqual(['Southern Resident', 'J pod']);
  expect(detectIndividuals('Js? southbound')).toEqual(['J pod?']);
  expect(detectIndividuals('[Orca Network] Likely T65A5 slowly northbound (Gary Furuheim, Cynthia Macfarlan) Submitted by a Cascadia Trusted Observer Via Webmap')).toEqual(['T65A5']);
});

// Leading zeros go only while a digit follows, so a designation never loses its number. A
// contributor's own sighting is shown with these until a build publishes it, and the build
// reads its text with the same reader (decision 105), so the two spell every code alike.
test('keeps the zeros a designation needs', () => {
  const table: [string, string[]][] = [
    ['T065A', ['T65A']],
    ['T001', ['T1']],
    ['J00', ['J0']],
    ['T0As', ['T0As']],
    ['CRC 00b', ['CRC0B']],
  ];
  for (const [input, expected] of table) {
    expect(detectIndividuals(input), input).toEqual(expected);
  }
});

test('an animal the text says was absent is not among them, and names no pod', () => {
  expect(detectIndividuals('Biggs T46s (-D) northbound')).toEqual(["Bigg's", 'T46s']);
  expect(detectIndividuals('minus K37, and some humpbacks')).toEqual([]);
});

test('it is among the absent instead, as the build writes them (decision 109)', () => {
  expect(detectAbsent('Biggs T46s (-D) northbound')).toEqual(['T46D']);
  expect(detectAbsent('T65A northbound')).toEqual([]);
});

test('a code only possibly there ends in ?, and a probable one is plain (decision 109)', () => {
  expect(detectIndividuals('T46s, possibly T65A')).toEqual(['T46s', 'T65A?']);
  expect(detectIndividuals('T46s, likely T65A')).toEqual(['T46s', 'T65A']);
  // in the order the text gives them, as the build writes them, not sorted
  expect(detectIndividuals('T65A, T46s')).toEqual(['T65A', 'T46s']);
});
