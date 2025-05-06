import { css, html, LitElement} from "lit";
import { customElement, state } from "lit/decorators.js";
import './obs-map.ts';
import './login-button.ts';
import type { User } from "@auth0/auth0-spa-js";
import { auth0, doLogInContext, doLogOutContext, tokenContext, userContext } from "./identity.ts";
import { provide } from "@lit/context";

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

  @provide({context: userContext})
  @state()
  protected user: User | undefined;

  @provide({context: tokenContext})
  @state()
  protected token: string | undefined;

  @provide({context: doLogInContext})
  _doLogIn: () => Promise<boolean>

  @provide({context: doLogOutContext})
  _doLogOut: () => Promise<void>

  constructor() {
    super();
    this._doLogIn = this.doLogIn.bind(this);
    this._doLogOut = this.doLogOut.bind(this);
    this.updateAuth();
    this.addEventListener('log-in', this.doLogIn.bind(this));
    this.addEventListener('log-out', this.doLogOut.bind(this));
  }

  protected render(): unknown {
    return html`
      <header>
        <h1>SalishSea.io</h1>
        <login-button></login-button>
      </header>
      <obs-map></obs-map>
    `;
  }

  async updateAuth() {
    this.user = await auth0.getUser();
    this.token = this.user ? await auth0.getTokenSilently() : undefined;
  }

  async doLogIn() {
    await auth0.loginWithPopup({
      authorizationParams: {
        redirect_uri: 'http://localhost:3131/auth_redirect.html',
      }
    });
    await this.updateAuth();
    return !!this.user;
  }

  async doLogOut() {
    await auth0.logout({openUrl: false});
    await this.updateAuth();
  }
}
