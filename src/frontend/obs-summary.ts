import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement('obs-summary')
export class ObsSummary extends LitElement {
  @property({type: String})
  name: string = ''

  @property({type: Number})
  count?: number

  @property({type: String})
  date: string = ''

  @property({type: String})
  time: string = ''

  @property({type: String})
  prev_date: string | null = null

  @property({type: String})
  body?: string

  static styles = css`
    :host {
    }
    time {
      display: inline-block;
      float: right;
      font-size: small;
    }
    p {
      margin: 0 0 0.5em 0;
    }
    .date {
      font-size: small;
      margin-top: 1em;
      text-align: right;
    }
    .count {
      font-size: small;
    }
  `;

  public render() {
    let header: TemplateResult | undefined;
    if (!this.prev_date || this.prev_date !== this.date) {
      header = html`<header class="date">${this.date}</header>`;
    }
    const body = this.body?.split('\n') || [];
    const count = this.count && this.count > 0 ? html` <span class="count">x${this.count}</span>` : undefined;
    return html`
      ${header}
      <p><b>${this.name}</b>${count}<time>${this.time}</time></p>
      ${body.map(p => html`<p class="body">${p}</p>`)}
    `;
  }
}


declare global {
  interface HTMLElementTagNameMap {
    "obs-summary": ObsSummary;
  }
}
