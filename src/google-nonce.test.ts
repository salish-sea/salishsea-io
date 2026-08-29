import { describe, expect, it } from 'vitest';
import { generateNonce, sha256Hex } from './google-nonce.ts';

describe('sha256Hex', () => {
  it('matches the digest GoTrue computes over the raw nonce', async () => {
    // Reference vector: SHA-256("abc"), the form GoTrue compares to id_token.nonce.
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('generateNonce', () => {
  it('hashes the raw value, so the two halves are not interchangeable', async () => {
    const nonce = await generateNonce();
    expect(nonce.hashed).toBe(await sha256Hex(nonce.raw));
    expect(nonce.hashed).not.toBe(nonce.raw);
    expect(nonce.hashed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is fresh per call, so one attempt cannot replay another', async () => {
    const [a, b] = await Promise.all([generateNonce(), generateNonce()]);
    expect(a.raw).not.toBe(b.raw);
  });
});
