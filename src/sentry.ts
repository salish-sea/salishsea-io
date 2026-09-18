import {BrowserClient, breadcrumbsIntegration, dedupeIntegration, defaultStackParser, eventFiltersIntegration, getCurrentScope, globalHandlersIntegration, makeFetchTransport, linkedErrorsIntegration, browserTracingIntegration, startInactiveSpan, captureException, addBreadcrumb} from "@sentry/browser";
import {supabaseIntegration} from '@supabase/sentry-js-integration';
import { supabase } from "./supabase.ts";
import { DENY_URLS, dropThirdPartyNoise, IGNORE_ERRORS } from "./sentry-noise.ts";

/**
 * Exported for `src/sentry.test.ts` only. Nothing else should reach for the
 * client — every entry point goes through {@link initSentry}, which is the
 * whole point of that function (decision 037).
 */
export const sentryClient = new BrowserClient({
  dsn: "https://56ce99ce80994bab79dab62d06078c97@o4509634382331904.ingest.us.sentry.io/4509634387509248",
  environment: import.meta.env.MODE,
  transport: makeFetchTransport,
  stackParser: defaultStackParser,
  tracesSampleRate: 1.0,
  sendDefaultPii: true,
  // What we decline to send, and why: src/sentry-noise.ts (decision 046). The
  // rules live there as pure, tested predicates rather than inline literals,
  // because each one is a claim about a specific third party that has to stay
  // checkable — and because "does this match a Supabase network failure?" is a
  // question worth being able to ask in a test.
  denyUrls: [...DENY_URLS],
  ignoreErrors: [...IGNORE_ERRORS],
  beforeSend: dropThirdPartyNoise,
  integrations: [
    browserTracingIntegration({
      shouldCreateSpanForRequest: url => !url.startsWith(`${import.meta.env.VITE_SUPABASE_URL}/rest`),
    }),
    breadcrumbsIntegration(),
    // This is what makes `denyUrls` and `ignoreErrors` above do anything. They
    // are not client-level behaviour — they are implemented BY this integration,
    // which ships in Sentry's defaults and is therefore absent here, because
    // passing an explicit `integrations` array replaces the defaults rather than
    // extending them. Without it the two options are accepted, type-checked and
    // silently inert.
    eventFiltersIntegration(),
    // No feedbackIntegration. Sentry hears about failures; it is no longer how
    // a person tells us about one — that is <feedback-form>, posting to our own
    // Supabase (decision 039). Sentry's widget could only deliver a report if
    // the browser could reach sentry.io, and a content blocker or a captive
    // portal is enough that it cannot; on 2026-09-08 a report naming three real
    // bugs died in the form because of it.
    globalHandlersIntegration(),
    linkedErrorsIntegration(),
    dedupeIntegration(),
    supabaseIntegration(supabase(), {startInactiveSpan, captureException, addBreadcrumb}, {
      tracing: true,
      breadcrumbs: true,
      errors: true,
    }),
  ],
});

/**
 * Bind the client and install its integrations — the one call every entry point
 * makes, so the four of them cannot disagree about Sentry.
 *
 * Nothing is transmitted outside production, and the gate is on the *binding*
 * rather than on `init()`: binding the client to the scope is what makes
 * `captureException` send, while `init()` only installs integrations. Reasoning
 * and the rejected alternatives are in
 * [decision 037](../docs/decisions/037-sentry-transmits-from-production-only.md).
 */
export function initSentry(): void {
  if (!import.meta.env.PROD) return;
  getCurrentScope().setClient(sentryClient);
  sentryClient.init();
}
