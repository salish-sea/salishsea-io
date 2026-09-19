import { describe, expect, test } from 'vitest';
import { sentryClient } from './sentry.ts';
import { DENY_URLS, IGNORE_ERRORS, dropThirdPartyNoise } from './sentry-noise.ts';

/**
 * The wiring, not the rules — `sentry-noise.test.ts` owns those, and
 * `sentry.test.ts` owns the production gate.
 *
 * A separate file because this one needs the REAL client: `sentry.test.ts`
 * mocks `BrowserClient` away to a stub with an `init` spy, which is right for
 * asserting what `initSentry` calls and useless for asserting what the client
 * was configured with.
 *
 * It exists for one failure mode. `denyUrls` and `ignoreErrors` do nothing on
 * their own: they are implemented by `eventFiltersIntegration`, which arrives in
 * Sentry's default integrations, and passing an explicit `integrations` array —
 * as this client does, for `supabaseIntegration` and to leave out
 * `feedbackIntegration` (decision 039) — replaces the defaults rather than
 * extending them. Drop that one line and both options stay type-correct, stay in
 * the options object, and silently filter nothing, with no error anywhere.
 */
describe('the Sentry client is wired to actually filter (decision 046)', () => {
  const options = sentryClient.getOptions();

  // Read off the OPTIONS, not off the client: integrations are only installed by
  // client.init(), which initSentry() skips outside production (decision 037),
  // so getIntegrationByName is empty here and would make every assertion below
  // vacuously true.
  const names = (options.integrations ?? []).map((i) => i.name);

  test('eventFiltersIntegration is in the array, or the two options do nothing', () => {
    expect(names).toContain('EventFilters');
  });

  test('the integrations we chose deliberately are still there', () => {
    for (const name of ['Dedupe', 'LinkedErrors', 'GlobalHandlers']) {
      expect(names, name).toContain(name);
    }
    // And this one must stay absent — decision 039 replaced it with our own form.
    expect(names).not.toContain('Feedback');
  });

  test('the filter lists reach the client', () => {
    expect(options.denyUrls).toEqual([...DENY_URLS]);
    expect(options.ignoreErrors).toEqual([...IGNORE_ERRORS]);
    expect(options.beforeSend).toBe(dropThirdPartyNoise);
  });
});
