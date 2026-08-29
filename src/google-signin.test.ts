import { describe, expect, it, vi } from 'vitest';
import { idConfiguration } from './google-signin.ts';
import { generateNonce, sha256Hex } from './google-nonce.ts';

describe('idConfiguration', () => {
  it('gives Google the hashed nonce and the callback the raw one', async () => {
    const nonce = await generateNonce();
    const onCredential = vi.fn();
    const config = idConfiguration(nonce, onCredential);

    // The half that broke production. GoTrue compares sha256hex(what we send it)
    // against the claim Google echoes, so these two must not be interchangeable.
    expect(config.nonce).toBe(nonce.hashed);
    expect(config.nonce).toBe(await sha256Hex(nonce.raw));
    expect(config.nonce).not.toBe(nonce.raw);

    config.callback!({credential: 'an-id-token'} as google.accounts.id.CredentialResponse);
    expect(onCredential).toHaveBeenCalledWith('an-id-token', nonce.raw);
  });

  it('identifies this app to Google and never auto-selects', async () => {
    const config = idConfiguration(await generateNonce(), vi.fn());
    expect(config.client_id).toBe('129212631591-b6ba75aevcbifjpea2cap2vja91a6te8.apps.googleusercontent.com');
    // Parity with the `data-auto_prompt="false"` the g_id_onload div used to carry:
    // One Tap appears because doLogIn asked for it, never on its own.
    expect(config.auto_select).toBe(false);
  });
});
