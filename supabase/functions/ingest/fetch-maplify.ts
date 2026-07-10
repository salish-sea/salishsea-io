/**
 * Maplify fetch with retry — imperative shell (salishsea-io-89d.1 / decision 011).
 *
 * Effectful: builds the request, fetches, and retries transient failures using
 * the pure policy in scripts/ingest/retry.ts. Returns the parsed JSON body on a
 * 2xx, or throws after MAX_ATTEMPTS. A non-retryable status (e.g. 403) throws
 * immediately. The caller (index.ts) turns any throw into a `failed` ingest.runs
 * row and writes nothing — upholding decision 011's "abort on a failed fetch".
 */

import {
    MAX_ATTEMPTS,
    retryDelayMs,
    parseRetryAfter,
    isRetryableStatus,
} from '../../../scripts/ingest/retry.ts';
import type { IngestWindow } from '../../../scripts/ingest/persist.ts';

// Salish Sea bounding box (CONTEXT.md: Acartia / SRKW range), lon/lat WGS84.
const BBOX = '-136,36,-120,54';
const MAPLIFY_URL = 'https://maplify.com/waseak/php/search-all-sightings.php';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Collapse a response body to a single-line snippet for error messages. */
function bodySnippet(text: string, max = 200): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine.length === 0) return '(empty body)';
    return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

// Deno's fetch has no built-in timeout; without one a hung Maplify connection
// would block an attempt (and the whole edge invocation) indefinitely. Bound
// each attempt so a hang becomes a retryable AbortError instead.
const FETCH_TIMEOUT_MS = 15_000;

export type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export async function fetchMaplify(window: IngestWindow, log: Logger): Promise<unknown> {
    const url = `${MAPLIFY_URL}?start=${window.start}&end=${window.end}&BBOX=${BBOX}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res: Response;
        try {
            res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
            if (res.ok) {
                // Read the body under the SAME timeout: a server can send headers
                // and then stall, and reading it would otherwise hang past the
                // deadline. Clear the timer only once the body is fully consumed.
                const text = await res.text();
                clearTimeout(timeout);
                try {
                    return JSON.parse(text) as unknown;
                } catch {
                    // Maplify serves a 200 with a NON-JSON body on its own
                    // server-side failures — a transient "Unable to connect to
                    // the database" DB error, or an HTML PHP fatal-error page.
                    // Throw a snippet of what it actually returned: this message
                    // is what index.ts hands the operator (and Sentry), so an
                    // opaque JSON-parse position would hide the real cause. Still
                    // retried (transient DB blips recover); a persistent failure
                    // surfaces the snippet after MAX_ATTEMPTS.
                    throw new Error(
                        `Maplify returned a non-JSON ${res.status} body ` +
                            `(${text.length} chars): ${bodySnippet(text)}`,
                    );
                }
            }
        } catch (e) {
            // fetch-level failure, abort (timeout), or a stalled/aborted body read
            clearTimeout(timeout);
            lastError = e;
            if (attempt === MAX_ATTEMPTS) break;
            const delay = retryDelayMs(attempt);
            log('maplify fetch error, retrying', { attempt, delayMs: delay, error: String(e) });
            await sleep(delay);
            continue;
        }

        // Non-2xx: res is defined and not ok.
        clearTimeout(timeout);
        lastError = new Error(`Maplify HTTP ${res.status}`);
        // drain the body so the connection can be reused/closed cleanly
        await res.body?.cancel();
        if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) break;
        const delay = retryDelayMs(attempt, parseRetryAfter(res.headers.get('retry-after')));
        log('maplify non-2xx, retrying', { attempt, status: res.status, delayMs: delay });
        await sleep(delay);
    }

    throw lastError ?? new Error('maplify fetch failed');
}
