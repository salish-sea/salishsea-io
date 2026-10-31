import { expect, test } from 'vitest';
import { detectIndividuals, detectPod } from './identifiers.ts';

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

// Leading zeros go only while a digit follows, so a designation never loses its number:
// the build's extract_identifiers (scripts/read-path/derive/extract.sql) keeps them too, and
// a contributor's own sighting is shown with these until a build publishes it.
test('keeps the zeros a designation needs', () => {
  const table: [string, string[]][] = [
    ['T065A', ['T65A']],
    ['T001', ['T1']],
    ['J00', ['J0']],
    ['T0As', ['T0As']],
    ['CRC 00b', ['CRC0B']],
  ];
  for (const [input, expected] of table)
    expect(detectIndividuals(input), input).toEqual(expected);
});
