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
and this project's production auth config reports `external_google_skip_nonce_check: false`
(read from the Management API — `supabase/config.toml` sets no such key for Google, and GoTrue
defaults it to false). So the failure is not
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

**Configure GSI imperatively, not declaratively in `index.html`.** The digest cannot be
computed in markup (`crypto.subtle` is async) and the raw half must survive into the callback.
[`src/google-signin.ts`](../../src/google-signin.ts) now owns the whole configuration and the
client ID, as its only copy.

**Retire the nonce when a credential is delivered against it — not per click, and not per
page.** Two constraints pull opposite ways and both are real.

`initialize` must not run while a prompt is outstanding: GSI warns that "only the last
initialized instance will be used", so a second click would swap the nonce underneath the
prompt already on screen, and the completed sign-in would present a token minted against the
previous nonce — GoTrue's *other* rejection, "Nonces mismatch", the same silent 400 in a new
costume. But a nonce must not cover two sign-ins either: GoTrue never consumes it, it only
compares `sha256(nonce)` to the claim, so a nonce held for the life of the page stops being a
once-only value.

Both hold if the nonce is retired exactly when a credential arrives. Repeat clicks before then
re-prompt against the configured nonce; the next attempt after a delivery mints a fresh one, at
a moment when no prompt can be outstanding because the credential just resolved it. Verified in
the built app — three rapid clicks yield three credential requests carrying one nonce and no GSI
warning — and pinned by tests that fail if either half is removed.

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

Two nonce lifecycles were tried and abandoned during review of the change itself. Both look
like simplifications of what shipped, so they are recorded here rather than left to be
rediscovered by whoever next reads `google-signin.ts` and finds the retirement logic fussy.

**A fresh nonce per click, reconfiguring GSI each time.** The obvious reading of "once only",
and wrong. Google's reference says `initialize` is called once and GSI warns at runtime that
"only the last initialized instance will be used": a second click swaps the nonce underneath
the prompt already on screen, so completing that prompt presents a token minted against the
previous nonce and GoTrue answers "Nonces mismatch". Two components dispatch `log-in`
([`login-button.ts`](../../src/login-button.ts), [`obs-panel.ts`](../../src/obs-panel.ts)) and
One Tap appears in a screen corner, which is precisely the shape that invites a second click.

**One nonce for the life of the page, configuring GSI once.** Fixes the above and fails the
other way. GoTrue never consumes a nonce — it only compares `sha256(nonce)` to the claim — so
nothing retires a page-lifetime value, and one nonce ends up covering every sign-in on that
page. A nonce that can be presented twice is not a nonce.

## Consequences

Auth failures now surface in Sentry, which they never did before — expect this issue class to
appear there for the first time rather than to stay silent. The user still sees nothing when
sign-in fails; a shared way to surface errors is tracked separately, alongside the existing
`TODO` in [`src/obs-summary.ts`](../../src/obs-summary.ts).
