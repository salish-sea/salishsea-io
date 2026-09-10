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
  {cause, persist = false, capture = true}: {
    cause?: unknown;
    persist?: boolean;
    /**
     * Whether Sentry hears about it. Defaults to yes, and the default is the
     * point: the two halves travel together so that neither can be forgotten.
     * Pass `false` only for an outcome that is the feature working — a
     * permission the visitor withheld — never for a failure of ours we would
     * rather not hear about. Decision 031 records the one exception.
     */
    capture?: boolean;
  } = {},
): void {
  // A cause that isn't an Error — a GeolocationPositionError, a plain result
  // object — reaches Sentry as `Error: [object Whatever]` with no stack and
  // nothing to read. Wrap it so the report says what the person saw.
  if (capture)
    captureException(cause instanceof Error ? cause : new Error(message, cause === undefined ? undefined : {cause}));
  source.dispatchEvent(new CustomEvent<ErrorReport>('report-error', {
    bubbles: true,
    composed: true,
    detail: {message, persist},
  }));
}
