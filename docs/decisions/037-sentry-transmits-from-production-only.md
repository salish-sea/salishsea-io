# 037 — Sentry transmits from production only, and one function decides it

**Status:** accepted · **Decided:** 2026-08-31 · bd `salish-280`

## Context

The app has four entry points, and each initialised Sentry for itself. `salish-sea.ts` guarded
`sentryClient.init()` with `import.meta.env.PROD`; `individual-page.ts`, `matriline-page.ts`
and `ecotype-page.ts` called it unconditionally. So a development session on a profile page
reported to the production DSN, tagged `environment: development`. Four places to get one rule
right, and three had it wrong — which is the ordinary outcome of a rule that lives at its call
sites.

The guard did less than it appeared to even where it was present. `getCurrentScope().setClient()`
ran at import on every entry point, and *binding* the client to the scope is what makes
`captureException` transmit. `init()` only installs integrations. A direct `captureException`
therefore sent from development whether or not `init()` had run — and
[031](031-surfacing-failures.md) had just put a `captureException` behind every user-visible
failure, so that traffic was about to grow from a handful of call sites to all of them.

## Decision

**Development sends nothing.** A development session's errors are already in the console in
front of the person who caused them, and the ones a developer causes deliberately — a
half-saved file, a deliberately broken query, an auth flow poked at until it breaks — would
spend quota and raise alerts to be sorted out afterwards. Sentry's value is hearing about
failures nobody is watching; in development someone is watching by definition.

**The gate sits on the binding, not on `init()`.** This is what the previous arrangement got
wrong, and it is the half that matters: withholding the integrations while leaving the client
bound withholds nothing that transmits.

**One function, called the same way everywhere.** [`initSentry()`](../../src/sentry.ts) binds
the client and installs the integrations, or does neither. Every entry point calls it and
nothing else, and `sentryClient` is no longer exported, so a page cannot initialise Sentry
another way even by accident. A page that forgets the call gets no Sentry, which is the
failure worth having; the old shape's failure was the other one.

`about.ts` is a fifth entry point. It reports nothing today and is not required to — it is
progressive enhancement over static HTML — so it does not call `initSentry()`, and the test
below records that as deliberate rather than missed.

## Rejected alternatives

**Keep sending and filter on the `environment` tag.** Sentry already receives the tag, and its
UI can hide `development`. Rejected because filtering is not the same as not sending: the
events still count against quota, still fire alert rules until someone writes per-environment
ones, and still have to be recognised as noise by whoever opens the issue list. The tag makes
development traffic *sortable*; it does not make it *free*.

**Gate `init()` in all four places, consistently.** The smallest possible change, and it would
have made the four agree. Rejected on both halves: it leaves the rule at four call sites where
a fifth page can still miss it, and it gates the thing that does not transmit.

## Consequences

Profile pages no longer show the Sentry feedback button in development. `salish-sea` never did,
so this is the three pages joining it rather than a capability lost.

Sentry issue counts from before 2026-08-31 on the profile pages include development traffic.
Anything being compared across that date should be read with that in mind.

A source-level test asserts that every entry point using `sentry.ts` goes through
`initSentry()` and that none gates Sentry itself. It reads the entry points out of the `.html`
files rather than a hardcoded list, so a page added later is covered on the day it is added.

Reversing this decision is one line — delete the guard inside `initSentry()` — and the four
entry points still agree, because agreement is now structural rather than a convention four
files have to keep.
