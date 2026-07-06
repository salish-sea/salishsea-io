import { describe, test, expect } from 'vitest';
import { MAX_ATTEMPTS, parseRetryAfter, retryDelayMs, isRetryableStatus } from './retry.ts';

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
