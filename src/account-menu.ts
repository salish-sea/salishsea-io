/**
 * The account button at the end of the map's header, and its menu (GH #644): BeeAtlas's
 * account menu (its bee-header.ts, `_renderAuth` and `_renderMenu`), in place of the
 * "Log in" text button.
 *
 * The button is the nav's 44px icon button, at full strength rather than dimmed, since
 * it says who you are: your picture when you are signed in and we have one, an outline
 * person otherwise. The menu hangs from the header's right edge on the search popover's
 * surface. Its rows follow BeeAtlas's: one treatment for links and actions alike, a 44px
 * target with a hover; the identity at the top is not a row.
 *
 * Signing in is Google's One Tap prompt, as it was from the old button: the menu's row
 * raises the same `log-in` event, and `<salish-sea>` prompts. Nothing here renders
 * Google's own button.
 */

import { consume } from '@lit/context';
import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { observedDate } from './catalog.ts';
import { formatDate } from './date-format.ts';
import { contributorContext, userContext, type User } from './identity.ts';
import type { Contributor, Occurrence } from './types.ts';

const outline = (paths: ReturnType<typeof svg>, size = 24) =>
  html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width=${size} height=${size} aria-hidden="true">${paths}</svg>`;

// BeeAtlas's glyphs (heroicons): the signed-out account, the door for signing in and out,
// and a map pin for your last sighting.
const personIcon = outline(svg`<path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"></path>`);
const doorIcon = outline(svg`<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"></path>`, 16);
const pinIcon = outline(svg`<path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"></path>`, 16);

@customElement('account-menu')
export class AccountMenu extends LitElement {
  static styles = css`
    :host {
      align-items: center;
      display: flex;
      position: relative;
    }
    /* The nav's icon button, at full strength: identity should read clearly. */
    .account {
      align-items: center;
      background: transparent;
      border: 0;
      border-bottom: 2px solid transparent;
      box-sizing: border-box;
      color: inherit;
      cursor: pointer;
      display: flex;
      justify-content: center;
      min-height: 44px;
      min-width: 44px;
      padding: 10px;
    }
    .account[aria-expanded="true"] {
      border-bottom-color: var(--account-menu-accent, #1976d2);
    }
    /* A small ring in the header's white around your picture. */
    .avatar {
      border: 1.5px solid white;
      border-radius: 50%;
      box-sizing: border-box;
      display: block;
      height: 26px;
      object-fit: cover;
      width: 26px;
    }
    /* The search popover's surface, rows full-bleed. */
    .menu {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
      box-sizing: border-box;
      color: #213547;
      max-width: min(22rem, calc(100vw - 1rem));
      min-width: 240px;
      width: max-content;
      padding: 8px 0;
      position: absolute;
      right: 0;
      top: calc(100% + 4px);
      z-index: 1000;
    }
    .identity {
      align-items: center;
      display: flex;
      font-size: 1rem;
      font-weight: 600;
      gap: 8px;
      line-height: 1.4;
      padding: 6px 16px 10px;
    }
    .identity img {
      border-radius: 50%;
      height: 28px;
      object-fit: cover;
      width: 28px;
    }
    .badge {
      border: 1px solid #ddd;
      border-radius: 999px;
      color: #767676;
      font-size: 0.7rem;
      font-weight: 400;
      padding: 0.1rem 0.5rem;
    }
    .row {
      align-items: center;
      background: transparent;
      border: 0;
      box-sizing: border-box;
      color: #213547;
      cursor: pointer;
      display: flex;
      font: inherit;
      font-size: 0.875rem;
      gap: 8px;
      line-height: 1.5;
      min-height: 44px;
      padding: 10px 16px;
      text-align: left;
      text-decoration: none;
      width: 100%;
    }
    .row:hover {
      background: rgba(0, 0, 0, 0.05);
    }
    .row:active {
      background: rgba(0, 0, 0, 0.09);
    }
    .row:focus-visible {
      outline: 2px solid #1976d2;
      outline-offset: -2px;
    }
    .row svg {
      flex: none;
    }
    .status {
      color: #767676;
      font-size: 0.75rem;
      line-height: 1.4;
      padding: 2px 16px 6px;
    }
  `;

  @consume({ context: userContext, subscribe: true })
  @state() private user: User | undefined;

  @consume({ context: contributorContext, subscribe: true })
  @state() private contributor: Contributor | undefined;

  /** Your most recent sighting, which the menu can take you to; `<salish-sea>` finds it. */
  @property({ attribute: false })
  lastOwnOccurrence: Occurrence | null = null;

  @state() private open = false;
  /** Your picture failed to load: the outline person stands in. */
  @state() private pictureFailed = false;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this.onDocumentClick);
    document.addEventListener('keydown', this.onDocumentKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.onDocumentClick);
    document.removeEventListener('keydown', this.onDocumentKeydown);
  }

  private onDocumentClick = (event: MouseEvent) => {
    if (this.open && !event.composedPath().includes(this)) this.open = false;
  };

  private onDocumentKeydown = (event: KeyboardEvent) => {
    if (this.open && event.key === 'Escape') {
      this.open = false;
      this.shadowRoot?.querySelector<HTMLButtonElement>('.account')?.focus();
    }
  };

  /** Close the menu and hand the act to `<salish-sea>`, which signs in and out and moves the map. */
  private act(event: Event) {
    this.open = false;
    this.dispatchEvent(event);
  }

  protected render() {
    const signedIn = !!this.user;
    const picture = signedIn && !this.pictureFailed ? this.contributor?.picture : null;
    const name = this.contributor?.name;
    return html`
      <button class="account" type="button" aria-haspopup="dialog" aria-expanded=${this.open ? 'true' : 'false'}
        aria-label=${signedIn ? `Account${name ? `: ${name}` : ''}` : 'Account'} title="Account"
        @click=${() => { this.open = !this.open; }}>
        ${picture
          ? html`<img class="avatar" src=${picture} alt="" referrerpolicy="no-referrer" @error=${() => { this.pictureFailed = true; }}>`
          : personIcon}
      </button>
      ${this.open ? this.renderMenu(signedIn, picture ?? null, name) : nothing}
    `;
  }

  private renderMenu(signedIn: boolean, picture: string | null, name: string | undefined) {
    const last = this.lastOwnOccurrence;
    return html`
      <div class="menu" role="dialog" aria-label="Account">
        ${signedIn ? html`
          <div class="identity">
            ${picture ? html`<img src=${picture} alt="" referrerpolicy="no-referrer">` : nothing}
            ${name ?? 'Signed in'}
            ${this.contributor?.editor ? html`<span class="badge">Editor</span>` : nothing}
          </div>
          ${last ? html`
            <button class="row" type="button"
              @click=${() => this.act(new CustomEvent('focus-occurrence', { bubbles: true, composed: true, detail: last }))}>
              ${pinIcon}Your last sighting · ${formatDate(observedDate(last.observed_at), { month: 'short', day: 'numeric', year: 'numeric' })}
            </button>` : nothing}
          <button class="row" type="button" @click=${() => this.act(new Event('log-out', { bubbles: true, composed: true }))}>
            ${doorIcon}Sign out
          </button>
        ` : html`
          <button class="row" type="button" @click=${() => this.act(new Event('log-in', { bubbles: true, composed: true }))}>
            ${doorIcon}Sign in with Google
          </button>
          <div class="status">Sign in to report a sighting and add photos.</div>
        `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'account-menu': AccountMenu;
  }
}
