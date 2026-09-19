import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import {
  DENY_URLS,
  dropThirdPartyNoise,
  IGNORE_ERRORS,
  isThirdPartyFrame,
  THIRD_PARTY_FRAME_FUNCTIONS,
  type NoiseCandidate,
} from './sentry-noise.ts';

/** An event with one exception and the given frames. */
const withFrames = (
  ...frames: { function?: string; filename?: string }[]
): NoiseCandidate => ({ exception: { values: [{ stacktrace: { frames } }] } });

describe('isThirdPartyFrame', () => {
  test('SALISHSEA-IO-3E: the Android in-app-browser bridge, verbatim', () => {
    // Frames exactly as Sentry received them on 2026-09-14.
    expect(isThirdPartyFrame(withFrames(
      { filename: 'iabjs://navigation_performance_logger_android' },
      { filename: 'iabjs://navigation_performance_logger_android', function: 'sendBeforeUnloadMessage' },
      { filename: 'iabjs://navigation_performance_logger_android', function: 'sendDataToNative' },
    ))).toBe(true);
  });

  test('SALISHSEA-IO-36: an injected widget blamed on our own origin', () => {
    // The filename IS salishsea.io — the widget is inline in our document — so
    // only the function name can tell this apart from our own stack overflow.
    expect(isThirdPartyFrame(withFrames(
      { filename: 'https://salishsea.io/', function: 'findTopmostVisibleElement' },
      { filename: 'https://salishsea.io/', function: 'findTopmostVisibleElement' },
    ))).toBe(true);
  });

  test('a browser extension frame', () => {
    expect(isThirdPartyFrame(withFrames({ filename: 'chrome-extension://abc/content.js' }))).toBe(true);
    expect(isThirdPartyFrame(withFrames({ filename: 'moz-extension://abc/content.js' }))).toBe(true);
  });

  test('our own code is never third-party, however deep or nameless', () => {
    expect(isThirdPartyFrame(withFrames(
      { filename: 'https://salishsea.io/assets/main-abc.js', function: 'fetchOccurrences' },
      { filename: 'https://salishsea.io/assets/main-abc.js' },
      { function: 'anonymous' },
    ))).toBe(false);
  });

  test('a real stack overflow in OUR code still reports', () => {
    // The guard that matters. SALISHSEA-IO-36's message is "Maximum call stack
    // size exceeded", which our own code could produce; only the frame name is
    // filtered, so the same message from our own recursion still sends.
    const ours = withFrames(...Array.from({ length: 50 }, () => ({
      filename: 'https://salishsea.io/assets/main-abc.js', function: 'dedupeOccurrenceLinks',
    })));
    expect(isThirdPartyFrame(ours)).toBe(false);
    expect(dropThirdPartyNoise(ours)).toBe(ours);
  });

  test('an event with no exception, no values or no frames is not noise', () => {
    // A message-only capture has no stacktrace at all; absence must not read as
    // a match, or beforeSend would silently swallow every such event.
    expect(isThirdPartyFrame({})).toBe(false);
    expect(isThirdPartyFrame({ exception: {} })).toBe(false);
    expect(isThirdPartyFrame({ exception: { values: [] } })).toBe(false);
    expect(isThirdPartyFrame({ exception: { values: [{}] } })).toBe(false);
    expect(isThirdPartyFrame(withFrames())).toBe(false);
  });

  test('looks past the top frame, unlike the SDK\'s own denyUrls', () => {
    expect(isThirdPartyFrame(withFrames(
      { filename: 'https://salishsea.io/assets/main-abc.js', function: 'handler' },
      { filename: 'iabjs://bridge' },
    ))).toBe(true);
  });
});

describe('dropThirdPartyNoise', () => {
  test('drops a match and passes anything else through unchanged', () => {
    expect(dropThirdPartyNoise(withFrames({ filename: 'iabjs://bridge' }))).toBeNull();
    const ours = withFrames({ filename: 'https://salishsea.io/assets/main.js', function: 'render' });
    expect(dropThirdPartyNoise(ours)).toBe(ours); // same object, not a copy
  });

  test('a Supabase network failure is NOT dropped', () => {
    // SALISHSEA-IO-37/-38/-3B: 24 events, 19 users. These look like noise one at
    // a time and are the only thing that distinguishes a boat losing signal from
    // a Supabase outage. Volume is the message, so they keep arriving.
    const networkFailure = withFrames(
      { filename: 'https://salishsea.io/assets/main-abc.js', function: 'fetchOccurrences' },
    );
    expect(dropThirdPartyNoise(networkFailure)).toBe(networkFailure);
  });
});

describe('the filter lists match what they claim', () => {
  test('no filtered function name appears anywhere in our own source', () => {
    // The whole basis for filtering by frame name is that these functions are
    // not ours. If one ever became ours, this filter would hide a real defect,
    // so the claim is asserted rather than trusted.
    const sources = readdirSync(path.resolve(__dirname))
      .filter((f) => f.endsWith('.ts') && !f.startsWith('sentry-noise'))
      .map((f) => readFileSync(path.resolve(__dirname, f), 'utf8'))
      .join('\n');
    for (const fn of THIRD_PARTY_FRAME_FUNCTIONS) {
      expect(sources, fn).not.toContain(fn);
    }
  });

  test('ignoreErrors does not match a Supabase network failure', () => {
    // The one rule this file must never break, asserted against the literal
    // messages Sentry recorded.
    for (const message of [
      'TypeError: Failed to fetch',
      'TypeError: Load failed',
      'PostgrestError: canceling statement due to statement timeout',
    ]) {
      for (const pattern of IGNORE_ERRORS) {
        const matched = typeof pattern === 'string'
          ? message.includes(pattern)
          : pattern.test(message);
        expect(matched, `${String(pattern)} matched ${message}`).toBe(false);
      }
    }
  });

  test('ignoreErrors matches the messages it was written for', () => {
    const noisy = [
      'Error invoking postMessage: Java object is gone',
      "undefined is not an object (evaluating 'window.webkit.messageHandlers')",
      'Invalid call to runtime.sendMessage(). Tab not found.',
      'Script error.',
    ];
    for (const message of noisy) {
      const matched = IGNORE_ERRORS.some((p) =>
        typeof p === 'string' ? message.includes(p) : p.test(message));
      expect(matched, message).toBe(true);
    }
  });

  test('denyUrls matches a scheme, not a substring of our own URLs', () => {
    for (const re of DENY_URLS) {
      expect(re.test('https://salishsea.io/assets/main-abc.js'), String(re)).toBe(false);
    }
    expect(DENY_URLS.some((re) => re.test('iabjs://bridge'))).toBe(true);
  });
});
