import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { addDays, antiEntropyWindow, curatorWindow, windowDays } from './windows.ts';

/**
 * Discovery suite (salish-us33): the ingests' date windows against models that count
 * days with integers rather than with Date, so the two share no calendar arithmetic.
 */

/** Days since 1970-01-01, by Howard Hinnant's days_from_civil. */
function dayNumber(day: string): number {
    let [y, m, d] = day.split('-').map(Number) as [number, number, number];
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

/** Its inverse, civil_from_days. */
function dayString(z: number): string {
    z += 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp + (mp < 10 ? 3 : -9);
    const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 1990 to 2040, with the year ends and leap days the arithmetic turns on near at hand.
const dayN = fc.oneof(
    fc.integer({min: dayNumber('1990-01-01'), max: dayNumber('2040-12-31')}),
    fc.constantFrom('2000-02-28', '2000-02-29', '2000-03-01', '1900-02-28', '2100-02-28', '2024-12-31', '2025-01-01', '2026-10-31')
        .map(dayNumber),
);
const day = dayN.map(dayString);

describe('windows (discovery)', () => {
    test('addDays agrees with integer day counting', () => {
        fc.assert(fc.property(dayN, fc.integer({min: -800, max: 800}), (n, k) => {
            expect(addDays(dayString(n), k)).toBe(dayString(n + k));
        }), {numRuns: 20000});
    });

    test('windowDays lists every day once, in order, ends included', () => {
        fc.assert(fc.property(dayN, fc.integer({min: 0, max: 120}), (n, len) => {
            const expected = Array.from({length: len + 1}, (_, i) => dayString(n + i));
            expect(windowDays({start: dayString(n), end: dayString(n + len)})).toEqual(expected);
        }));
        fc.assert(fc.property(dayN, fc.integer({min: 1, max: 10}), (n, back) => {
            expect(windowDays({start: dayString(n), end: dayString(n - back)})).toEqual([]);
        }));
    });

    test('curatorWindow accepts exactly real days in order', () => {
        const text = fc.oneof(day, fc.tuple(fc.integer({min: 0, max: 9999}), fc.integer({min: 0, max: 13}), fc.integer({min: 0, max: 32}))
            .map(([y, m, d]) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
            fc.string({maxLength: 12}));
        const real = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && dayString(dayNumber(s)) === s;
        fc.assert(fc.property(text, text, (a, b) => {
            const expected = real(a) && real(b) && a <= b ? {start: a, end: b} : null;
            expect(curatorWindow(a, b)).toEqual(expected);
        }), {numRuns: 20000});
    });

    test('antiEntropyWindow picks a whole month inside the range, the last cut at its end', () => {
        fc.assert(fc.property(dayN, fc.integer({min: -40, max: 2000}), fc.double({min: 0, max: 1, maxExcluded: true, noNaN: true}),
            fc.integer({min: 0, max: 3000}), (e, span, random, ageDays) => {
            const earliest = dayString(e);
            const before = dayString(e + span);
            const last = dayString(e + span - 1);
            const now = new Date(`${dayString(e + span + ageDays)}T12:00:00Z`);
            const w = antiEntropyWindow(earliest, before, now, random);
            if (span < 1) {
                expect(w).toBeNull();
                return;
            }
            // The model's months: from earliest's month to last's, each 1st to its last day.
            const months: {start: string, end: string}[] = [];
            for (let m = dayNumber(`${earliest.slice(0, 7)}-01`); m <= dayNumber(last);) {
                const start = dayString(m);
                const [y, mo] = start.split('-').map(Number) as [number, number];
                const next = dayNumber(mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`);
                months.push({start, end: next - 1 < dayNumber(last) ? dayString(next - 1) : last});
                m = next;
            }
            expect(months).toContainEqual(w);
        }), {numRuns: 5000});
    });
});
