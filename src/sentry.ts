import {BrowserClient, breadcrumbsIntegration, dedupeIntegration, defaultStackParser, getCurrentScope, globalHandlersIntegration, makeFetchTransport, linkedErrorsIntegration, browserTracingIntegration, feedbackIntegration, startInactiveSpan, captureException, addBreadcrumb} from "@sentry/browser";
import {supabaseIntegration} from '@supabase/sentry-js-integration';
import { supabase } from "./supabase.ts";

export const sentryClient = new BrowserClient({
  dsn: "https://56ce99ce80994bab79dab62d06078c97@o4509634382331904.ingest.us.sentry.io/4509634387509248",
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
    supabaseIntegration(supabase, {startInactiveSpan, captureException, addBreadcrumb}, {
      tracing: true,
      breadcrumbs: true,
      errors: true,
    }),
  ],
});
getCurrentScope().setClient(sentryClient);
