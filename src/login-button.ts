import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { userContext, type User } from "./identity.ts";
import { consume } from "@lit/context";


@customElement('login-button')
export default class LoginButton extends LitElement {
  static styles = css`
    button {
      align-items: center;
      cursor: pointer;
      display: inline-flex;
      gap: 0.25rem;
      min-height: 1.5rem;
      padding: 0.375rem 0.5rem;
      vertical-align: middle;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      font-family: Mukta, Helvetica, Arial, sans-serif;
      font-size: 0.8125rem;
    }
    button:hover {
      background: #f5f5f5;
    }
  `;

  @consume({context: userContext, subscribe: true})
  user: User | undefined;

  protected render() {
    return this.user
     ? html`<button type="button" name="log_out" @click=${this.doLogOut}><span>Log out</span></button>`
     : html`<button type="button" name="log_in" @click=${this.doLogIn}><span>Log in</span></button>`;
  }

  doLogIn() {
    this.dispatchEvent(new Event('log-in', {bubbles: true, composed: true}));
  }

  doLogOut() {
    this.dispatchEvent(new Event('log-out', {bubbles: true, composed: true}));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "login-button": LoginButton;
  }
}
