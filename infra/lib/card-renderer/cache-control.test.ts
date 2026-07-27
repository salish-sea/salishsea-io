import {
  FRESH, FRESH_WINDOW_DAYS, MISS, SETTLED, cacheControlForDate, cacheControlForInstant,
} from './cache-control';
import { pacificDayRange } from './pacific-day';

const NOW = new Date('2026-07-27T18:00:00Z'); // 11:00 PDT
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000).toISOString();

describe('the policies themselves', () => {
  it('keeps a recent subject briefly and revalidated', () => {
    expect(FRESH).toContain('max-age=300');
    expect(FRESH).toContain('must-revalidate');
  });

  it('never marks a card immutable', () => {
    // Curation can revise an old record; `immutable` would make every such
    // correction depend on someone remembering to invalidate CloudFront.
    for (const policy of [FRESH, SETTLED, MISS]) {
      expect(policy).not.toContain('immutable');
    }
  });

  it('settles to a month, not a year', () => {
    expect(SETTLED).toBe(`public, max-age=${30 * 24 * 3600}`);
  });
});

describe('cacheControlForInstant (occurrence cards)', () => {
  it('treats a sighting from minutes ago as fresh', () => {
    expect(cacheControlForInstant(daysBefore(0), NOW)).toBe(FRESH);
  });

  it.each([1, 2, 3])('treats a sighting from %i day(s) ago as fresh', (days) => {
    expect(cacheControlForInstant(daysBefore(days), NOW)).toBe(FRESH);
  });

  it('is fresh right up to the window edge', () => {
    const justInside = new Date(NOW.getTime() - FRESH_WINDOW_DAYS * 24 * 3600_000 + 60_000);
    expect(cacheControlForInstant(justInside.toISOString(), NOW)).toBe(FRESH);
  });

  it('settles once past the window', () => {
    const justOutside = new Date(NOW.getTime() - FRESH_WINDOW_DAYS * 24 * 3600_000 - 60_000);
    expect(cacheControlForInstant(justOutside.toISOString(), NOW)).toBe(SETTLED);
  });

  it.each([5, 30, 400])('treats a sighting from %i days ago as settled', (days) => {
    expect(cacheControlForInstant(daysBefore(days), NOW)).toBe(SETTLED);
  });

  it('treats a future timestamp as fresh, not as a month-old record', () => {
    // Clock skew or a bad observed_at should not earn a long cache.
    expect(cacheControlForInstant(daysBefore(-2), NOW)).toBe(FRESH);
  });

  it('falls back to fresh on an unparseable timestamp', () => {
    expect(cacheControlForInstant('not a date', NOW)).toBe(FRESH);
  });
});

describe('cacheControlForDate (day cards)', () => {
  const forDate = (date: string, now = NOW) =>
    cacheControlForDate(date, pacificDayRange(date).endIso, now);

  it('keeps today fresh', () => {
    expect(forDate('2026-07-27')).toBe(FRESH);
  });

  it.each(['2026-07-26', '2026-07-25', '2026-07-24'])('keeps %s fresh', (date) => {
    // Sightings keep arriving for a day well after it ends — ingest lag and
    // late community reports — so yesterday is not settled.
    expect(forDate(date)).toBe(FRESH);
  });

  it('settles a day once four days have passed since it ended', () => {
    expect(forDate('2026-07-20')).toBe(SETTLED);
  });

  it('measures from the end of the day, so a day is fresh from its first minute', () => {
    const justAfterMidnightPacific = new Date('2026-07-27T07:01:00Z');
    expect(forDate('2026-07-27', justAfterMidnightPacific)).toBe(FRESH);
  });

  it('treats a future date as fresh', () => {
    expect(forDate('2026-08-15')).toBe(FRESH);
  });
});
