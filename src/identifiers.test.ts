import { expect, test } from 'vitest';
import { detectIndividuals, detectPod } from './identifiers.ts';
import { fold } from './fold.ts';

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

test('finds pod identifiers', () => {
  const table: [string, string | null][] = [
    ['[Orca Network] Likely T65A5 slowly northbound (Gary Furuheim, Cynthia Macfarlan) Submitted by a Cascadia Trusted Observer Via Webmap', 'T'],
  ];
  for (const [input, expected] of table) {
    const actual = detectPod(input);
    expect(actual).toBe(expected);
  }
});

// Leading zeros go only while a digit follows, so a designation never loses its number. A
// contributor's own sighting is shown with these until a build publishes it, and the build's
// extract_identifiers (scripts/read-path/derive/extract.sql) spells some of them differently
// (third column): it keeps a zero to leave two characters, and the digits' case as written.
// Both name the same animal under the register's fold, which is how a name is compared.
test('keeps the zeros a designation needs', () => {
  const table: [string, string[], string[]][] = [
    ['T065A', ['T65A'], ['T65A']],
    ['T001', ['T1'], ['T01']],
    ['J00', ['J0'], ['J00']],
    ['T0As', ['T0As'], ['T0As']],
    ['CRC 00b', ['CRC0B'], ['CRC0b']],
  ];
  for (const [input, expected, build] of table) {
    expect(detectIndividuals(input), input).toEqual(expected);
    expect(expected.map(fold), input).toEqual(build.map(fold));
  }
});
