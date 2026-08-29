import { captureException } from '@sentry/browser';

export interface ErrorReport {
  /** What to tell the user. A sentence, not an exception string. */
  message: string;
  /** Keep it on screen until dismissed rather than letting it time out. */
  persist: boolean;
}

/**
 * Tell the user something failed, and tell Sentry. One call does both, on
 * purpose: [decision 030](../docs/decisions/030-google-signin-nonce.md) was a
 * bug that reached neither. Supabase returns auth failures in the result rather
 * than throwing, so an unchecked error was invisible to Sentry *and* to the
 * person clicking the button, and stayed that way for weeks.
 *
 * The event bubbles composed to `<salish-sea>`, which owns the toast. Call it
 * from anywhere in the tree; nothing in between has to know.
 */
export function reportError(
  source: EventTarget,
  message: string,
  {cause, persist = false}: {cause?: unknown; persist?: boolean} = {},
): void {
  captureException(cause ?? new Error(message));
  source.dispatchEvent(new CustomEvent<ErrorReport>('report-error', {
    bubbles: true,
    composed: true,
    detail: {message, persist},
  }));
}
