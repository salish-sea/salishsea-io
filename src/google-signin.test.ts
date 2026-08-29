import { describe, expect, it, vi } from 'vitest';
import { createGoogleSignIn, idConfiguration } from './google-signin.ts';
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

describe('createGoogleSignIn', () => {
  const fakeGsi = () => {
    const initialize = vi.fn();
    const prompt = vi.fn();
    return {initialize, prompt, api: () => ({initialize, prompt})};
  };
  const configOf = (initialize: ReturnType<typeof vi.fn>, call: number) => {
    const args = initialize.mock.calls[call];
    if (!args) throw new Error(`initialize was not called ${call + 1} time(s)`);
    return args[0] as google.accounts.id.IdConfiguration;
  };

  it('configures GSI once while a prompt is outstanding, however many clicks', async () => {
    const {initialize, prompt, api} = fakeGsi();
    const promptSignIn = createGoogleSignIn(api);

    await promptSignIn(vi.fn());
    await promptSignIn(vi.fn());
    await promptSignIn(vi.fn());

    // Re-initializing under an open prompt would swap the nonce out from under it.
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(3);
  });

  it('retires the nonce once a credential is delivered against it', async () => {
    const {initialize, api} = fakeGsi();
    const promptSignIn = createGoogleSignIn(api);
    const onCredential = vi.fn();

    await promptSignIn(onCredential);
    const first = configOf(initialize, 0);
    first.callback!({credential: 'token-one'} as google.accounts.id.CredentialResponse);
    expect(onCredential).toHaveBeenCalledWith('token-one', expect.any(String));

    await promptSignIn(onCredential);
    expect(initialize).toHaveBeenCalledTimes(2);
    const second = configOf(initialize, 1);

    // A nonce GoTrue has already been asked to accept must never cover a second sign-in.
    expect(second.nonce).not.toBe(first.nonce);
  });

  it('recovers if minting the nonce fails, rather than wedging sign-in', async () => {
    const {initialize, api} = fakeGsi();
    let attempt = 0;
    const mintNonce = vi.fn(async () => {
      if (attempt++ === 0) throw new Error('no entropy');
      return generateNonce();
    });
    const promptSignIn = createGoogleSignIn(api, mintNonce);

    await expect(promptSignIn(vi.fn())).rejects.toThrow('no entropy');
    await promptSignIn(vi.fn());
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});
