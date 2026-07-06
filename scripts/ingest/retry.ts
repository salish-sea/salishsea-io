/**
 * Ingest retry policy — functional core (salishsea-io-89d.1 / decision 011).
 *
 * Pure, runtime-agnostic. The imperative shell owns the actual sleeping and
 * re-fetching; this module only decides HOW LONG to wait. Minimal by design: a
 * few attempts with short exponential backoff, honouring an upstream Retry-After.
 * Beyond MAX_ATTEMPTS the shell aborts and lets the next 5-minute cron be the real
 * retry — the cadence plus self-healing 10-day windows already provide free retry.
 */

/** Total fetch attempts per invocation (1 initial + up to 2 retries). */
export const MAX_ATTEMPTS = 3;

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

/**
 * Parse a Retry-After header value. Supports the delay-seconds form only; the
 * HTTP-date form returns null (the caller falls back to exponential backoff)
 * because resolving a date requires the current time, which is an effect.
 */
export function parseRetryAfter(header: string | null | undefined): number | null {
    if (header == null) return null;
    const trimmed = header.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds : null;
}

/**
 * Milliseconds to wait before the next attempt, given the 1-based number of the
 * attempt that just failed and an optional Retry-After (seconds). Retry-After
 * wins when present; otherwise exponential backoff, both capped at MAX_DELAY_MS.
 */
export function retryDelayMs(failedAttempt: number, retryAfterSeconds?: number | null): number {
    if (retryAfterSeconds != null && retryAfterSeconds >= 0) {
        return Math.min(retryAfterSeconds * 1000, MAX_DELAY_MS);
    }
    const exp = BASE_DELAY_MS * 2 ** Math.max(0, failedAttempt - 1);
    return Math.min(exp, MAX_DELAY_MS);
}

/** Whether an HTTP status is worth retrying (transient): 429 and 5xx. */
export function isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 599);
}
