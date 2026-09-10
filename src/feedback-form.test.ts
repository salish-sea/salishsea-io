// @vitest-environment jsdom
/**
 * The feedback channel (bd salish-5of, decision 039).
 *
 * Two properties matter more than anything else this component does, and both
 * are about what happens when sending fails — because that is the case that
 * lost the report which prompted the whole change:
 *
 *   1. a draft survives a failed send, and a closed tab;
 *   2. nothing that reaches the network is Sentry's.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const rpc = vi.hoisted(() => ({
  calls: [] as {fn: string; args: Record<string, unknown>}[],
  error: null as unknown,
}));

vi.mock('./supabase.ts', () => ({
  supabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpc.calls.push({fn, args});
      return {data: null, error: rpc.error};
    },
  }),
}));

const { readDraft, draftIsEmpty } = await import('./feedback-form.ts');
type Form = HTMLElement & {
  open(): void;
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot;
};

const DRAFT_KEY = 'feedback-draft';

const typeInto = async (el: Form, selector: string, value: string) => {
  const field = el.shadowRoot.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  field.value = value;
  field.dispatchEvent(new Event('input'));
  await el.updateComplete;
};
const send = async (el: Form) => {
  (el.shadowRoot.querySelector('.send') as HTMLButtonElement).click();
  await el.updateComplete;
  await Promise.resolve();
  await el.updateComplete;
};

// jsdom 29 defines HTMLDialogElement but not showModal/close. Every browser
// that matters has had them since March 2022 (Chrome 37, Edge 79, Firefox 98,
// Safari 15.4), so this gap is the test environment's and belongs here rather
// than as a fallback branch in the component.
beforeEach(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function (this: HTMLDialogElement) { this.open = true; };
  proto['close'] = function (this: HTMLDialogElement) { this.open = false; };
});

let el: Form;
beforeEach(async () => {
  rpc.calls = [];
  rpc.error = null;
  localStorage.clear();
  el = document.createElement('feedback-form') as unknown as Form;
  document.body.appendChild(el);
  await el.updateComplete;
});

afterEach(() => {
  document.body.querySelectorAll('feedback-form').forEach((node) => node.remove());
});

describe('readDraft', () => {
  test('an absent draft is empty, not a crash', () => {
    expect(draftIsEmpty(readDraft({getItem: () => null}))).toBe(true);
  });

  test('a storage that throws is empty, not a crash', () => {
    // Safari in private mode. A person cannot be stopped from typing because
    // we could not read a draft that was never there.
    expect(draftIsEmpty(readDraft({getItem: () => { throw new Error('denied'); }}))).toBe(true);
  });

  test('junk in localStorage is empty, not a crash', () => {
    expect(draftIsEmpty(readDraft({getItem: () => 'not json'}))).toBe(true);
    expect(draftIsEmpty(readDraft({getItem: () => '"a string"'}))).toBe(true);
    expect(draftIsEmpty(readDraft({getItem: () => 'null'}))).toBe(true);
    expect(readDraft({getItem: () => '{"message": 42}'}).message).toBe('');
  });

  test('a partial draft keeps what it has', () => {
    expect(readDraft({getItem: () => '{"message":"half a thought"}'}))
      .toEqual({name: '', email: '', message: 'half a thought'});
  });
});

describe('a draft in progress', () => {
  test('is saved on every keystroke, not on send', async () => {
    el.open();
    await typeInto(el, 'textarea', 'Trouble uploading pix');

    // What is lost is a half-typed report when the tab closes — by the time
    // someone presses Send the text has already survived the risky part.
    expect(readDraft(localStorage).message).toBe('Trouble uploading pix');
    expect(rpc.calls).toEqual([]);
  });

  test('comes back when the form is opened again', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({name: 'Scott', email: '', message: 'half a thought'}));
    const reopened = document.createElement('feedback-form') as unknown as Form;
    document.body.appendChild(reopened);
    await reopened.updateComplete;
    reopened.open();
    await reopened.updateComplete;

    expect((reopened.shadowRoot.querySelector('textarea') as HTMLTextAreaElement).value).toBe('half a thought');
    expect((reopened.shadowRoot.querySelector('input') as HTMLInputElement).value).toBe('Scott');
  });
});

describe('sending', () => {
  test('goes to our own Supabase, and carries context nobody could be asked for', async () => {
    el.open();
    await typeInto(el, 'input', 'Scott');
    await typeInto(el, 'textarea', 'Trouble uploading pix');
    await send(el);

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0]!.fn).toBe('submit_feedback');
    expect(rpc.calls[0]!.args).toMatchObject({name: 'Scott', message: 'Trouble uploading pix'});
    // The 2026-09-08 report was iOS-Safari-specific and we could not tell.
    expect(rpc.calls[0]!.args['user_agent']).toBe(navigator.userAgent);
    expect(rpc.calls[0]!.args['page_url']).toBe(location.href);
  });

  test('clears the draft once it has actually arrived', async () => {
    el.open();
    await typeInto(el, 'input', 'Scott');
    await typeInto(el, 'textarea', 'Trouble uploading pix');
    await send(el);

    expect(draftIsEmpty(readDraft(localStorage))).toBe(true);
    expect(el.shadowRoot.textContent).toContain('that reached us');
  });

  test('KEEPS the draft when the send fails, and says the words are safe', async () => {
    // The whole reason this component exists. Sentry's widget could not
    // deliver Scott's paragraph and offered him nothing else to do with it.
    rpc.error = {message: 'Failed to fetch'};
    el.open();
    await typeInto(el, 'input', 'Scott');
    await typeInto(el, 'textarea', 'Trouble uploading pix');
    await send(el);

    expect(readDraft(localStorage).message).toBe('Trouble uploading pix');
    expect(el.shadowRoot.querySelector('.failed')?.textContent).toContain('saved on this device');
    // Still on screen and still editable — a retry costs nothing.
    expect((el.shadowRoot.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Trouble uploading pix');
  });

  test('a retry after a failure succeeds and clears the draft', async () => {
    rpc.error = {message: 'Failed to fetch'};
    el.open();
    await typeInto(el, 'input', 'Scott');
    await typeInto(el, 'textarea', 'Trouble uploading pix');
    await send(el);

    rpc.error = null;
    await send(el);

    expect(rpc.calls).toHaveLength(2);
    expect(draftIsEmpty(readDraft(localStorage))).toBe(true);
  });

  test('refuses to send an empty report', async () => {
    el.open();
    await typeInto(el, 'input', 'Scott');
    expect((el.shadowRoot.querySelector('.send') as HTMLButtonElement).disabled).toBe(true);

    await typeInto(el, 'textarea', '   ');
    expect((el.shadowRoot.querySelector('.send') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('telling people where their words go', () => {
  test('says the message may be quoted publicly and contact details are not', async () => {
    el.open();
    await el.updateComplete;
    const note = el.shadowRoot.querySelector('.note')!.textContent!;

    // The notifier quotes the message into a GitHub issue on a public repo.
    // Saying so is part of being allowed to do it.
    expect(note).toContain('public issue tracker');
    expect(note).toContain('stay private');
  });
});
