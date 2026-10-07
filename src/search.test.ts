import { describe, expect, test } from 'vitest';

import { fold } from './fold.ts';
import { search, type SearchEntry } from './search.ts';

const entry = (kind: SearchEntry['kind'], label: string, ...names: string[]): SearchEntry =>
  ({ kind, label, note: '', keys: [label, ...names].map(fold), href: `/${label}` });

const ENTRIES = [
  entry('individual', 'T065A', 'T65A', 'Fingers'),
  entry('individual', 'T065A2'),
  entry('individual', 'J31'),
  entry('individual', 'J35', 'Tahlequah'),
  entry('matriline', 'T065As'),
  entry('matriline', 'J31s'),
  entry('population', 'Southern Resident killer whales', 'Southern Resident', 'SRKW'),
  entry('haulout', 'Protection Island'),
  entry('region', 'San Juans'),
];

const labels = (query: string, limit?: number) => search(ENTRIES, query, limit).map(e => e.label);

describe('search (GH #640)', () => {
  test('a designation finds its animal however it is padded, the animal before its matriline', () => {
    expect(labels('T65A')).toEqual(['T065A', 'T065A2', 'T065As']);
    expect(labels('t065a')).toEqual(['T065A', 'T065A2', 'T065As']);
  });

  test('a whole match first, then a name it begins, then a word it begins, then one it is inside', () => {
    expect(labels('j31')).toEqual(['J31', 'J31s']);
    expect(labels('resident')).toEqual(['Southern Resident killer whales']);
    expect(labels('ection')).toEqual(['Protection Island']);
    expect(labels('island')).toEqual(['Protection Island']);
  });

  test('a nickname or the register\'s search name finds the animal or group', () => {
    expect(labels('fingers')).toEqual(['T065A']);
    expect(labels('Tahlequah')).toEqual(['J35']);
    expect(labels('SRKW')).toEqual(['Southern Resident killer whales']);
  });

  test('places too, and nothing for a blank query; the limit holds', () => {
    expect(labels('san juans')).toEqual(['San Juans']);
    expect(labels('   ')).toEqual([]);
    expect(labels('t', 2)).toHaveLength(2);
  });
});
