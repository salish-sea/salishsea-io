import { expect, test } from 'vitest';
import { isExtent, salishSeaExtent, salishSRKWExtent, sanJuansExtent, srkwExtent } from './constants.ts';

test('validates a resonable extent', () => {
  for (const extent of [srkwExtent, salishSeaExtent, salishSRKWExtent, sanJuansExtent]) {
    expect(isExtent(extent));
  }
});
