import { describe, expect, test, vi } from 'vitest';
import { Intl as TemporalIntl, Temporal } from 'temporal-polyfill';

import { formatDate } from './date-format.ts';

describe('formatDate', () => {
  const date = Temporal.PlainDate.from('2026-05-01');
  const formats: Intl.DateTimeFormatOptions[] = [
    { month: 'long', day: 'numeric', year: 'numeric' },
    { month: 'short', day: 'numeric', year: 'numeric' },
    { month: 'long', year: 'numeric' },
    { month: 'long' },
  ];

  test.each(formats)('writes what toLocaleString writes: %o', options => {
    expect(formatDate(date, options)).toBe(date.toLocaleString('en-US', options));
  });

  // The reason it exists: a formatter per call grew the haul-out render past a
  // gigabyte of native memory on Fly (decision 057, step 5).
  test('builds one formatter per format, however many dates it writes', () => {
    const made = vi.spyOn(TemporalIntl, 'DateTimeFormat');
    const options = { month: 'narrow', year: '2-digit' } as const;
    for (let day = 1; day <= 28; day++) formatDate(date.with({ day }), options);
    expect(made).toHaveBeenCalledTimes(1);
    made.mockRestore();
  });
});
