import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Temporal } from "temporal-polyfill";
import './add-observation.ts';
import { v7 } from "uuid";

const today = Temporal.Now.plainDateISO().toString();
@customElement('obs-panel')
export class ObsPanel extends LitElement {
  static styles = css`
    :host {
      font-family: Mukta,Helvetica,Arial,sans-serif;
      padding: 0.5em;
      overflow-y: scroll;
    }
    header {
      text-align: center;
    }
    h2 {
      font-size: 2.125rem;
      font-weight: 400;
      margin: 0.5rem;
    }
    add-observation {
      margin-bottom: 1rem;
      margin-top: 1rem;
    }
  `;

  @property({type: String})
  date!: string;

  protected render() {
    return html`
      <header>
        <h2>Marine Mammal Observations</h2>
        <form>
          <input @click=${this.onGotoYesterday} type="button" name="yesterday" value="◀">
          <input @click=${this.onGotoTomorrow}  type="button" name="tomorrow" value="▶" ?disabled=${this.date === today}>
          <input @change=${this.onDateChange} max=${today} min="2000-01-01" type="date" value=${this.date}>
        </form>
      </header>
      <add-observation .date=${this.date} id=${v7()}></add-observation>
      <slot></slot>
    `;
  }

  onGotoYesterday() {
    const date = Temporal.PlainDate.from(this.date).subtract({days: 1});
    const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date.toString()})
    this.dispatchEvent(dateSelected);
  }

  onGotoTomorrow() {
    const date = Temporal.PlainDate.from(this.date).add({days: 1});
    const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date.toString()})
    this.dispatchEvent(dateSelected);
  }

  onDateChange(e: Event) {
    const date = (e.target as HTMLInputElement).value;
    if (date && date.match(/^20\d\d-\d\d-\d\d$/)) {
      const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date})
      this.dispatchEvent(dateSelected);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-panel": ObsPanel;
  }
}
