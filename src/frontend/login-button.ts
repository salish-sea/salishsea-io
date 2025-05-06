import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";


@customElement('login-button')
export default class LoginButton extends LitElement {
  static styles = css`
    p { margin: 0; }
  `;

  @property({type: Boolean, reflect: true})
  loggedIn: boolean = false

  @property()
  logIn = () => {};

  @property()
  logOut = () => {};

  protected render() {
    return this.loggedIn
     ? html`<button type="button" name="log_out" @click=${this.logOut}><span>Log out</span></button>`
     : html`<button type="button" name="log_in" @click=${this.logIn}><span>Log in</span></button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "login-button": LoginButton;
  }
}
