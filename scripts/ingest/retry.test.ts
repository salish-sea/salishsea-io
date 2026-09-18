import { describe, test, expect } from 'vitest';
import {
    MAX_ATTEMPTS, parseRetryAfter, retryDelayMs, isRetryableStatus,
    markTransientUpstream, isTransientUpstream, shouldReportFailure,
} from './retry.ts';

describe('parseRetryAfter', () => {
    test('parses delay-seconds', () => {
        expect(parseRetryAfter('120')).toBe(120);
        expect(parseRetryAfter('0')).toBe(0);
    });
    test('returns null for HTTP-date, empty, or garbage', () => {
        expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
        expect(parseRetryAfter(null)).toBeNull();
        expect(parseRetryAfter(undefined)).toBeNull();
        expect(parseRetryAfter('  ')).toBeNull();
        expect(parseRetryAfter('-5')).toBeNull();
    });
});

describe('retryDelayMs', () => {
    test('exponential backoff by failed attempt, capped', () => {
        expect(retryDelayMs(1)).toBe(500);
        expect(retryDelayMs(2)).toBe(1000);
        expect(retryDelayMs(3)).toBe(2000);
        expect(retryDelayMs(100)).toBe(30_000); // capped
    });
    test('Retry-After overrides backoff and is capped', () => {
        expect(retryDelayMs(1, 5)).toBe(5000);
        expect(retryDelayMs(3, 0)).toBe(0);
        expect(retryDelayMs(1, 9999)).toBe(30_000);
    });
});

describe('isRetryableStatus', () => {
    test('429 and 5xx are retryable; 2xx/4xx (except 429) are not', () => {
        expect(isRetryableStatus(429)).toBe(true);
        expect(isRetryableStatus(500)).toBe(true);
        expect(isRetryableStatus(503)).toBe(true);
        expect(isRetryableStatus(200)).toBe(false);
        expect(isRetryableStatus(403)).toBe(false);
        expect(isRetryableStatus(404)).toBe(false);
    });
    test('MAX_ATTEMPTS is a small positive number', () => {
        expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
        expect(MAX_ATTEMPTS).toBeLessThanOrEqual(5);
    });
});

describe('transient-upstream marking (decision 042)', () => {
    test('an unmarked error is a defect, so it reaches Sentry', () => {
        // The default matters more than the marking: a failure nobody classified
        // must alert, never go quiet.
        expect(isTransientUpstream(new Error('iNaturalist observations parse failed'))).toBe(false);
        expect(isTransientUpstream(undefined)).toBe(false);
        expect(isTransientUpstream(null)).toBe(false);
        expect(isTransientUpstream('a thrown string')).toBe(false);
        expect(isTransientUpstream({})).toBe(false);
    });

    test('marking returns the same error, with the message untouched', () => {
        const error = new Error('Maplify HTTP 503');
        expect(markTransientUpstream(error)).toBe(error);
        expect(error.message).toBe('Maplify HTTP 503');
        expect(isTransientUpstream(error)).toBe(true);
    });

    test('the marker does not show up in enumeration or serialization', () => {
        const error = markTransientUpstream(new Error('boom'));
        expect(Object.keys(error)).toEqual([]);
        expect(JSON.stringify({ ...error })).toBe('{}');
    });

    test('a non-object passes through unharmed and stays a defect', () => {
        expect(markTransientUpstream('nope')).toBe('nope');
        expect(isTransientUpstream(markTransientUpstream('nope'))).toBe(false);
    });

    test('the marker survives a second copy of the module (global symbol)', () => {
        // The edge function and the scripts load retry.ts through different
        // paths; an instanceof-based check would break here.
        const error = markTransientUpstream(new Error('timeout'));
        const viaRegistry = (error as unknown as Record<PropertyKey, unknown>)[
            Symbol.for('salishsea.ingest.transientUpstream')
        ];
        expect(viaRegistry).toBe(true);
    });

    test('every status the retry policy retries is a status we stay quiet on', () => {
        // The two policies share one classifier; this pins them together so a
        // change to isRetryableStatus cannot silently widen what goes unreported.
        for (const status of [429, 500, 502, 503, 504]) {
            expect(isRetryableStatus(status)).toBe(true);
        }
        for (const status of [400, 401, 403, 404, 422]) {
            expect(isRetryableStatus(status)).toBe(false);
        }
    });
});

describe('shouldReportFailure (decision 042)', () => {
    const transient = () => markTransientUpstream(new Error('Maplify HTTP 503'));
    const defect = () => new Error('iNaturalist observations parse failed');

    test('a cron tick stays quiet on a transient failure — the next tick re-covers it', () => {
        expect(shouldReportFailure(transient(), 'cron')).toBe(false);
    });

    test('a cron tick still reports a defect', () => {
        expect(shouldReportFailure(defect(), 'cron')).toBe(true);
    });

    test('a MANUAL run reports even a transient failure', () => {
        // The suppression argument is "the next tick re-covers the window". A
        // manual run targets an explicit, usually historical window that no cron
        // will revisit, and the cron's own successes keep the heartbeat green —
        // so staying quiet here would lose a failed backfill entirely. This is
        // the shape of the 2018-01 Maplify HTTP 520 hit during decision 041's walk.
        expect(shouldReportFailure(transient(), 'manual')).toBe(true);
        expect(shouldReportFailure(defect(), 'manual')).toBe(true);
    });
});
