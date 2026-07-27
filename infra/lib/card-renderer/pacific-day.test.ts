import { currentPacificDate, isValidDate, pacificDayRange } from './pacific-day';

describe('isValidDate', () => {
  it.each(['2026-07-27', '2024-02-29', '2000-01-01'])('accepts %s', d => {
    expect(isValidDate(d)).toBe(true);
  });

  it.each([
    '2026-02-31',   // Date would silently roll this to March 3
    '2025-02-29',   // not a leap year
    '2026-13-01',
    '2026-7-27',    // unpadded
    '20260727',
    '2026-07-27T00:00:00Z',
    'yesterday',
    '',
  ])('rejects %s', d => {
    expect(isValidDate(d)).toBe(false);
  });
});

describe('pacificDayRange', () => {
  it('starts a summer day at 07:00 UTC (PDT is UTC-7)', () => {
    const { startIso, endIso } = pacificDayRange('2026-07-27');
    expect(startIso).toBe('2026-07-27T07:00:00.000Z');
    expect(endIso).toBe('2026-07-28T07:00:00.000Z');
  });

  it('starts a winter day at 08:00 UTC (PST is UTC-8)', () => {
    const { startIso, endIso } = pacificDayRange('2026-01-15');
    expect(startIso).toBe('2026-01-15T08:00:00.000Z');
    expect(endIso).toBe('2026-01-16T08:00:00.000Z');
  });

  it('makes the spring-forward day 23 hours long', () => {
    // DST begins 2026-03-08 in the US: that Pacific day loses an hour.
    const { startIso, endIso } = pacificDayRange('2026-03-08');
    const hours = (Date.parse(endIso) - Date.parse(startIso)) / 3600_000;
    expect(hours).toBe(23);
  });

  it('makes the fall-back day 25 hours long', () => {
    // DST ends 2026-11-01.
    const { startIso, endIso } = pacificDayRange('2026-11-01');
    const hours = (Date.parse(endIso) - Date.parse(startIso)) / 3600_000;
    expect(hours).toBe(25);
  });

  it('is half-open, so consecutive days abut without overlapping', () => {
    const first = pacificDayRange('2026-07-27');
    const second = pacificDayRange('2026-07-28');
    expect(first.endIso).toBe(second.startIso);
  });

  it('agrees with the app on which day an observation falls in', () => {
    // The frontend's own cases (src/salish-sea.test.ts): 06:00 UTC on the 16th is
    // still the 15th in Pacific time; 08:01 UTC has crossed into the 16th.
    const july15 = pacificDayRange('2024-07-15');
    const stillThe15th = Date.parse('2024-07-16T06:00:00Z');
    const nowThe16th = Date.parse('2024-07-16T08:01:00Z');
    expect(stillThe15th).toBeGreaterThanOrEqual(Date.parse(july15.startIso));
    expect(stillThe15th).toBeLessThan(Date.parse(july15.endIso));
    expect(nowThe16th).toBeGreaterThanOrEqual(Date.parse(july15.endIso));
  });

  it('refuses a date that is not a date', () => {
    expect(() => pacificDayRange('2026-02-31')).toThrow(/calendar date/);
  });
});

describe('currentPacificDate', () => {
  it('reports the Pacific date, not the UTC one', () => {
    // 07:00 UTC on the 28th is midnight PDT — so still the 27th an hour earlier.
    expect(currentPacificDate(new Date('2026-07-28T06:59:00Z'))).toBe('2026-07-27');
    expect(currentPacificDate(new Date('2026-07-28T07:00:00Z'))).toBe('2026-07-28');
  });
});
