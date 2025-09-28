import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { userContext, type User } from "./identity.ts";
import { consume } from "@lit/context";


@customElement('login-button')
export default class LoginButton extends LitElement {
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
