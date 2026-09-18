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

/**
 * Transient-failure marker (decision 042).
 *
 * A failure the next cron tick is expected to fix on its own — an upstream 5xx,
 * a timeout, a refused connection. The ingest shell writes a `failed`
 * ingest.runs row for these as for any other, but does not report them to
 * Sentry: a five-minute cadence over a rolling ten-day window re-covers the
 * same ground, so one bad tick is self-healing and nobody acts on the alert.
 *
 * The definition is deliberately not a second opinion. Transient means exactly
 * "what the fetch layer already chose to retry", so there is one classifier
 * serving both the retry policy and the alerting policy and no way for the two
 * to drift apart. A failure nothing chose to retry — a parse failure, a broken
 * completeness invariant, a 4xx — stays unmarked and reaches Sentry, which is
 * the case the heartbeat (decision 012) structurally cannot see because it
 * only fires when no *successful* run is recent.
 *
 * Marked with a globally-registered symbol rather than a subclass so the check
 * survives the module being bundled more than once (the edge function and the
 * scripts load this file through different paths).
 */
const TRANSIENT_UPSTREAM = Symbol.for('salishsea.ingest.transientUpstream');

/** Tag an error as transient, returning it unchanged. Non-objects pass through. */
export function markTransientUpstream<E>(error: E): E {
    if (typeof error === 'object' && error !== null) {
        Object.defineProperty(error, TRANSIENT_UPSTREAM, { value: true, enumerable: false });
    }
    return error;
}

/** Whether an error was tagged transient. Anything unmarked is treated as a defect. */
export function isTransientUpstream(error: unknown): boolean {
    return typeof error === 'object' && error !== null
        && (error as Record<PropertyKey, unknown>)[TRANSIENT_UPSTREAM] === true;
}

/**
 * Whether a failed run should be reported to Sentry (decision 042).
 *
 * Suppression rests on one fact: the cron refires every five minutes over a
 * ROLLING window, so a transient failure is re-covered by the next tick. That
 * is not true of a manual run, which targets an explicit window — usually a
 * historical one a backfill is walking — that no cron will ever revisit, while
 * the cron's own successes keep the heartbeat green. So a manual run reports
 * whatever it hits, and only cron ticks are allowed to go quiet.
 */
export function shouldReportFailure(error: unknown, trigger: 'cron' | 'manual'): boolean {
    return trigger !== 'cron' || !isTransientUpstream(error);
}
