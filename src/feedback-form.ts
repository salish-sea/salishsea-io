import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';
import { supabase } from './supabase.ts';

/** Where an unsent draft waits. One draft; the newest replaces the last. */
const DRAFT_STORAGE_KEY = 'feedback-draft';

export type Draft = {name: string; email: string; message: string};

const EMPTY: Draft = {name: '', email: '', message: ''};

/**
 * How long an unsent draft is kept on the device.
 *
 * It holds a name, an email address and whatever was typed, in cleartext, on a
 * device that may be shared — so it should not sit there forever. Long enough
 * that "I'll finish this when I'm back in signal" works, short enough that a
 * forgotten half-sentence does not outlive anyone's interest in it.
 */
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Read the saved draft, tolerating anything that is not one.
 *
 * localStorage is shared, old versions of this app wrote to it, and a person
 * can edit it — so treat whatever comes back as untrusted and fall back to an
 * empty draft rather than throwing on the way to rendering a form.
 */
export function readDraft(storage: Pick<Storage, 'getItem'>, now: number = Date.now()): Draft {
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return EMPTY;   // Safari in private mode throws rather than returning null.
  }
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    const {name, email, message, savedAt} = parsed as Partial<Draft> & {savedAt?: unknown};
    // Expired, or from a version that did not stamp one: either way, old enough
    // that returning it is a privacy cost with no benefit.
    if (typeof savedAt !== 'number' || now - savedAt > DRAFT_TTL_MS) return EMPTY;
    return {
      name: typeof name === 'string' ? name : '',
      email: typeof email === 'string' ? email : '',
      message: typeof message === 'string' ? message : '',
    };
  } catch {
    return EMPTY;
  }
}

/** Whether a draft holds anything worth restoring. */
export const draftIsEmpty = (draft: Draft): boolean =>
  !draft.name.trim() && !draft.email.trim() && !draft.message.trim();

/**
 * "Report a bug or give feedback" — ours, not Sentry's (decision 039).
 *
 * The widget this replaces was Sentry's, so a report only arrived if the
 * person's browser could reach sentry.io. On 2026-09-08 one could not, twice,
 * on two different networks, and the report died in the form with the text
 * still on screen and nowhere to go. It named three real bugs and reached us
 * only because the reporter screenshotted it. Sentry's ingest hosts are on
 * common tracker blocklists, so any content blocker silences the one channel a
 * contributor has for telling us something is broken.
 *
 * Two things follow, and they are the whole design:
 *
 * **It posts to our own Supabase**, the same host the map is already talking
 * to. If the app works at all, feedback can be sent.
 *
 * **The draft is saved as they type**, so a failed send, a closed tab or a
 * flat battery cannot take the report with it. That is the specific loss that
 * prompted this: the widget kept Scott's paragraph on screen, could not
 * deliver it, and offered him nothing else to do with it.
 */
@customElement('feedback-form')
export default class FeedbackForm extends LitElement {
  static styles = css`
    :host {
      font-family: Mukta, Helvetica, Arial, sans-serif;
    }
    .trigger {
      position: fixed;
      right: 1rem;
      bottom: 1rem;
      z-index: 3;
      background: rgb(8, 13, 38);
      color: white;
      border: none;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8125rem;
      min-height: 44px;
      padding: 0.5rem 0.75rem;
    }
    dialog {
      border: none;
      border-radius: 6px;
      box-shadow: 0 4px 24px rgb(0 0 0 / 0.35);
      font-family: inherit;
      max-width: min(28rem, calc(100vw - 2rem));
      padding: 1rem;
      width: 100%;
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.4);
    }
    h2 {
      font-size: 1rem;
      margin: 0 0 0.75rem;
    }
    label {
      display: block;
      margin-bottom: 0.75rem;
    }
    label > span {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      margin-bottom: 0.25rem;
    }
    label:has([required]) > span::after {
      content: ' *';
      color: #d32f2f;
    }
    input, textarea {
      box-sizing: border-box;
      border: 1px solid var(--slate-300, #cbd5e1);
      border-radius: 4px;
      font-family: inherit;
      font-size: 1rem;
      padding: 0.5rem;
      width: 100%;
    }
    textarea {
      min-height: 7rem;
      resize: vertical;
    }
    .note {
      color: #475569;
      font-size: 0.75rem;
      line-height: 1.4;
      margin: 0 0 0.75rem;
    }
    .failed {
      background: rgb(253, 237, 237);
      border-left: 4px solid rgb(229, 115, 115);
      border-radius: 4px;
      font-size: 0.8125rem;
      line-height: 1.4;
      margin: 0 0 0.75rem;
      padding: 0.5rem 0.625rem;
    }
    .sent {
      font-size: 0.875rem;
      line-height: 1.4;
      margin: 0 0 0.75rem;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }
    .actions button {
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.875rem;
      min-height: 44px;
      padding: 0.5rem 0.875rem;
    }
    .send {
      background: rgb(8, 13, 38);
      border: 1px solid rgb(8, 13, 38);
      color: white;
    }
    .send:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .cancel {
      background: white;
      border: 1px solid var(--slate-300, #cbd5e1);
    }
  `;

  @state() private draft: Draft = EMPTY;
  @state() private status: 'editing' | 'sending' | 'failed' | 'sent' = 'editing';

  #dialogRef: Ref<HTMLDialogElement> = createRef();

  connectedCallback(): void {
    super.connectedCallback();
    this.draft = readDraft(localStorage);
  }

  /**
   * Persist on every keystroke rather than on submit.
   *
   * Saving when they press Send would protect nothing: by then the text has
   * already survived the part that loses it. What actually goes missing is a
   * half-typed report when the tab is closed, the browser reclaims the page,
   * or the phone dies.
   */
  #update(field: keyof Draft, value: string): void {
    this.draft = {...this.draft, [field]: value};
    // A full disk, or Safari's private mode, must not stop someone typing.
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({...this.draft, savedAt: Date.now()}));
    } catch { /* the draft simply is not durable here */ }
    if (this.status === 'failed') this.status = 'editing';
  }

  #clearDraft(): void {
    this.draft = EMPTY;
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch { /* nothing to clear */ }
  }

  open(): void {
    if (this.status === 'sent') this.status = 'editing';
    // showModal() throws InvalidStateError on a dialog that is already open, so
    // a second click on the trigger would otherwise break the one channel a
    // person has for telling us something is wrong.
    const dialog = this.#dialogRef.value;
    if (dialog && !dialog.open) dialog.showModal();
  }

  private close(): void {
    this.#dialogRef.value?.close();
  }

  private async send(): Promise<void> {
    if (!this.canSend) return;
    this.status = 'sending';
    // What we are actually sending. The fields stay editable while the request
    // is in flight, and on a slow connection — the case this whole component is
    // built for — someone will carry on typing.
    const sent = this.draft;
    const {error} = await supabase().rpc('submit_feedback', {
      name: sent.name,
      email: sent.email,
      message: sent.message,
      // Bounded to the column CHECKs. Over them the insert fails, and the only
      // message we could show would be the offline one — telling somebody their
      // connection is bad when in fact their URL is long.
      page_url: location.href.slice(0, 2000),
      user_agent: navigator.userAgent.slice(0, 500),
      release: __RELEASE__.slice(0, 100),
    });

    if (error) {
      // Keep the draft. The report is the valuable thing here, and the whole
      // reason this component exists is that the last one was thrown away.
      this.status = 'failed';
      return;
    }
    if (this.draft !== sent) {
      // They kept writing while that was in flight. What arrived is the older
      // version, so clearing now would delete words never sent — the same loss
      // in a quieter disguise. Keep the newer draft and let them send it.
      this.status = 'editing';
      return;
    }
    this.#clearDraft();
    this.status = 'sent';
  }

  private get canSend(): boolean {
    return this.status !== 'sending'
      && this.draft.name.trim().length > 0
      && this.draft.message.trim().length > 0;
  }

  protected render() {
    return html`
      <button class="trigger" type="button" @click=${this.open}>Report a bug or give feedback</button>
      <dialog ${ref(this.#dialogRef)} aria-labelledby="feedback-title">
        <h2 id="feedback-title">Report a bug or give feedback</h2>
        ${this.status === 'sent' ? this.renderSent() : this.renderForm()}
      </dialog>
    `;
  }

  private renderSent() {
    return html`
      <p class="sent" role="status">Thank you — that reached us. If you left an email address we may write back.</p>
      <div class="actions">
        <button class="send" type="button" @click=${this.close}>Close</button>
      </div>
    `;
  }

  private renderForm() {
    return html`
      ${this.status === 'failed' ? html`
        <p class="failed" role="alert">
          That didn't send — you may be offline. Your words are saved on this device,
          so you can close this and try again later without retyping them.
        </p>
      ` : nothing}
      ${this.status === 'failed' ? nothing : html`
        <p class="note">
          What you type is kept on this device until it sends, so you can finish it later.
        </p>
      `}
      <label>
        <span>Name</span>
        <input required maxlength="200" .value=${this.draft.name} @input=${(e: Event) => this.#update('name', (e.target as HTMLInputElement).value)}>
      </label>
      <label>
        <span>Email</span>
        <input type="email" maxlength="320" .value=${this.draft.email} @input=${(e: Event) => this.#update('email', (e.target as HTMLInputElement).value)}>
      </label>
      <label>
        <span>What happened?</span>
        <textarea required maxlength="5000" .value=${this.draft.message} @input=${(e: Event) => this.#update('message', (e.target as HTMLTextAreaElement).value)}></textarea>
      </label>
      <p class="note">
        We may quote what you write here in our public issue tracker so we can work on it.
        Your name and email address stay private.
      </p>
      <div class="actions">
        <button class="cancel" type="button" @click=${this.close}>Cancel</button>
        <button class="send" type="button" ?disabled=${!this.canSend} @click=${this.send}>
          ${this.status === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'feedback-form': FeedbackForm;
  }
}
