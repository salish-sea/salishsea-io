// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { dateFromObservedAt } from './salish-sea.ts';
// Side-effect import: registers <salish-sea> custom element via @customElement('salish-sea')
import './salish-sea.ts';

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

// jsdom lacks ResizeObserver (used by OpenLayers in obs-map) — stub it globally so
// instantiating <salish-sea> doesn't throw before tests can run.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

afterEach(() => {
  // Remove any <salish-sea> elements added by tests
  document.body.querySelectorAll('salish-sea').forEach(el => el.remove());
});

test('header info control is a plain anchor to /about.html with no dialog', async () => {
  const el = document.createElement('salish-sea') as InstanceType<typeof import('./salish-sea.ts').default>;
  document.body.appendChild(el);
  await el.updateComplete;

  const aboutLink = el.shadowRoot!.querySelector('a.about-link') as HTMLAnchorElement | null;
  expect(aboutLink).not.toBeNull();
  expect(aboutLink!.getAttribute('href')).toBe('/about.html');
  // Icon-only control needs an explicit accessible name for screen readers / voice control
  expect(aboutLink!.getAttribute('aria-label')).toBe('About SalishSea.io');

  const dialog = el.shadowRoot!.querySelector('dialog');
  expect(dialog).toBeNull();
});
