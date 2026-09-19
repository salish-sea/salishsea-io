import { describe, expect, test } from 'vitest';
import { presenceYearsFor } from './haulout-page.ts';

/**
 * The grid window is derived, not declared (salish-4pr / decision 040).
 *
 * It used to be `MIRROR_SINCE_YEAR = 2025`, correct when measured on 2026-09-11
 * and wrong a week later: decision 041's backfill took the mirror to 1978, and
 * 11,438 of the 17,376 pinniped reports we hold fell below that line. Every grid
 * would have drawn two years and silently omitted two thirds of the history,
 * with the report list beneath it showing the reports the grid did not.
 */
describe('presenceYearsFor', () => {
  const report = (year: number) => ({ observed_at: `${year}-06-15T19:00:00Z` });

  test('spans the site\'s own history', () => {
    expect(presenceYearsFor([report(2020), report(2026)], 2026)).toBe(7);
    expect(presenceYearsFor([report(2024)], 2026)).toBe(3);
  });

  test('a site whose reports are all recent still gets a readable grid', () => {
    // One row would read as a bar chart rather than a seasonal shape.
    expect(presenceYearsFor([report(2026)], 2026)).toBe(2);
  });

  test('a site with no reports asks for the minimum, and renders nothing anyway', () => {
    expect(presenceYearsFor([], 2026)).toBe(2);
  });

  test('a single ancient report does not draw forty blank rows', () => {
    // The 1978 tail is real and thin. Capped, and the coverage note says so.
    expect(presenceYearsFor([report(1978), report(2026)], 2026)).toBe(12);
  });

  test('dates are read in Pacific time, like every other date the app shows', () => {
    // 2025-01-01T04:00Z is still 2024-12-31 in PST8PDT. Reading it as UTC would
    // give the grid an extra year at one end for no reason.
    expect(presenceYearsFor([{ observed_at: '2025-01-01T04:00:00Z' }], 2026)).toBe(3);
  });
});
