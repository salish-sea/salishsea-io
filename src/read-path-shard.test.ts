import { describe, expect, test } from 'vitest';

import { fnv1a32, ID_SHARDS, idShard, isLegacyMaplifyId, legacyMaplifyAliases } from './read-path-shard.ts';

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

describe('isLegacyMaplifyId', () => {
  test.each([['maplify:228809', true], ['maplify:whale_alert:228809', false], ['maplify:', false],
    ['maplify:12a', false], ['inaturalist:228809', false], ['228809', false]])('%j is %s', (id, expected) => {
    expect(isLegacyMaplifyId(id)).toBe(expected);
  });
});

describe('legacyMaplifyAliases', () => {
  test('names the one occurrence a number belongs to, and leaves out a number two sources use', () => {
    const aliases = legacyMaplifyAliases([
      'maplify:whale_alert:228809', 'maplify:wras:228809', 'maplify:wras:228810',
      'inaturalist:228811', '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', 'maplify:FARPB:7']);
    expect([...aliases]).toEqual([['maplify:228810', 'maplify:wras:228810'], ['maplify:7', 'maplify:FARPB:7']]);
  });

  test('a number three sources use has none either', () => {
    expect(legacyMaplifyAliases(['maplify:a:1', 'maplify:b:1', 'maplify:c:1']).size).toBe(0);
  });
});
