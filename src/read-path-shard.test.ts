import { describe, expect, test } from 'vitest';

import { fnv1a32, ID_SHARDS, idShard } from './read-path-shard.ts';

describe('fnv1a32', () => {
  // The published FNV-1a 32-bit test vectors (the reference implementation's).
  test.each([
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['foobar', 0xbf9cf968],
  ])('%j hashes to the reference value', (text, expected) => {
    expect(fnv1a32(text)).toBe(expected);
  });
});

describe('idShard', () => {
  test('is two hex digits', () => {
    expect(idShard('maplify:12345')).toMatch(/^[0-9a-f]{2}$/);
  });

  test('spreads sequential ids across the shards', () => {
    const shards = new Set(Array.from({length: 5000}, (_, i) => idShard(`maplify:${i}`)));
    expect(shards.size).toBe(ID_SHARDS);
  });
});
