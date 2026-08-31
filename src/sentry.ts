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
 * Bind the client and install its integrations. Every entry point calls this
 * and nothing else, so the four of them cannot disagree about Sentry — which
 * they did: `salish-sea` gated `init()` on PROD and the three profile pages
 * called it unconditionally, so a dev session on a profile page reported to the
 * production DSN.
 *
 * Nothing is transmitted outside production. Binding the client to the scope is
 * what makes `captureException` send, so the gate has to sit here rather than
 * on `init()` alone — `init()` only installs integrations, and a direct
 * `captureException` (which [decision 031](../docs/decisions/031-surfacing-failures.md)
 * put behind every user-visible failure, so there are now many) transmitted in
 * dev whether or not it had run. Unbound, `captureException` is a no-op.
 *
 * The alternative was to keep sending and filter on the `environment` tag in
 * Sentry. Rejected: a dev session's errors are already in the console in front
 * of you, and the ones a developer causes on purpose would spend quota and
 * raise alerts to be sorted out afterwards.
 */
export function initSentry(): void {
  if (!import.meta.env.PROD) return;
  getCurrentScope().setClient(sentryClient);
  sentryClient.init();
}
