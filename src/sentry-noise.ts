/**
 * What the Sentry client declines to send, and why (decision 046).
 *
 * Pure predicates over a Sentry event, so the rules are unit-testable without a
 * browser or a transport. `src/sentry.ts` wires them into the client; nothing
 * here does I/O.
 *
 * The problem this solves is not volume — it is that ignoring an issue in the
 * Sentry UI answers a per-issue-group question when the thing we know is a
 * per-error-class fact. An ignored group is still quota, still has to be
 * recognised by whoever opens the list, and stops applying the moment a new
 * release re-fingerprints the same error into a new group.
 *
 * Three mechanisms, because the noise arrives three ways:
 *
 *   1. `DENY_URLS` — the error's own frames point at a scheme that is not the
 *      web page: an in-app browser's injected bridge (`iabjs:`) or a browser
 *      extension. The SDK matches these against the top stack frame's URL.
 *   2. `IGNORE_ERRORS` — the frames were rewritten to blame `salishsea.io`
 *      because the host injected its script INTO our document, so (1) cannot
 *      see it, but the message is unambiguously not ours.
 *   3. `isThirdPartyFrame` in `beforeSend` — the message is too generic to
 *      match on ("Maximum call stack size exceeded"), but a frame names a
 *      function that is provably not in our bundle.
 *
 * Every entry is evidenced by an issue we actually received; none is
 * speculative. Adding one without an observed event is how a filter starts
 * hiding real failures.
 */

/**
 * Schemes that are not our page. An error whose top frame lives here is running
 * in somebody's in-app browser or extension, in our tab but not from our code.
 *
 * `iabjs:` is the Android in-app-browser bridge (SALISHSEA-IO-3E: frames at
 * `iabjs://navigation_performance_logger_android`, four users, still recurring
 * on 2026-09-14). The extension schemes cover SALISHSEA-IO-39, a visitor's
 * extension calling `runtime.sendMessage` at a tab that had gone.
 */
export const DENY_URLS: readonly RegExp[] = [
  /^iabjs:/,
  /^chrome-extension:/,
  /^moz-extension:/,
  /^safari-web-extension:/,
  /^safari-extension:/,
  /^webkit-masked-url:/,
];

/**
 * Messages that identify a third party even when the frames blame us.
 *
 * An in-app browser injects its bridge into the document it is showing, so the
 * script's origin IS `salishsea.io` and {@link DENY_URLS} never sees it. The
 * message is the only thing left that distinguishes it, and these three name
 * host APIs that do not exist in a browser and appear nowhere in our source:
 * `webkit.messageHandlers` is the iOS WKWebView bridge (SALISHSEA-IO-3F),
 * `sendDataToNative` and `sendPageShowMessage` its Android counterparts.
 *
 * `Script error.` is the cross-origin placeholder the browser substitutes when
 * it will not tell a page anything about a script from another origin. It
 * arrives with no message, no frames and no file — SALISHSEA-IO-Q, three users.
 * It is dropped not because it is third-party but because it is *empty*: there
 * is no version of it that anyone could act on.
 */
export const IGNORE_ERRORS: readonly (string | RegExp)[] = [
  /Error invoking postMessage: Java object is gone/,
  /window\.webkit\.messageHandlers/,
  /sendDataToNative/,
  /sendPageShowMessage/,
  /runtime\.sendMessage/,
  /^Script error\.?$/,
];

/**
 * Function names that are provably not ours, for errors whose MESSAGE we must
 * not filter on.
 *
 * `findTopmostVisibleElement` is an in-page translation widget, injected into
 * our document and recursing until the stack gives out (SALISHSEA-IO-36, nine
 * events, fifty identical frames). Its message — "Maximum call stack size
 * exceeded" — is one our own code could legitimately produce, so matching on it
 * would hide a real defect. The frame name cannot: it is not in our bundle, and
 * `src/sentry-noise.test.ts` asserts that.
 */
export const THIRD_PARTY_FRAME_FUNCTIONS: readonly string[] = [
  'findTopmostVisibleElement',
  'sendDataToNative',
  'sendBeforeUnloadMessage',
  'sendPageShowMessage',
];

/** The minimum of Sentry's event shape these predicates read. */
export type NoiseCandidate = {
  readonly exception?: {
    readonly values?: readonly {
      readonly stacktrace?: {
        readonly frames?: readonly { readonly function?: string; readonly filename?: string }[];
      };
    }[];
  };
};

/**
 * Whether any frame names a known third-party function or a denied scheme.
 *
 * Reads EVERY frame rather than the topmost one, deliberately: the SDK's own
 * `denyUrls` looks at the top frame, and an injected script that calls into
 * itself can put one of our frames — or a blank one — on top. This is the
 * backstop for exactly those, so it is the one place that looks all the way
 * down. It reads only `function` and `filename`, never the message.
 */
export function isThirdPartyFrame(event: NoiseCandidate): boolean {
  const frames = event.exception?.values?.flatMap((v) => v.stacktrace?.frames ?? []) ?? [];
  return frames.some((f) =>
    (f.function !== undefined && THIRD_PARTY_FRAME_FUNCTIONS.includes(f.function))
    || (f.filename !== undefined && DENY_URLS.some((re) => re.test(f.filename!))));
}

/**
 * The `beforeSend` hook: drop the event (return null) or send it unchanged.
 *
 * Deliberately NOT a place to drop network failures. `TypeError: Failed to
 * fetch` and `Load failed` against our Supabase host (SALISHSEA-IO-37, -38,
 * -3B: 24 events, 19 users) look like noise one at a time and are the only
 * signal we have that distinguishes a boat losing cell signal from a Supabase
 * outage or a botched CSP deploy. Volume is the whole message, so the client
 * keeps sending them and Sentry keeps them ignored-until-escalating.
 */
export function dropThirdPartyNoise<T extends NoiseCandidate>(event: T): T | null {
  return isThirdPartyFrame(event) ? null : event;
}
