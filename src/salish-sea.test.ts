// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { dateFromObservedAt } from './salish-sea.ts';

test('dateFromObservedAt: UTC midnight in PST8PDT is still the same calendar day', () => {
  // 2024-07-15T18:23:00Z is 11:23 PDT — still July 15 in Pacific time
  expect(dateFromObservedAt('2024-07-15T18:23:00Z')).toBe('2024-07-15');
});

test('dateFromObservedAt: 06:00 UTC = 22:00 PST, still the previous calendar day', () => {
  // 2024-07-16T06:00:00Z is 22:00 PDT on July 15 — still July 15 in Pacific time
  expect(dateFromObservedAt('2024-07-16T06:00:00Z')).toBe('2024-07-15');
});

test('dateFromObservedAt: 08:01 UTC = 00:01 PDT, just past midnight Pacific', () => {
  // 2024-07-16T08:01:00Z is 00:01 PDT on July 16 — July 16 in Pacific time
  expect(dateFromObservedAt('2024-07-16T08:01:00Z')).toBe('2024-07-16');
});
