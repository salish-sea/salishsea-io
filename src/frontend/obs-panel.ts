import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

@customElement('obs-panel')
export class ObsPanel extends LitElement {
  static styles = css`
    :host {
      padding: 0.5em;
      overflow: auto;
    }
    header {
      font-weight: bold;
      margin-bottom: 1em;
      text-align: center;
    }
  `;

  public render() {
    return html`
      <header class="title">Marine Mammal Observations</header>
      <slot></slot>
    `;
  }
}


declare global {
  interface HTMLElementTagNameMap {
    "obs-panel": ObsPanel;
  }
}
