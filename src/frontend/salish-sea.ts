import { css, html, LitElement, type CSSResultGroup } from "lit";
import { customElement } from "lit/decorators.js";
import './obs-map.ts';
import './login-button.ts';

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

  protected render(): unknown {
    return html`
      <header>
        <h1>SalishSea.io</h1>
        <login-button></login-button>
      </header>
      <div>
        <obs-map></obs-map>
      </div>
    `;
  }
}
