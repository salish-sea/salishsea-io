/**
 * GBIF Validator REST client — Phase 13 Plan 02.
 *
 * Submits a built DwC-A zip to the GBIF Validator REST API and asserts
 * SC#1: `indexeable === true` with zero blocking `RESOURCE_INTEGRITY` or
 * `RESOURCE_STRUCTURE` category issues.
 *
 * API reference:
 *   POST https://api.gbif.org/v1/validation   — multipart file upload, Basic auth
 *   GET  https://api.gbif.org/v1/validation/{key} — poll until not RUNNING/QUEUED
 *
 * Decision D-01 (13-CONTEXT.md): Automate submission + poll. If the API is
 * unavailable after retries, print the manual fallback URL and exit non-zero.
 *
 * Security (T-13-02-CRED): Credentials are read from GBIF_USER / GBIF_PASS env
 * vars at call time. The Authorization header and password are NEVER logged.
 *
 * CLI invocation:
 *   GBIF_USER=your-user GBIF_PASS=your-pass \
 *   npx tsx scripts/dwca/validate-gbif.ts
 *
 * Cross-reference:
 *   - 13-02-PLAN.md §<behavior> for the full spec
 *   - 13-RESEARCH.md §"Pattern 1: GBIF Validator REST API"
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** GBIF Validator REST API base endpoint. HTTPS only (T-13-02-TLS). */
const GBIF_VALIDATOR_URL = 'https://api.gbif.org/v1/validation';

/** Default path to the locally-built DwC-A zip. */
const DEFAULT_ZIP_PATH = 'dist/dwca/salishsea-occurrences-v1.zip';

/** Categories whose issues are blocking (prevent GBIF indexing). */
const BLOCKING_CATEGORIES = new Set(['RESOURCE_INTEGRITY', 'RESOURCE_STRUCTURE']);

/** Poll interval in milliseconds. */
const POLL_INTERVAL_MS = 7_000;

/** Maximum time to wait for validation to complete, in milliseconds (~5 min). */
const POLL_TIMEOUT_MS = 300_000;

/** States that indicate validation is still in progress. */
const IN_PROGRESS_STATES = new Set(['RUNNING', 'QUEUED']);

/** Manual fallback URL when the API is unavailable. */
const MANUAL_FALLBACK_URL = 'https://www.gbif.org/tools/data-validator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An individual issue in a validation result file-section. */
export interface GbifIssue {
    issue: string;
    issueCategory: string;
    count?: number;
}

/** One file section in the validation result. */
export interface GbifValidationResultSection {
    fileType: string;
    rowType?: string;
    numberOfLines?: number;
    issues: GbifIssue[];
}

/**
 * The top-level validation result object returned by
 * GET https://api.gbif.org/v1/validation/{key}.
 */
export interface GbifValidationResult {
    /** UUID key for this validation run. May be absent on submit response. */
    key?: string;
    /** Primary SC#1 gate: true iff GBIF can index this archive. */
    indexeable: boolean;
    fileName?: string;
    fileFormat?: string;
    validationProfile?: string;
    /** Validation state (present during polling): RUNNING | QUEUED | FINISHED | etc. */
    state?: string;
    results: GbifValidationResultSection[];
}

/** Credentials for GBIF Basic auth. */
export interface GbifCredentials {
    user: string;
    pass: string;
}

/** Return type from assertIndexeable when the archive passes. */
export interface AssertIndexeableResult {
    /** Non-blocking warning issues (METADATA_CONTENT, OCC_INTERPRETATION_BASED, etc.). */
    warnings: GbifIssue[];
}

// ---------------------------------------------------------------------------
// Pure gate function
// ---------------------------------------------------------------------------

/**
 * Assert SC#1 on a parsed GBIF validation result.
 *
 * Throws if:
 *  - result.indexeable !== true  (message: "GBIF validator: not indexeable")
 *  - Any issue has issueCategory in {RESOURCE_INTEGRITY, RESOURCE_STRUCTURE}
 *
 * Returns an object with `warnings` — all non-blocking issues — so main()
 * can report them without failing.
 *
 * T-13-02-VAL: validates `indexeable` with strict boolean equality (not truthy).
 * Unknown issue categories are treated as non-blocking warnings (don't crash).
 *
 * @param result - Parsed result JSON from the GBIF validator API.
 * @returns {{ warnings: GbifIssue[] }} Non-blocking warnings.
 * @throws {Error} If not indexeable or blocking issues found.
 */
export function assertIndexeable(result: GbifValidationResult): AssertIndexeableResult {
    // SC#1 primary gate: strict boolean equality (T-13-02-VAL)
    if (result.indexeable !== true) {
        throw new Error('GBIF validator: not indexeable');
    }

    const blockingIssues: GbifIssue[] = [];
    const warnings: GbifIssue[] = [];

    for (const section of result.results) {
        for (const issue of section.issues ?? []) {
            if (BLOCKING_CATEGORIES.has(issue.issueCategory)) {
                blockingIssues.push(issue);
            } else {
                warnings.push(issue);
            }
        }
    }

    if (blockingIssues.length > 0) {
        throw new Error(
            `GBIF validator: blocking issues found:\n${JSON.stringify(blockingIssues, null, 2)}`,
        );
    }

    return { warnings };
}

// ---------------------------------------------------------------------------
// Network functions (submit + poll)
// ---------------------------------------------------------------------------

/**
 * Build an HTTP Basic Authorization header value from credentials.
 * T-13-02-CRED: Never log this value.
 */
function buildAuthHeader(creds: GbifCredentials): string {
    const encoded = Buffer.from(`${creds.user}:${creds.pass}`).toString('base64');
    return `Basic ${encoded}`;
}

/**
 * Submit a DwC-A zip to the GBIF validator REST API.
 *
 * POST https://api.gbif.org/v1/validation (multipart/form-data, `file` field,
 * type=application/zip). HTTP Basic Auth from `creds`.
 *
 * @param zipPath - Path to the zip file on disk.
 * @param creds - GBIF credentials ({ user, pass }).
 * @returns The validation key (UUID string) from the response JSON.
 * @throws {Error} On HTTP non-2xx or missing key in response.
 */
export async function submitValidation(
    zipPath: string,
    creds: GbifCredentials,
): Promise<string> {
    const zipBytes = await readFile(zipPath);

    const formData = new FormData();
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    formData.append('file', blob, 'salishsea-occurrences-v1.zip');

    const res = await fetch(GBIF_VALIDATOR_URL, {
        method: 'POST',
        headers: {
            Authorization: buildAuthHeader(creds),
            // Do NOT set Content-Type — let fetch set the boundary for multipart
        },
        body: formData,
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
            `GBIF validator submit failed: HTTP ${res.status}\n` +
            `Fallback: ${MANUAL_FALLBACK_URL}\n` +
            (body ? `Response: ${body.slice(0, 500)}` : ''),
        );
    }

    const json = (await res.json()) as { key?: string };
    if (!json.key) {
        throw new Error(
            `GBIF validator submit: no key in response JSON\n` +
            `Fallback: ${MANUAL_FALLBACK_URL}`,
        );
    }

    return json.key;
}

/**
 * Poll the GBIF validator API until the validation run is no longer
 * RUNNING or QUEUED, then return the final result.
 *
 * GET https://api.gbif.org/v1/validation/{key} with HTTP Basic Auth.
 * Polls every POLL_INTERVAL_MS ms; throws after POLL_TIMEOUT_MS ms.
 *
 * @param key - The validation key UUID returned by submitValidation.
 * @param creds - GBIF credentials ({ user, pass }).
 * @returns The final GbifValidationResult once validation is complete.
 * @throws {Error} On HTTP non-2xx, timeout, or unparseable response.
 */
export async function pollValidation(
    key: string,
    creds: GbifCredentials,
): Promise<GbifValidationResult> {
    const startMs = Date.now();
    const pollUrl = `${GBIF_VALIDATOR_URL}/${key}`;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const elapsed = Date.now() - startMs;
        if (elapsed > POLL_TIMEOUT_MS) {
            throw new Error(
                `GBIF validator: polling timed out after ${Math.round(elapsed / 1000)}s\n` +
                `Fallback: ${MANUAL_FALLBACK_URL}`,
            );
        }

        const res = await fetch(pollUrl, {
            headers: { Authorization: buildAuthHeader(creds) },
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(
                `GBIF validator poll failed: HTTP ${res.status}\n` +
                `Fallback: ${MANUAL_FALLBACK_URL}\n` +
                (body ? `Response: ${body.slice(0, 500)}` : ''),
            );
        }

        const result = (await res.json()) as GbifValidationResult;

        if (result.state && IN_PROGRESS_STATES.has(result.state)) {
            // Still running — wait and poll again
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            continue;
        }

        // Validation is complete (state is FINISHED, absent, or anything other than RUNNING/QUEUED)
        return result;
    }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * CLI main: read GBIF_USER/GBIF_PASS from env, submit the built zip,
 * poll for results, call assertIndexeable, print PASS/FAIL.
 *
 * Exits non-zero on failure or missing credentials.
 * T-13-02-CRED: GBIF_PASS and the Authorization header are never printed.
 */
export async function main(): Promise<void> {
    const user = process.env['GBIF_USER'];
    const pass = process.env['GBIF_PASS'];

    if (!user || !pass) {
        console.error(
            'Error: GBIF_USER and GBIF_PASS environment variables must be set.\n' +
            'Register a free GBIF account at: https://www.gbif.org/user/profile\n' +
            `Manual fallback: ${MANUAL_FALLBACK_URL}`,
        );
        process.exit(1);
    }

    const creds: GbifCredentials = { user, pass };
    const zipPath = DEFAULT_ZIP_PATH;

    if (!existsSync(zipPath)) {
        console.error(
            `Error: DwC-A zip not found at ${zipPath}\n` +
            'Run `npm run build:dwca` first to build the archive.',
        );
        process.exit(1);
    }

    console.log(`Submitting ${zipPath} to GBIF validator...`);
    // T-13-02-CRED: do NOT log creds.user here (could be an email address)
    // or any Authorization header value.

    let key: string;
    try {
        key = await submitValidation(zipPath, creds);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    console.log(`Validation submitted (key: ${key}). Polling for results...`);

    let result: GbifValidationResult;
    try {
        result = await pollValidation(key, creds);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    console.log(`Validation complete. indexeable=${result.indexeable}`);

    try {
        const { warnings } = assertIndexeable(result);

        console.log('PASS: Archive passes SC#1 (indexeable, no blocking issues).');

        if (warnings.length > 0) {
            console.log(`Non-blocking warnings (${warnings.length}):`);
            for (const w of warnings) {
                const countStr = w.count !== undefined ? ` (count: ${w.count})` : '';
                console.log(`  [${w.issueCategory}] ${w.issue}${countStr}`);
            }
        } else {
            console.log('No warnings.');
        }
    } catch (err) {
        console.error('FAIL:', err instanceof Error ? err.message : String(err));
        console.error(`\nManual fallback: ${MANUAL_FALLBACK_URL}`);
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// CLI guard — only runs when invoked as a script, not when imported.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
