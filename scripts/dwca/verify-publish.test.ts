/**
 * Unit tests for scripts/dwca/verify-publish.ts — V-01 post-publish smoke verifier.
 *
 * Tests:
 *   1. parseSha256Sidecar accepts GNU coreutils format.
 *   2. parseSha256Sidecar tolerates trailing whitespace / CRLF.
 *   3. verify succeeds when sha matches.
 *   4. verify throws on sha mismatch.
 *   5. verify throws on HTTP non-2xx.
 *   6. verify uses DWCA_BASE_URL when set.
 *
 * No network calls — fetch is mocked via vi.stubGlobal.
 *
 * Cross-reference:
 *   - 07-01-PLAN.md Task 2 for the full behavior spec.
 *   - 07-CONTEXT.md V-01 for the locked verify decision.
 *   - 07-RESEARCH.md §"Pattern 2: GNU coreutils sha256 sidecar format".
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Module import — no mocks needed (pure functions + injectable fetch)
// ---------------------------------------------------------------------------

import { parseSha256Sidecar, verify } from './verify-publish.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the real sha256 hex of a byte array (used to build the "correct"
 * sidecar for Test 3 without hardcoding fragile hex literals).
 */
function sha256hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Create a mock fetch that returns an artifact ArrayBuffer and a sidecar text.
 * If `artifactStatus` is not 200, the artifact response has ok=false.
 */
function makeFetchMock(options: {
    artifactBytes: Uint8Array;
    sidecarText: string;
    artifactStatus?: number;
    sidecarStatus?: number;
}) {
    const { artifactBytes, sidecarText, artifactStatus = 200, sidecarStatus = 200 } = options;

    return vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.endsWith('.sha256')) {
            return {
                ok: sidecarStatus >= 200 && sidecarStatus < 300,
                status: sidecarStatus,
                text: async () => sidecarText,
            };
        }
        // Artifact response.
        return {
            ok: artifactStatus >= 200 && artifactStatus < 300,
            status: artifactStatus,
            arrayBuffer: async () => artifactBytes.buffer.slice(
                artifactBytes.byteOffset,
                artifactBytes.byteOffset + artifactBytes.byteLength,
            ),
        };
    });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('verify-publish', () => {
    let origFetch: typeof globalThis.fetch | undefined;
    let origBaseUrl: string | undefined;

    beforeEach(() => {
        origFetch = globalThis.fetch;
        origBaseUrl = process.env['DWCA_BASE_URL'];
        // Reset to default base URL for each test.
        delete process.env['DWCA_BASE_URL'];
    });

    afterEach(() => {
        if (origFetch !== undefined) globalThis.fetch = origFetch;
        else delete (globalThis as unknown as Record<string, unknown>)['fetch'];
        if (origBaseUrl !== undefined) process.env['DWCA_BASE_URL'] = origBaseUrl;
        else delete process.env['DWCA_BASE_URL'];
        vi.restoreAllMocks();
    });

    // -----------------------------------------------------------------------
    // Test 1: parseSha256Sidecar accepts GNU coreutils format
    // -----------------------------------------------------------------------

    test('parseSha256Sidecar accepts GNU coreutils format', () => {
        const hex = 'a'.repeat(64);
        const input = `${hex}  salishsea-occurrences-v1.zip\n`;
        expect(parseSha256Sidecar(input)).toBe(hex);
    });

    // -----------------------------------------------------------------------
    // Test 2: parseSha256Sidecar tolerates trailing whitespace / CRLF
    // -----------------------------------------------------------------------

    test('parseSha256Sidecar tolerates trailing whitespace and CRLF', () => {
        const hex = 'b'.repeat(64);
        // CRLF line ending + extra trailing space.
        const input = `${hex}  salishsea-occurrences-v1.zip\r\n   `;
        expect(parseSha256Sidecar(input)).toBe(hex);
    });

    // -----------------------------------------------------------------------
    // Test 3: verify succeeds when sha matches
    // -----------------------------------------------------------------------

    test('verify succeeds when sha matches', async () => {
        const bytes = new Uint8Array([0x01, 0x02, 0x03]);
        const hex = sha256hex(bytes);
        const sidecarText = `${hex}  salishsea-occurrences-v1.zip\n`;

        const mockFetch = makeFetchMock({ artifactBytes: bytes, sidecarText });
        vi.stubGlobal('fetch', mockFetch);

        // Should resolve without throwing.
        await expect(verify('salishsea-occurrences-v1.zip')).resolves.toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Test 4: verify throws on sha mismatch
    // -----------------------------------------------------------------------

    test('verify throws on sha mismatch', async () => {
        const bytes = new Uint8Array([0x01, 0x02, 0x03]);
        const wrongHex = '0'.repeat(64);
        const sidecarText = `${wrongHex}  salishsea-occurrences-v1.zip\n`;

        const mockFetch = makeFetchMock({ artifactBytes: bytes, sidecarText });
        vi.stubGlobal('fetch', mockFetch);

        await expect(verify('salishsea-occurrences-v1.zip')).rejects.toThrow(
            'salishsea-occurrences-v1.zip: sha mismatch',
        );
    });

    // -----------------------------------------------------------------------
    // Test 5: verify throws on HTTP non-2xx
    // -----------------------------------------------------------------------

    test('verify throws on HTTP non-2xx', async () => {
        const bytes = new Uint8Array([0x01, 0x02, 0x03]);
        const sidecarText = `${'a'.repeat(64)}  salishsea-occurrences-v1.zip\n`;

        const mockFetch = makeFetchMock({
            artifactBytes: bytes,
            sidecarText,
            artifactStatus: 404,
        });
        vi.stubGlobal('fetch', mockFetch);

        await expect(verify('salishsea-occurrences-v1.zip')).rejects.toThrow('HTTP 404');
    });

    // -----------------------------------------------------------------------
    // Test 6: verify uses DWCA_BASE_URL when set
    // -----------------------------------------------------------------------

    test('verify uses DWCA_BASE_URL when set', async () => {
        const stagingBase = 'https://staging.salishsea.io/dwca';
        process.env['DWCA_BASE_URL'] = stagingBase;

        const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        const hex = sha256hex(bytes);
        const sidecarText = `${hex}  salishsea-occurrences-v1.zip\n`;

        const mockFetch = makeFetchMock({ artifactBytes: bytes, sidecarText });
        vi.stubGlobal('fetch', mockFetch);

        await verify('salishsea-occurrences-v1.zip');

        // Assert fetch was called with the staging URL prefix.
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining(stagingBase),
        );
    });
});
