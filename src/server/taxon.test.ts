import {detectIndividuals, detectPod} from './taxon.ts';
import { expect, test } from 'vitest';

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
