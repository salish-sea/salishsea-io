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

let configured: Promise<void> | null = null;

/**
 * Google's reference is explicit that `initialize` is called once per page, and
 * GSI warns at runtime that "only the last initialized instance will be used".
 * Calling it per click would replace the callback and nonce underneath a prompt
 * that is already outstanding — the completed sign-in would then present a
 * token minted against the previous nonce and GoTrue would reject it with
 * "Nonces mismatch", the sibling of the bug this module exists to fix.
 *
 * So one nonce and one callback for the life of the page. That still binds a
 * token to this page's sign-in, which is what the nonce is for.
 */
function configureGoogleSignIn(onCredential: CredentialHandler): Promise<void> {
  configured ??= loadGSI()
    .then(generateNonce)
    .then(nonce => { google.accounts.id.initialize(idConfiguration(nonce, onCredential)); })
    .catch(err => { configured = null; throw err; });
  return configured;
}

/** Show Google's One Tap prompt, configuring GSI on first use. */
export async function promptGoogleSignIn(onCredential: CredentialHandler): Promise<void> {
  await configureGoogleSignIn(onCredential);
  google.accounts.id.prompt();
}
