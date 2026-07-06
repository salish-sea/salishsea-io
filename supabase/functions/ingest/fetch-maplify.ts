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

// Deno's fetch has no built-in timeout; without one a hung Maplify connection
// would block an attempt (and the whole edge invocation) indefinitely. Bound
// each attempt so a hang becomes a retryable AbortError instead.
const FETCH_TIMEOUT_MS = 15_000;

export type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export async function fetchMaplify(window: IngestWindow, log: Logger): Promise<unknown> {
    const url = `${MAPLIFY_URL}?start=${window.start}&end=${window.end}&BBOX=${BBOX}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let res: Response;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
        } catch (e) {
            // network-level failure or timeout abort — retry with backoff
            lastError = e;
            if (attempt === MAX_ATTEMPTS) break;
            const delay = retryDelayMs(attempt);
            log('maplify fetch error, retrying', { attempt, delayMs: delay, error: String(e) });
            await sleep(delay);
            continue;
        } finally {
            clearTimeout(timeout);
        }

        if (res.ok) return await res.json();

        lastError = new Error(`Maplify HTTP ${res.status}`);
        if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) {
            // drain the body so the connection can be reused/closed cleanly
            await res.body?.cancel();
            break;
        }
        await res.body?.cancel();
        const delay = retryDelayMs(attempt, parseRetryAfter(res.headers.get('retry-after')));
        log('maplify non-2xx, retrying', { attempt, status: res.status, delayMs: delay });
        await sleep(delay);
    }

    throw lastError ?? new Error('maplify fetch failed');
}
