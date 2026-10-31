import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { createRef, ref, type Ref } from 'lit/directives/ref.js';

import { TERMS_PATH } from './terms.ts';
import { agreeToTerms, type Me } from './write-api.ts';

/**
 * Asks a contributor who signed in and hasn't agreed to the terms of use to agree (#739).
 * Once, at sign-in, and dismissable: their sightings stay on the map either way, and
 * only the open data download, and what is shared onward, waits for the agreement. A
 * contributor who says "Not now" is asked again when they next save a new sighting,
 * which needs it, or the next time they sign in.
 *
 * On agreeing, dispatches `terms-agreed` with the API's new answer to who is signed in.
 */
@customElement('terms-prompt')
export class TermsPrompt extends LitElement {
  static styles = css`
    dialog {
      border: none;
      border-radius: 8px;
      box-shadow: var(--shadow-dialog);
      font-family: inherit;
      max-width: min(28rem, calc(100vw - 2rem));
      padding: 1rem;
      width: 100%;
    }
    dialog::backdrop {
      background: var(--color-scrim);
    }
    h2 {
      font-size: var(--fs-body1);
      font-weight: 400;
      margin: 0 0 0.75rem;
    }
    p {
      font-size: var(--fs-body2);
      line-height: 1.4;
      margin: 0 0 0.75rem;
    }
    .failed {
      background: var(--color-error-tint);
      border-left: 4px solid var(--color-error-border);
      border-radius: 4px;
      padding: 0.5rem 0.625rem;
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
      font-size: var(--fs-body2);
      min-height: 44px;
      padding: 0.5rem 0.875rem;
    }
    .agree {
      background: var(--color-chrome);
      border: 1px solid var(--color-chrome);
      color: white;
    }
    .agree:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .later {
      background: white;
      border: 1px solid var(--color-border-strong);
    }
  `;

  @state() private status: 'asking' | 'agreeing' | 'failed' = 'asking';

  #dialogRef: Ref<HTMLDialogElement> = createRef();

  open(): void {
    this.status = 'asking';
    const dialog = this.#dialogRef.value;
    if (dialog && !dialog.open) dialog.showModal();
  }

  private close(): void {
    this.#dialogRef.value?.close();
  }

  private async agree(): Promise<void> {
    this.status = 'agreeing';
    let me: Me;
    try {
      me = await agreeToTerms();
    } catch {
      this.status = 'failed';
      return;
    }
    this.dispatchEvent(new CustomEvent<Me>('terms-agreed', {bubbles: true, composed: true, detail: me}));
    this.close();
  }

  protected render() {
    return html`
      <dialog ${ref(this.#dialogRef)} aria-labelledby="terms-title">
        <h2 id="terms-title">Publishing your sightings</h2>
        <p>
          Sightings submitted to SalishSea.io are published under
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>,
          so researchers and ships can use them, with credit to you. Our
          <a href=${TERMS_PATH} target="_blank" rel="noopener">terms of use</a> say what that means.
        </p>
        <p>Your sightings stay on the map either way. They join the open data download once you agree.</p>
        ${this.status === 'failed'
          ? html`<p class="failed" role="alert">That didn't reach us. Check your connection and try again.</p>`
          : nothing}
        <div class="actions">
          <button class="later" type="button" @click=${this.close}>Not now</button>
          <button class="agree" type="button" ?disabled=${this.status === 'agreeing'} @click=${this.agree}>I agree</button>
        </div>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'terms-prompt': TermsPrompt;
  }
}
