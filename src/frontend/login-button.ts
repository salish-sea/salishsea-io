import { Task } from "@lit/task";
import { css, html, LitElement } from "lit";
import { auth0 } from "./identity.ts";
import { customElement } from "lit/decorators.js";

@customElement('login-button')
export default class LoginButton extends LitElement {
  static styles = css`
    p { margin: 0; }
  `;

  private _loginTask = new Task(this, {
    args: () => [],
    autoRun: false,
    task: async () => {
      await auth0.loginWithPopup({
        authorizationParams: {
          redirect_uri: 'http://localhost:3131/auth_redirect.html',
        }
      });
      this._identityTask.run();
    },
  })
  private _identityTask = new Task(this, {
    args: () => [],
    task: async () => {
      return await auth0.getUser();
    },
  });

  protected render(): unknown {
    const loginButton = html`
      <button type="button" name="log_in" @click=${this.login}><span>Log in</span></button>
    `;
    const logoutButton = html`
      <button type="button" name="log_out" @click=${this.logout}><span>Log out</span></button>
    `;
    return this._identityTask.render({
      initial: () => loginButton,
      pending: () => html`Logging in…`,
      complete: (user) => user ? logoutButton : loginButton,
      error: (error) => {console.error(error); return loginButton},
    });
  }

  login() {
    this._loginTask.run();
  }

  async logout() {
    await auth0.logout({openUrl: false});
    this._identityTask.run()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "login-button": LoginButton;
  }
}
