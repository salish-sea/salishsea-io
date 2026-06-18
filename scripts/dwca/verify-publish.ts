/**
 * V-01 post-publish smoke verifier — Phase 07 Plan 01.
 *
 * After a nightly publish + CloudFront invalidation completes, this module:
 *   1. Fetches both published artifacts and their .sha256 sidecars from the
 *      public CloudFront URL (or DWCA_BASE_URL override for staging dry-runs).
 *   2. Computes sha256 of each downloaded artifact in-process.
 *   3. Compares against the parsed GNU coreutils sidecar hex.
 *   4. Throws an informative Error on any mismatch, HTTP error, or malformed sidecar.
 *
 * Implements: V-01 (smoke check), P-03 (stable filenames), EXPORT-04 + EXPORT-05.
 *
 * NEVER writes to disk. NEVER ATTACHes Postgres. Pure HTTP + sha256 only.
 *
 * CLI invocation:
 *   npx tsx scripts/dwca/verify-publish.ts
 *
 * Cross-reference:
 *   - 07-01-PLAN.md Task 2 for the full behavior spec.
 *   - 07-CONTEXT.md V-01 for the locked verify decision.
 *   - 07-RESEARCH.md §"Pattern 2: GNU coreutils sha256 sidecar format".
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Base URL for the published DwC-A artifacts. Env-overridable for staging
 * dry-runs or unit test injection (env var is read at call time, not at
 * module load, to allow per-test overrides).
 */
function getBaseUrl(): string {
    return process.env['DWCA_BASE_URL'] ?? 'https://salishsea.io/dwca';
}

/** P-03 stable artifact filenames (no date stamping). */
const NAMES = [
    'salishsea-occurrences-v1.zip',
    'salishsea-occurrences-v1.parquet',
] as const;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Parse a GNU coreutils sha256sum sidecar line into the 64-char hex string.
 *
 * Sidecar format: `<64-hex><two-spaces><filename>\n`
 * (e.g. `3a7bd3e2360a...  salishsea-occurrences-v1.zip\n`)
 *
 * T-7-04b mitigation: validates the result is exactly 64 lowercase hex chars
 * before returning — prevents injection if the result is later interpolated.
 *
 * @param text - Raw sidecar file content (may include trailing whitespace / CRLF).
 * @returns The 64-char lowercase hex sha256 string.
 * @throws Error if the parsed token is not a 64-char lowercase hex string.
 */
export function parseSha256Sidecar(text: string): string {
    const hex = text.trim().split(/\s+/)[0] ?? '';
    if (!/^[0-9a-f]{64}$/.test(hex)) {
        throw new Error(
            `invalid sha256 sidecar: expected 64-char lowercase hex, got "${hex.slice(0, 80)}"`,
        );
    }
    return hex;
}

/**
 * Fetch a single published artifact + its .sha256 sidecar, then verify
 * the sha256 in-process.
 *
 * @param name - Artifact filename (e.g. `salishsea-occurrences-v1.zip`).
 * @throws Error on HTTP non-2xx, malformed sidecar, or sha mismatch.
 */
export async function verify(name: string): Promise<void> {
    const base = getBaseUrl();
    const artifactUrl = `${base}/${name}`;
    const sidecarUrl = `${base}/${name}.sha256`;

    const [artRes, shaRes] = await Promise.all([
        fetch(artifactUrl),
        fetch(sidecarUrl),
    ]);

    if (!artRes.ok) {
        throw new Error(`${name}: HTTP ${artRes.status}`);
    }
    if (!shaRes.ok) {
        throw new Error(`${name}.sha256: HTTP ${shaRes.status}`);
    }

    const [artBuf, shaText] = await Promise.all([
        artRes.arrayBuffer(),
        shaRes.text(),
    ]);

    const expected = parseSha256Sidecar(shaText);
    const actual = createHash('sha256')
        .update(new Uint8Array(artBuf))
        .digest('hex');

    if (expected !== actual) {
        throw new Error(
            `${name}: sha mismatch expected=${expected} actual=${actual}`,
        );
    }

    console.log(`${name}: ok (${actual})`);
}

/**
 * Verify all stable DwC-A artifact names concurrently.
 * Called by the nightly workflow's smoke step via `npx tsx`.
 */
export async function main(): Promise<void> {
    await Promise.all(NAMES.map(verify));
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when invoked as a script, not when imported.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
