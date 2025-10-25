import { expect, test } from 'vitest';
import { isExtent, pugetSoundExtent, salishSeaExtent, salishSRKWExtent, sanJuansExtent, srkwExtent } from './constants.ts';

test('validates a reasonable extent', () => {
  for (const extent of [pugetSoundExtent, srkwExtent, salishSeaExtent, salishSRKWExtent, sanJuansExtent]) {
    expect(isExtent(extent)).toBe(true);
  }
});
