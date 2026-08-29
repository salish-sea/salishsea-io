# 030 — Google sign-in carries a real nonce; GSI is configured in code, not markup

**Status:** accepted · **Decided:** 2026-08-28

## Context

Google sign-in failed in production for at least one contributor with an opaque
`POST /auth/v1/token?grant_type=id_token 400 (Bad Request)`. The GoTrue log names the cause:

```json
{
  "error": "invalid request: Passed nonce and nonce in id_token should either both exist or not.",
  "grant_type": "id_token",
  "status": 400,
  "time": "2026-08-28T21:52:05Z"
}
```

The app never sent a nonce. `signInWithIdToken({provider, token})` passed no `nonce`, and
`index.html`'s `g_id_onload` div carried no `data-nonce`. Google Identity Services, however,
supplies its own nonce in some flows, and the resulting id_token then carries a `nonce` claim
the request cannot match. GoTrue requires both-or-neither
([`token_oidc.go`](https://github.com/supabase/auth/blob/master/internal/api/token_oidc.go)),
and this project has `external_google_skip_nonce_check: false`. So the failure is not
account-specific and has nothing to do with being a new user — it depends on which flow
Google chooses for that browser, which is why it broke for some people and not others.

Two things kept it invisible for as long as it lasted:

- **Supabase reports auth failures in the result, not by throwing.** `receiveIdToken`
  discarded the `{error}` half. Nothing threw, so nothing reached the global handler.
- **The Supabase Sentry integration only wraps PostgREST.** `@supabase/sentry-js-integration`
  instruments `PostgrestQueryBuilder` and `PostgrestFilterBuilder` — `supabase.auth.*` is not
  covered. Even an uncaught auth error would not have been attributed to Supabase.

The visible symptom was therefore a Log in button that did nothing at all.

## Decision

**Generate a nonce per sign-in attempt and give each side the form it expects.** GoTrue
compares `sha256(params.Nonce)` as lowercase hex against the id_token's `nonce` claim, so
Google receives the hex digest and Supabase receives the raw string. Both come from one
`generateNonce()` call in [`src/google-nonce.ts`](../../src/google-nonce.ts), so they cannot
drift.

**Configure GSI imperatively in `doLogIn()`, not declaratively in `index.html`.** A nonce must
be fresh per attempt and its raw form must survive into the callback; neither is expressible
in static markup. `google.accounts.id.initialize({client_id, nonce, callback, …})` now holds
the whole configuration, and the client ID lives in `salish-sea.ts` as its only copy.

**Check the `{error}` from `signInWithIdToken`** — report it to Sentry explicitly and rethrow.
Auth is outside the Supabase integration's reach, so this call site has to report itself.

Three things fell away as a consequence, which is the real prize:

- the `g_id_onload` div, whose attributes were a second, drifting copy of the config;
- the inline `gsi-init` shim and its `window.__pendingGSIResponses` queue, which existed only
  because a declarative callback can fire before the Lit element upgrades — GSI is now
  configured by a click on that very element, so the race cannot occur;
- the `'sha256-…'` inline-script hash in the CSP and `bin/verify-csp-inline-hash.mjs`, the
  build step that guarded it. With no inline script, `script-src` is strictly tighter.

## Rejected alternatives

**Set `external_google_skip_nonce_check: true`.** One config toggle, no deploy, and it would
have worked. Rejected because the nonce is the replay defence for an OIDC id_token: it binds
the token to the attempt that asked for it. Turning the check off to fix a bug caused by not
implementing it trades a real security property for a few lines of code, permanently and
invisibly. It also leaves the project unable to tell a replay from a mistake later.

**Echo the id_token's own nonce claim back to Supabase.** Decode the token, read `nonce`,
pass it through. This makes the error go away and is worse than skipping the check, because
it looks like verification while proving only that we can read a value we were just handed.

**Put a `data-nonce` on the existing div.** Static markup yields one nonce for the life of the
page, and the digest cannot be computed there anyway (`crypto.subtle` is async). This is what
forced the move to imperative configuration rather than a smaller edit.

## Consequences

Auth failures now surface in Sentry, which they never did before — expect this issue class to
appear there for the first time rather than to stay silent. The user still sees nothing when
sign-in fails; a shared way to surface errors is tracked separately, alongside the existing
`TODO` in [`src/obs-summary.ts`](../../src/obs-summary.ts).
