// @vitest-environment jsdom
/** The prompt at sign-in for a contributor who hasn't agreed to the terms of use (#739). */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const api = vi.hoisted(() => ({agree: vi.fn()}));
vi.mock('./write-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./write-api.ts')>()),
  agreeToTerms: api.agree,
}));

await import('./terms-prompt.ts');

// jsdom defines HTMLDialogElement but not showModal or close, as feedback-form.test.ts says.
beforeEach(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function (this: HTMLDialogElement) { this.open = true; };
  proto['close'] = function (this: HTMLDialogElement) { this.open = false; };
  api.agree.mockReset();
});
afterEach(() => { document.body.innerHTML = ''; });

const me = {user_id: 'u', contributor: {id: 7, name: 'Someone', picture: null, editor: false, orcid: null, terms_version: 1}};

async function opened() {
  const prompt = document.createElement('terms-prompt');
  document.body.append(prompt);
  await prompt.updateComplete;
  prompt.open();
  await prompt.updateComplete;
  const root = prompt.shadowRoot!;
  return {prompt, root, dialog: root.querySelector('dialog')!, button: (cls: string) => root.querySelector<HTMLButtonElement>(`.${cls}`)!};
}

describe('the terms prompt', () => {
  test('says what agreeing means, and links the terms', async () => {
    const {root, dialog} = await opened();
    expect(dialog.open).toBe(true);
    expect(root.textContent).toMatch(/published under\s+CC BY 4\.0/);
    expect(root.textContent).toMatch(/covers the sightings you've already submitted/);
    expect(root.textContent).toMatch(/stay on the map either way/);
    expect(root.querySelector('a[href="/terms.html"]')).not.toBeNull();
  });

  test('agreeing records it, says who is signed in now, and closes', async () => {
    api.agree.mockResolvedValue(me);
    const {prompt, dialog, button} = await opened();
    const agreed = new Promise<CustomEvent>(resolve => prompt.addEventListener('terms-agreed', e => resolve(e as CustomEvent)));
    button('agree').click();
    expect((await agreed).detail).toEqual(me);
    expect(api.agree).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(false);
  });

  test('"Not now" closes without agreeing', async () => {
    const {dialog, button} = await opened();
    button('later').click();
    expect(dialog.open).toBe(false);
    expect(api.agree).not.toHaveBeenCalled();
  });

  test('a failure says so and stays open, to try again', async () => {
    api.agree.mockRejectedValue(new Error('offline'));
    const {prompt, root, dialog, button} = await opened();
    button('agree').click();
    await vi.waitFor(() => expect(root.querySelector('[role=alert]')).not.toBeNull());
    await prompt.updateComplete;
    expect(dialog.open).toBe(true);
    expect(button('agree').disabled).toBe(false);
  });
});
