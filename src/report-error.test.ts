// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/browser', () => ({captureException: (...args: unknown[]) => captureException(...args)}));

const { reportError } = await import('./report-error.ts');
import type { ErrorReport } from './report-error.ts';

describe('reportError', () => {
  beforeEach(() => captureException.mockClear());
  afterEach(() => document.body.replaceChildren());

  const listenOn = (target: EventTarget) => {
    const seen: ErrorReport[] = [];
    target.addEventListener('report-error', e => seen.push((e as CustomEvent<ErrorReport>).detail));
    return seen;
  };

  it('carries the message and defaults to timing out', () => {
    const el = document.createElement('div');
    const seen = listenOn(el);
    reportError(el, 'Could not save');
    expect(seen).toEqual([{message: 'Could not save', persist: false}]);
  });

  it('escapes shadow DOM so any component can report without wiring', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const inner = document.createElement('span');
    host.attachShadow({mode: 'open'}).append(inner);

    const seen = listenOn(document.body);
    reportError(inner, 'Could not delete');

    // composed + bubbles: the point of the pattern is that nothing in between has to relay it.
    expect(seen).toEqual([{message: 'Could not delete', persist: false}]);
  });

  it('reports the underlying cause to Sentry, not a reconstructed message', () => {
    const el = document.createElement('div');
    const cause = new Error('AuthApiError: Nonces mismatch');
    reportError(el, 'Could not sign in', {cause});
    expect(captureException).toHaveBeenCalledWith(cause);
  });

  it('still reports to Sentry when there is no cause to pass on', () => {
    reportError(document.createElement('div'), 'Could not sign in');
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it('passes persist through for conditions that outlive the toast', () => {
    const el = document.createElement('div');
    const seen = listenOn(el);
    reportError(el, 'Sightings did not load', {persist: true});
    expect(seen[0]!.persist).toBe(true);
  });
});
