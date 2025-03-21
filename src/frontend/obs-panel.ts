import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

@customElement('obs-panel')
export class ObsPanel extends LitElement {
  static styles = css`
    :host {
      padding: 0.5em;
      border-left: 1px solid #cccccc;
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
      <div class="ol-control obs-panel">
        <header class="title">Marine Mammal Observations</header>
        <slot></slot>
      </div>
    `;
  }
}


declare global {
  interface HTMLElementTagNameMap {
    "obs-panel": ObsPanel;
  }
}
