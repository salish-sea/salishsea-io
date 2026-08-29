/// <reference types="google.accounts" />
import { generateNonce, type Nonce } from './google-nonce.ts';

// Public identifier, and deliberately the only copy: it used to also live in
// index.html's `g_id_onload` attributes, which is what let the declarative
// config and the code drift apart.
const GOOGLE_CLIENT_ID = '129212631591-b6ba75aevcbifjpea2cap2vja91a6te8.apps.googleusercontent.com';

/** Receives a Google id_token together with the raw nonce that token was minted against. */
export type CredentialHandler = (token: string, nonce: string) => void;

/**
 * The exact object handed to `google.accounts.id.initialize`. Split out so a
 * test can pin the half that broke production: Google is given the *hashed*
 * nonce, and the callback forwards the *raw* one. Swapping them is invisible
 * to the type checker and fails only against live GoTrue.
 */
export function idConfiguration(nonce: Nonce, onCredential: CredentialHandler): google.accounts.id.IdConfiguration {
  return {
    client_id: GOOGLE_CLIENT_ID,
    context: 'use',
    ux_mode: 'popup',
    auto_select: false,
    nonce: nonce.hashed,
    callback: ({credential}) => onCredential(credential, nonce.raw),
  };
}

let gsiReady: Promise<void> | null = null;
function loadGSI(): Promise<void> {
  gsiReady ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => resolve();
    // Ad blockers block this script routinely. Without an onerror the promise
    // never settles and, being cached, poisons every later attempt silently.
    script.onerror = () => {
      gsiReady = null;
      reject(new Error('Could not load Google Identity Services'));
    };
    document.head.appendChild(script);
  });
  return gsiReady;
}

/** The slice of `google.accounts.id` this module drives; narrowed so tests can fake it. */
export interface GsiApi {
  initialize(config: google.accounts.id.IdConfiguration): void;
  prompt(): void;
}

/**
 * Two constraints pull in opposite directions, and both are real.
 *
 * `initialize` must not be called while a prompt is outstanding: GSI warns that
 * "only the last initialized instance will be used", so a second click would
 * swap the nonce underneath the prompt already on screen, and the completed
 * sign-in would present a token minted against the previous nonce — GoTrue's
 * "Nonces mismatch", the sibling of the bug this module exists to fix.
 *
 * But a nonce must not cover two sign-ins either. GoTrue does not consume it;
 * it only compares sha256(nonce) to the claim. A nonce left live for the life
 * of the page is a nonce that stops being a once-only value.
 *
 * Both hold if the nonce is retired exactly when a credential is delivered
 * against it. Repeat clicks before then reuse the configured nonce and merely
 * re-prompt; the next attempt after a delivery mints a fresh one, at a moment
 * when no prompt can be outstanding because the credential just resolved it.
 */
export function createGoogleSignIn(gsi: () => GsiApi, mintNonce: () => Promise<Nonce> = generateNonce) {
  // Non-null while a nonce is configured and has not yet had a credential delivered against it.
  let session: Promise<void> | null = null;

  return async function promptSignIn(onCredential: CredentialHandler): Promise<void> {
    session ??= (async () => {
      const nonce = await mintNonce();
      gsi().initialize(idConfiguration(nonce, (token, raw) => {
        session = null;
        onCredential(token, raw);
      }));
    })().catch(err => { session = null; throw err; });
    await session;
    gsi().prompt();
  };
}

const promptSignIn = createGoogleSignIn(() => google.accounts.id);

/** Show Google's One Tap prompt, configuring GSI on first use. */
export async function promptGoogleSignIn(onCredential: CredentialHandler): Promise<void> {
  await loadGSI();
  await promptSignIn(onCredential);
}
