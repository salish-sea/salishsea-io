import {BrowserClient, breadcrumbsIntegration, dedupeIntegration, defaultStackParser, getCurrentScope, globalHandlersIntegration, makeFetchTransport, linkedErrorsIntegration, browserTracingIntegration, feedbackIntegration, startInactiveSpan, captureException, addBreadcrumb} from "@sentry/browser";
import {supabaseIntegration} from '@supabase/sentry-js-integration';
import { supabase } from "./supabase.ts";

const sentryClient = new BrowserClient({
  dsn: "https://56ce99ce80994bab79dab62d06078c97@o4509634382331904.ingest.us.sentry.io/4509634387509248",
  environment: import.meta.env.MODE,
  transport: makeFetchTransport,
  stackParser: defaultStackParser,
  tracesSampleRate: 1.0,
  sendDefaultPii: true,
  integrations: [
    browserTracingIntegration({
      shouldCreateSpanForRequest: url => !url.startsWith(`${import.meta.env.VITE_SUPABASE_URL}/rest`),
    }),
    breadcrumbsIntegration(),
    feedbackIntegration({
      colorScheme: "system",
      formTitle: "Report a Bug or Give Feedback",
      isNameRequired: true,
      successMessageText: "Thank you for taking the time to let us know.",
      triggerLabel: "Report Bug or Give Feedback",
    }),
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
