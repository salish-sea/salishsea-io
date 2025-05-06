import { css, html, LitElement} from "lit";
import { customElement, state } from "lit/decorators.js";
import './obs-map.ts';
import './login-button.ts';
import type { User } from "@auth0/auth0-spa-js";
import { auth0, logIn, logOut } from "./identity.ts";

@customElement('salish-sea')
export default class SalishSea extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-content: stretch;
      align-items: stretch;
      flex-direction: column;
      height: 100vh;
    }

    header {
      align-items: baseline;
      background-color: rgb(8, 13, 38);
      box-sizing: border-box;
      color: white;
      display: flex;
      justify-content: space-between;
      padding: 1em;
      width: 100%;
    }

    h1 {
      font-size: 1.2rem;
      margin: 0;
    }
  `;

  @state()
  protected _user: User | undefined;

  @state()
  protected _token: string | undefined;

  protected render(): unknown {
    const logIn = this.logIn.bind(this);
    const logOut = this.logOut.bind(this);
    return html`
      <header>
        <h1>SalishSea.io</h1>
        <login-button ?loggedIn=${this._user} .logIn=${logIn} .logOut=${logOut}></login-button>
      </header>
      <obs-map .logIn=${logIn} ?loggedIn=${this._user}></obs-map>
    `;
  }

  async logIn() {
    await logIn();
    return this.updateAuthState();
  }

  async logOut() {
    await logOut();
    this.updateAuthState();
  }

  async updateAuthState() {
    this._user = await auth0.getUser();
    this._token = this._user ? await auth0.getTokenSilently() : undefined;
    return this._user !== undefined;
  }
}
