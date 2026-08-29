import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

/** How long a failed action stays on screen before clearing itself. */
export const DISMISS_AFTER_MS = 8_000;

/**
 * The app's one way of telling someone that something failed. It sits over the
 * bottom-left of the map: clear of `user-location-control` (top-left) and of
 * Sentry's feedback button (bottom-right), and out of the layout, so nothing
 * reflows when a failure appears.
 */
@customElement('error-toast')
export default class ErrorToast extends LitElement {
  static styles = css`
    :host {
      bottom: 1rem;
      left: 1rem;
      pointer-events: none;
      position: absolute;
      z-index: 2;
    }
    .toast {
      align-items: start;
      background: rgb(8, 13, 38);
      border-left: 4px solid rgb(229, 115, 115);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
      color: white;
      display: flex;
      font-family: Mukta, Helvetica, Arial, sans-serif;
      font-size: 0.875rem;
      gap: 0.5rem;
      max-width: min(24rem, calc(100vw - 2rem));
      padding: 0.625rem 0.75rem;
      pointer-events: auto;
    }
    .icon {
      color: rgb(229, 115, 115);
      flex-shrink: 0;
      line-height: 1.4;
    }
    p {
      margin: 0;
      line-height: 1.4;
    }
    button {
      background: none;
      border: 0;
      color: inherit;
      cursor: pointer;
      flex-shrink: 0;
      font-size: 1rem;
      line-height: 1.4;
      opacity: 0.7;
      padding: 0;
    }
    button:hover {
      opacity: 1;
    }
  `;

  @state()
  private message: string | null = null;

  #timer?: ReturnType<typeof setTimeout>;

  /**
   * Show a failure. The newest one replaces the current one rather than
   * stacking — a pile of toasts over the map is worse than the latest fact
   * about what is broken.
   *
   * `persist` is for a condition that is still true after the toast would have
   * gone (sightings that never loaded), as opposed to an action that failed
   * once (a sign-in, a delete).
   */
  show(message: string, {persist = false}: {persist?: boolean} = {}) {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.message = message;
    if (!persist)
      this.#timer = setTimeout(() => this.dismiss(), DISMISS_AFTER_MS);
  }

  dismiss = () => {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.message = null;
  };

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.#timer);
  }

  protected render() {
    if (!this.message) return nothing;
    return html`
      <div class="toast" role="status" aria-live="polite">
        <span class="icon" aria-hidden="true">&#9888;</span>
        <p>${this.message}</p>
        <button type="button" @click=${this.dismiss} aria-label="Dismiss">&#10005;</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "error-toast": ErrorToast;
  }
}
