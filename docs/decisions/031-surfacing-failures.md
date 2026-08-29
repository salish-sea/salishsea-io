# 031 — Failures reach the user through one toast, and Sentry through the same call

**Status:** accepted · **Decided:** 2026-08-28 · bd `salish-i7v`

## Context

The app had no way of telling anyone that something had failed. Three call sites had each
made their own arrangement, and all three amounted to silence:

- `receiveIdToken` reported sign-in failures to Sentry and rethrew — visible to us, invisible
  to the person clicking a Log in button that appeared to do nothing ([030](030-google-signin-nonce.md)).
- `obs-summary`'s delete handler logged to the console behind a standing
  `TODO: surface to user via a toast/state property`.
- `fetchOccurrences` let a failed query reject into a `console.error`, or in several callers
  into nothing at all. An empty sighting list is indistinguishable from a quiet day on the
  water, so a failed load silently misrepresents the data.

The precipitating case is worth stating plainly, because it is the argument for coupling the
two halves. Decision 030 was a bug that reached *neither* audience: Supabase returns auth
failures in the result rather than throwing, the Supabase Sentry integration only wraps
PostgREST, and the `{error}` was discarded. Nothing was reported and nothing was shown, for
weeks, until someone mentioned in passing that they could not sign in.

## Decision

**One toast, owned by `<salish-sea>`.** [`error-toast.ts`](../../src/error-toast.ts) sits over
the bottom-left of the map — clear of `user-location-control` above it and Sentry's feedback
button opposite — and out of the layout, so nothing reflows when a failure appears. The newest
failure replaces the current one rather than stacking: a pile of toasts over the map is worse
than the latest fact about what is broken.

**One call reports to both audiences.** [`reportError(source, message, {cause, persist})`](../../src/report-error.ts)
captures to Sentry *and* dispatches a `report-error` event that bubbles composed to
`<salish-sea>`. Telling the user and telling ourselves are one action because the failure that
motivated this reached neither, and two calls are two chances to do half the job. Anything in
the tree can call it; nothing in between has to relay it.

**Two lifetimes, one flag.** A failed action clears itself after 8s. A `persist` failure stays
until dismissed, for a condition that is still true after the toast would have gone — sightings
that never loaded is the case that forced the distinction.

![The toast over the map](../images/031-error-toast.png)

![The toast in detail](../images/031-error-toast-detail.png)

| Token | Value | Role |
|---|---|---|
| Surface | `rgb(8, 13, 38)` | The header's navy, so a failure reads as chrome rather than map content |
| Accent | `rgb(229, 115, 115)` | Left rule and ⚠ glyph; the only colour this pattern introduces |
| Anchor | bottom `1rem`, left `1rem` | Clear of `user-location-control` (top-left) and the feedback button (bottom-right) |

## Rejected alternatives

**A status line in the header.** No new layout, no timers, nothing floating over the map.
Rejected on width: the header already carries the lockup, the about link and the Log in button,
and on a phone there is no room left for a sentence worth reading. A message truncated to
"Couldn't s…" is worse than the console.

**A bespoke message at each call site.** What the code was already drifting toward, and what
`sighting-form`'s inline `output.error` still does for validation — correctly, because a field
error belongs beside its field. Rejected for failures of *actions*, which have no natural place
on screen and would have produced three unrelated treatments of the same idea.

**Letting `reportError` do only the user-facing half.** Tidier separation, and it would have
left the Sentry call at each site where someone can forget it. The coupling is the point.

## Consequences

Sentry now hears about the delete and occurrence-load failures it never saw, so expect those
classes to appear for the first time rather than to stay quiet.

The three profile-page entry points (`individual`, `matriline`, `ecotype`) have their own root
components and do not yet listen for `report-error`; a `reportError` call from one of them
reaches Sentry but shows nothing. Nothing calls it there today. Note also `salish-280`: Sentry
init is PROD-gated in `salish-sea.ts` but unconditional on those three pages, so their dev
sessions already report to the production DSN.
