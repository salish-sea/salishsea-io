// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/browser', () => ({captureException: (...args: unknown[]) => captureException(...args)}));

const { isNetworkFailure, reportError } = await import('./report-error.ts');
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

  it('wraps a cause that is not an Error, so Sentry shows the sentence rather than [object Foo]', () => {
    const el = document.createElement('div');
    const cause = {code: 2, message: 'Position unavailable'};
    reportError(el, "Couldn't place your marker", {cause});
    const captured = captureException.mock.calls[0]![0] as Error;
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe("Couldn't place your marker");
    expect(captured.cause).toBe(cause);
  });

  it('groups by the fingerprint it is given', () => {
    const cause = new Error('no WebGL2');
    reportError(document.body, 'No map here.', {cause, fingerprint: ['maplibre-no-webgl2']});
    expect(captureException).toHaveBeenCalledWith(cause, {fingerprint: ['maplibre-no-webgl2']});
  });

  it('with capture off, tells the user and not Sentry', () => {
    const el = document.createElement('div');
    const seen = listenOn(el);
    reportError(el, "Couldn't show your location", {cause: {code: 1}, capture: false});
    expect(seen).toEqual([{message: "Couldn't show your location", persist: false}]);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('passes persist through for conditions that outlive the toast', () => {
    const el = document.createElement('div');
    const seen = listenOn(el);
    reportError(el, 'Sightings did not load', {persist: true});
    expect(seen[0]!.persist).toBe(true);
  });
});

describe('isNetworkFailure', () => {
  it.each(['Failed to fetch', 'Failed to fetch (salishsea.io)', 'Load failed', 'NetworkError when attempting to fetch resource.'])(
    'is the TypeError fetch throws when no response came: %s', message => {
      expect(isNetworkFailure(new TypeError(message))).toBe(true);
    });

  it('is not an HTTP error, another TypeError, or the same words on another kind of error', () => {
    expect(isNetworkFailure(new Error('https://salishsea.io/days/2024-07-16.json: HTTP 503'))).toBe(false);
    expect(isNetworkFailure(new TypeError("Cannot read properties of null (reading 'map')"))).toBe(false);
    expect(isNetworkFailure(new Error('Failed to fetch'))).toBe(false);
    expect(isNetworkFailure('Failed to fetch')).toBe(false);
  });
});
