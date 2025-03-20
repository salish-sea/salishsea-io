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
  `;

  public render() {
    return html`
      <div class="ol-control obs-panel">
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
