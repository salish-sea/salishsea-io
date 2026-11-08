/**
 * GET a URL as JSON with the ingest's retry policy — the imperative shell over the pure
 * policy in retry.ts (decision 011). The Maplify, iNaturalist and Orcasound fetchers all
 * use it.
 *
 * Returns the parsed body on a 2xx. A retryable status (429, 5xx), a timeout, a refused
 * connection or a 2xx whose body isn't JSON is retried, up to MAX_ATTEMPTS, and thrown
 * marked transient (decision 042) if it persists; any other status is thrown at once,
 * unmarked. Every caller writes nothing on a throw: decision 011's "abort on a failed
 * fetch".
 */

import {
    MAX_ATTEMPTS,
    retryDelayMs,
    parseRetryAfter,
    isRetryableStatus,
    markTransientUpstream,
} from './retry.ts';

/** How an ingest reports progress: a message and structured detail. */
export type Logger = (msg: string, extra?: Record<string, unknown>) => void;

export type FetchJsonOptions = {
    /** The upstream, as errors and log lines name it: "Maplify", "iNaturalist taxa". */
    readonly name: string;
    readonly accept?: string;
    /** Each attempt's bound, body included. */
    readonly timeoutMs?: number;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Collapse a response body to a single-line snippet for error messages. */
function bodySnippet(text: string, max = 200): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine.length === 0) return '(empty body)';
    return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export async function fetchJsonWithRetry(
    url: string,
    { name, accept = 'application/json', timeoutMs = 15_000 }: FetchJsonOptions,
    log: Logger,
): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // fetch has no timeout of its own: without one, a hung connection would hold up
        // the build's task indefinitely. Bound each attempt so a hang becomes a retryable
        // AbortError instead.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
            res = await fetch(url, { headers: { accept }, signal: controller.signal });
            if (res.ok) {
                // Read the body under the SAME timeout: a server can send headers and
                // then stall. Clear the timer only once the body is fully consumed.
                const text = await res.text();
                clearTimeout(timeout);
                try {
                    return JSON.parse(text) as unknown;
                } catch {
                    // A 200 with a non-JSON body is an upstream failing server-side:
                    // Maplify's "Unable to connect to the database", or a PHP fatal-error
                    // page. Throw a snippet of what came back rather than an opaque
                    // JSON-parse position; retried like any transient failure.
                    throw new Error(
                        `${name} returned a non-JSON ${res.status} body ` +
                            `(${text.length} chars): ${bodySnippet(text)}`,
                    );
                }
            }
        } catch (e) {
            // A fetch-level failure, an abort (the timeout), a stalled body read, or the
            // non-JSON throw above. Everything the fetch layer retries is transient by
            // definition (decision 042).
            clearTimeout(timeout);
            lastError = markTransientUpstream(e);
            if (attempt === MAX_ATTEMPTS) break;
            const delay = retryDelayMs(attempt);
            log(`${name} fetch error, retrying`, { attempt, delayMs: delay, error: String(e) });
            await sleep(delay);
            continue;
        }

        // Non-2xx: res is defined and not ok.
        clearTimeout(timeout);
        const httpError = new Error(`${name} HTTP ${res.status}`);
        lastError = isRetryableStatus(res.status) ? markTransientUpstream(httpError) : httpError;
        // drain the body so the connection can be reused or closed cleanly
        await res.body?.cancel();
        if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) break;
        const delay = retryDelayMs(attempt, parseRetryAfter(res.headers.get('retry-after')));
        log(`${name} non-2xx, retrying`, { attempt, status: res.status, delayMs: delay });
        await sleep(delay);
    }

    throw lastError ?? new Error(`${name} fetch failed`);
}
