import { test, expect, describe } from 'vitest';
import { Temporal } from 'temporal-polyfill';
import { FULL_SCALE_VOLUME, monthGrid, volumeScale } from './calendar.ts';

describe('monthGrid', () => {
  test('is always six Sunday-started weeks', () => {
    for (const ym of ['2026-02', '2026-07', '2027-08', '2024-02']) {
      const days = monthGrid(Temporal.PlainYearMonth.from(ym));
      expect(days).toHaveLength(42);
      expect(days[0]!.dayOfWeek).toBe(7); // ISO Sunday
      days.forEach((day, i) => {
        if (i > 0) expect(day.since(days[0]!).days).toBe(i);
      });
    }
  });

  test('starts on the Sunday on or before the first of the month', () => {
    // 2026-07-01 is a Wednesday, so the grid opens on Sunday 2026-06-28.
    expect(monthGrid(Temporal.PlainYearMonth.from('2026-07'))[0]!.toString()).toBe('2026-06-28');
    // 2026-03-01 is itself a Sunday — no leading days.
    expect(monthGrid(Temporal.PlainYearMonth.from('2026-03'))[0]!.toString()).toBe('2026-03-01');
  });

  test('covers every day of the month', () => {
    const month = Temporal.PlainYearMonth.from('2026-07');
    const isos = new Set(monthGrid(month).map(d => d.toString()));
    for (let day = 1; day <= month.daysInMonth; day++)
      expect(isos.has(month.toPlainDate({day}).toString())).toBe(true);
  });
});

describe('volumeScale', () => {
  test('draws nothing for a day with no sightings', () => {
    expect(volumeScale(0)).toBe(0);
  });

  test('reaches full size at the top of the domain, and clamps past it', () => {
    expect(volumeScale(FULL_SCALE_VOLUME)).toBeCloseTo(1);
    expect(volumeScale(FULL_SCALE_VOLUME * 5)).toBe(1);
  });

  test('scales area, not width, with volume', () => {
    // Four times the sightings should be four times the ink.
    expect(volumeScale(80) / volumeScale(20)).toBeCloseTo(2);
  });

  test('keeps a single sighting visible but clearly quiet', () => {
    expect(volumeScale(1)).toBeGreaterThanOrEqual(0.2);
    expect(volumeScale(1)).toBeLessThan(volumeScale(FULL_SCALE_VOLUME));
  });

  test('stays within 0…1', () => {
    for (const count of [1, 5, 40, 120, 200, 5000]) {
      expect(volumeScale(count)).toBeLessThanOrEqual(1);
      expect(volumeScale(count)).toBeGreaterThan(0);
    }
  });
});
