import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { doLogInContext, doLogOutContext, userContext, type User } from "./identity.ts";
import { consume } from "@lit/context";


@customElement('login-button')
export default class LoginButton extends LitElement {
  static styles = css`
    p { margin: 0; }
  `;

  @consume({context: userContext, subscribe: true})
  user: User | undefined;

  @consume({context: doLogInContext})
  doLogIn!: () => Promise<boolean>;

  @consume({context: doLogOutContext})
  doLogOut!: () => Promise<void>;

  protected render() {
    return this.user
     ? html`<button type="button" name="log_out" @click=${this.doLogOut}><span>Log out</span></button>`
     : html`<button type="button" name="log_in" @click=${this.doLogIn}><span>Log in</span></button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "login-button": LoginButton;
  }
}
