/**
 * Google Identity Services and Supabase disagree about which form of the nonce
 * each one wants, and getting it wrong is silent: GoTrue rejects the grant with
 * "Passed nonce and nonce in id_token should either both exist or not."
 *
 * Google is handed the SHA-256 hex digest and echoes *that* into the id_token's
 * `nonce` claim. Supabase is handed the raw string and hashes it the same way
 * before comparing. So the two calls take different strings derived from one
 * secret, and both must come from the same attempt.
 */
export interface Nonce {
  /** Sent to Supabase as `signInWithIdToken({nonce})`. */
  readonly raw: string;
  /** Sent to Google as `id.initialize({nonce})`; appears in the id_token. */
  readonly hashed: string;
}

export async function generateNonce(): Promise<Nonce> {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  return {raw, hashed: await sha256Hex(raw)};
}

/** The digest form GoTrue compares against — lowercase hex, not base64. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
