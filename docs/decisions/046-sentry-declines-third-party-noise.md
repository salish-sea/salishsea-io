# 046 — The Sentry client declines third-party noise, and keeps every network failure

**Status:** accepted · **Decided:** 2026-09-18 · **Extends:** [037](037-sentry-transmits-from-production-only.md) · **Answers:** `salish-leg`

## Decision

**The browser client declines to send errors it can already tell are not about us, and keeps sending the ones that look like noise but are signal.** The rules live in [src/sentry-noise.ts](../../src/sentry-noise.ts) as pure predicates with tests; [src/sentry.ts](../../src/sentry.ts) wires them in.

Dropped: an in-app browser's injected bridge, a browser extension's messages, an injected translation widget, and the empty cross-origin `Script error.` placeholder.

**Kept, deliberately: `TypeError: Failed to fetch` and `Load failed` against our Supabase host.**

## Why not just ignore them in Sentry

[037](037-sentry-transmits-from-production-only.md) already argues the general point in its rejected alternatives: an ignored event still costs quota and still has to be recognised by whoever opens the list. There is a sharper version.

**Ignoring is a per-issue-group answer to a per-error-class fact.** SALISHSEA-IO-37, -38 and -3B are three groups for one failure. Each ignore covers one fingerprint, and a release that changes a minified frame mints a new one — so the same error returns as new, unignored, and someone recognises it again. What we know ("an in-app browser's bridge is not our code") is a fact about a *class*, and the client is where a class-level rule can be stated once.

## What is dropped, and the evidence for each

Every rule is anchored to an issue we actually received. Counts are the 90 days to 2026-09-18.

| issue | error | events / users | mechanism |
|---|---|---:|---|
| [SALISHSEA-IO-3E](https://beam-reach.sentry.io/issues/SALISHSEA-IO-3E) | `Error invoking postMessage: Java object is gone` | 4 / 4 | `denyUrls` on `iabjs:` |
| [SALISHSEA-IO-39](https://beam-reach.sentry.io/issues/SALISHSEA-IO-39) | `Invalid call to runtime.sendMessage(). Tab not found.` | 1 / 1 | extension schemes |
| [SALISHSEA-IO-3F](https://beam-reach.sentry.io/issues/SALISHSEA-IO-3F) | `undefined is not an object (evaluating 'window.webkit.messageHandlers')` | 1 / 1 | `ignoreErrors` |
| [SALISHSEA-IO-Q](https://beam-reach.sentry.io/issues/SALISHSEA-IO-Q) | `Script error.` | 3 / 3 | `ignoreErrors` |
| [SALISHSEA-IO-36](https://beam-reach.sentry.io/issues/SALISHSEA-IO-36) | `RangeError: Maximum call stack size exceeded.` | 9 / 2 | `beforeSend`, by frame name |

SALISHSEA-IO-3E is the worked example. Its frames are:

```
iabjs://navigation_performance_logger_android:1:18129
iabjs://navigation_performance_logger_android:1:13577 (sendBeforeUnloadMessage)
iabjs://navigation_performance_logger_android:1:10025 (sendDataToNative)
```

Someone in Seattle opened a link to salishsea.io inside an Android app. The app's own performance logger tried to talk to its native host after the page had gone, failed, and the browser reported it against whatever page was on screen — ours. Nothing in that stack is ours and nothing about it is actionable by us.

## Three mechanisms, because the noise arrives three ways

- **`denyUrls`** matches the top frame's URL. It works when the third party has its own scheme, as `iabjs:` and the extension schemes do.
- **`ignoreErrors`** matches the message. It is necessary because an in-app browser injects its bridge *into our document*, so the script's origin is `salishsea.io` and `denyUrls` never sees it. The message is then the only distinguishing thing left, and `window.webkit.messageHandlers`, `sendDataToNative` and `sendPageShowMessage` name host APIs that do not exist in a browser and appear nowhere in our source.
- **`beforeSend`** matches a frame's *function name*. SALISHSEA-IO-36 needs it: `findTopmostVisibleElement` is an injected translation widget recursing through fifty identical frames, filed against `https://salishsea.io/:188` because it is inline in our document — but its message, "Maximum call stack size exceeded", is one our own code could genuinely produce. Matching that message would hide a real defect. Matching the function name cannot, and [src/sentry-noise.test.ts](../../src/sentry-noise.test.ts) asserts that none of the filtered names appears anywhere in our source, so the claim stays true rather than being trusted.

`beforeSend` also reads *every* frame rather than the topmost, which is the one thing `denyUrls` cannot do: an injected script that calls into itself can put one of our frames on top.

## `Script error.` is dropped for being empty, not for being foreign

It is the placeholder a browser substitutes when it will not tell a page anything about a script from another origin: no message, no frames, no file. It is dropped because there is no version of it anyone could act on — not because we have decided whose it is.

## What is deliberately kept

`TypeError: Failed to fetch` and `Load failed` against `grztmjpzamcxlzecmqca.supabase.co` — SALISHSEA-IO-37, -38 and -3B, 24 events across 19 users, still arriving. One at a time these are indistinguishable from noise: a visitor on a boat loses signal and the request dies. **In volume they are the only warning we would get of a Supabase outage, a botched CSP deploy, or a DNS failure.** A client-side filter throws that away permanently and silently, so they keep arriving and stay ignored-until-escalating in Sentry, where volume is exactly what escalation measures. `src/sentry-noise.test.ts` asserts that no rule in this file matches any of those three messages, or the statement-timeout one.

This is the line the record draws: **filter on provenance, never on plausibility.** "This came from an Android in-app browser" is a fact about the event. "This is probably just someone's bad connection" is a guess about the world, and the one time it is wrong is the time it mattered.

## The trap in the implementation

`denyUrls` and `ignoreErrors` are not client behaviour. They are implemented by `eventFiltersIntegration`, which ships in Sentry's *default* integrations — and passing an explicit `integrations` array, as this client does, **replaces the defaults rather than extending them**. Set the two options without that integration and they are accepted, type-checked, present in the options object, and completely inert, with no warning anywhere.

So `eventFiltersIntegration()` is now in the array, and [src/sentry-wiring.test.ts](../../src/sentry-wiring.test.ts) fails if it is removed — verified by removing it.

## Consequences

- **Adding a rule requires an observed event.** A speculative filter is how this file would start hiding real failures, and the tests are written so each entry points at the issue that justifies it.
- **The volume is small and that is not the point.** Nine events across five classes in 90 days. What this buys is that none of them, nor their successors under the next release's fingerprints, needs recognising again.
- **`SALISHSEA-IO-3J` is untouched.** `write EBADF` comes from the ingest edge function, which is Deno on the server; a browser-client filter cannot see it and should not try.
- The ignore-forever / ignore-until-escalating distinction in Sentry still matters for everything else — see the [triage notes](037-sentry-transmits-from-production-only.md).

## Rejected

- **Filter the network failures too.** The tempting one, and the largest single group. Rejected above: volume is the message.
- **Match `RangeError: Maximum call stack size exceeded` in `ignoreErrors`.** Simpler than a frame-name rule and it would hide our own infinite recursion, which is a defect we would very much want to hear about.
- **`allowUrls: [salishsea.io]`.** Looks like it subsumes all of this and does not: the two in-app-browser cases and the translation widget are all *injected into our document*, so they pass an origin allowlist. It would also silently drop anything we ever serve from another host.
- **Leave it to the Sentry UI.** See above; the fingerprint problem makes it a recurring cost rather than a one-time one.

## Reference

Rules and their tests: [src/sentry-noise.ts](../../src/sentry-noise.ts), [src/sentry-noise.test.ts](../../src/sentry-noise.test.ts). Wiring and its guard: [src/sentry.ts](../../src/sentry.ts), [src/sentry-wiring.test.ts](../../src/sentry-wiring.test.ts). The production gate and the entry-point agreement stay in [src/sentry.test.ts](../../src/sentry.test.ts). Why Sentry only transmits from production: [037](037-sentry-transmits-from-production-only.md). The one noise class that was our own call site, fixed rather than filtered: `salish-ogb`.
